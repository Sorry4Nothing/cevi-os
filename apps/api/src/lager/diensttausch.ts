import { and, asc, eq, gt, inArray, notInArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  anwesenheit,
  diensttausch,
  dienst,
  lagerMitglied,
  lagertag,
  schicht,
  tagesabschnitt,
} from "../db/schema.js";
import { benachrichtige, type Zustellung } from "./benachrichtigung.js";
import { darf, type LagerZugriff } from "./policy.js";
import { sperreLager } from "./ressorts.js";
import { aktiveMitglieder } from "./schichtplan.js";
import { aendereZeile, legeZeileAn, type Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";
import { anzeigeNamenUndBilder } from "./zimmer.js";

// Diensttausch im Lager (#389). Ein Mitglied fragt an, eine eigene Schicht zu tauschen oder abzugeben; die Lagerleitung entscheidet. Ob die Wunschperson einverstanden ist, klärt die Lagerleitung selbst: Cevi OS fragt sie nicht. Erst der Entscheid «angenommen» bucht um, in einer Transaktion unter der Lagersperre, und prüft dabei die Regeln des Schichtplans (#388) erneut: wer neu in einem Abschnitt steht, ist dort nicht abwesend (F) und hat dort keinen anderen Dienst. Es gibt drei Formen: mit einer Schicht der Wunschperson (beide tauschen), nur mit der Wunschperson (sie übernimmt) oder ohne beides (die Lagerleitung nennt beim Entscheid die Person, die übernimmt).
// Der Feed meldet Anfragen nur, wer entscheiden darf; das Team liest seine eigenen über GET .../diensttausch/eigene.
registriereLagerTabelle({
  tabelle: diensttausch,
  recht: "diensttausch.entscheiden",
});

export const tauschAnsicht = (r: typeof diensttausch.$inferSelect) => ({
  id: r.id,
  version: r.version,
  vonPersonId: r.vonPersonId,
  schichtId: r.schichtId,
  mitPersonId: r.mitPersonId,
  mitSchichtId: r.mitSchichtId,
  notiz: r.notiz,
  status: r.status,
  entschiedenVon: r.entschiedenVon,
  entschiedenAm: r.entschiedenAm,
  erstelltAm: r.erstelltAm,
});

// Eingaben: strikt, nur die genannten Felder (SR-72); Umlaute werden zusammengesetzt (NFC), Steuerzeichen ausser Zeilenumbruch und Tabulator sind verboten
const notiz = z
  .string()
  .transform((w) => w.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(500)
      .refine((w) => !/[\p{Cc}]/u.test(w.replace(/[\n\t]/g, ""))),
  );
const version = z.number().int().min(1);

export const tauschAnlegen = z
  .strictObject({
    schichtId: z.uuid(),
    mitSchichtId: z.uuid().optional(),
    mitPersonId: z.uuid().optional(),
    notiz: notiz.optional(),
  })
  // Die Person der Wunschschicht ergibt sich aus der Schicht
  .refine((b) => b.mitSchichtId === undefined || b.mitPersonId === undefined);
export const tauschEntscheiden = z
  .strictObject({
    entscheid: z.enum(["angenommen", "abgelehnt"]),
    version,
    // Die Person, die übernimmt, wenn die Anfrage keine Wunschperson nennt
    mitPersonId: z.uuid().optional(),
  })
  .refine((b) => b.entscheid === "angenommen" || b.mitPersonId === undefined);
export const tauschZurueckziehen = z.strictObject({ version });
export const tauschZuruecknehmen = z.strictObject({ version });
export const tauschAbfrage = z.strictObject({
  status: z
    .enum(["offen", "angenommen", "abgelehnt", "zurueckgezogen"])
    .optional(),
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type TauschFehler =
  | "NICHT_DEINE_SCHICHT"
  | "ANFRAGE_OFFEN"
  | "MIT_SCHICHT_UNGUELTIG"
  | "MIT_PERSON_UNGUELTIG"
  | "NICHT_DEINE_ANFRAGE"
  | "BEREITS_ENTSCHIEDEN"
  | "SCHICHT_GEAENDERT"
  | "PERSON_NICHT_VERFUEGBAR"
  | "ABWESEND"
  | "DOPPELBELEGT"
  | "NICHT_ENTSCHIEDEN";
type Fehler = { fehler: TauschFehler };
type Akteur = { lagerId: string; personId: string };
type Leser = Pick<Db, "select">;

// Die Schichten in einer Abfrage, nur gültige: Dienst, Lagertag und Abschnitt nicht gelöscht. Immer mit dem Lager: schicht_id hat keinen Fremdschlüssel mit Lager
async function ladeSchichten(tx: Leser, lagerId: string, ids: string[]) {
  const zeilen = await tx
    .select({
      id: schicht.id,
      version: schicht.version,
      lagerSeq: schicht.lagerSeq,
      personId: schicht.personId,
      lagertagId: schicht.lagertagId,
      tagesabschnittId: schicht.tagesabschnittId,
      dienstId: schicht.dienstId,
    })
    .from(schicht)
    .innerJoin(
      dienst,
      and(eq(dienst.lagerId, schicht.lagerId), eq(dienst.id, schicht.dienstId)),
    )
    .innerJoin(
      lagertag,
      and(
        eq(lagertag.lagerId, schicht.lagerId),
        eq(lagertag.id, schicht.lagertagId),
      ),
    )
    .innerJoin(
      tagesabschnitt,
      and(
        eq(tagesabschnitt.lagerId, schicht.lagerId),
        eq(tagesabschnitt.id, schicht.tagesabschnittId),
      ),
    )
    .where(and(eq(schicht.lagerId, lagerId), inArray(schicht.id, ids)));
  return new Map(zeilen.map((z) => [z.id, z]));
}
type SchichtZeile =
  Awaited<ReturnType<typeof ladeSchichten>> extends Map<string, infer Z>
    ? Z
    : never;

const schichtAnsicht = (r: typeof schicht.$inferSelect) => ({
  id: r.id,
  version: r.version,
});

// Eine Anfrage stellen. Die Schicht muss eine eigene sein (403 NICHT_DEINE_SCHICHT, eine unbekannte oder gelöschte 404), je Schicht gibt es höchstens eine offene Anfrage (409 ANFRAGE_OFFEN). Die Wunschschicht gehört einer anderen Person des Lagers (400 MIT_SCHICHT_UNGUELTIG sonst, auch bei einer Schicht von Teilnehmenden); die Wunschperson ist ein aktives Mitglied und nicht man selbst. Eine Benachrichtigung für alle Lagerleitungen; der Push nennt weder Person noch Schicht
export async function legeTauschAn(
  tx: Tx,
  k: Akteur,
  abteilungId: string,
  e: z.output<typeof tauschAnlegen>,
): Promise<
  Fehler | { tausch: ReturnType<typeof tauschAnsicht>; zustellung: Zustellung }
> {
  await sperreLager(tx, k.lagerId);
  const ids = [e.schichtId, ...(e.mitSchichtId ? [e.mitSchichtId] : [])];
  const schichten = await ladeSchichten(tx, k.lagerId, ids);
  const meine = schichten.get(e.schichtId);
  if (!meine) throw new HTTPException(404);
  if (meine.personId !== k.personId) return { fehler: "NICHT_DEINE_SCHICHT" };

  let mitPersonId = e.mitPersonId ?? null;
  if (e.mitSchichtId) {
    const wunsch = schichten.get(e.mitSchichtId);
    if (!wunsch) throw new HTTPException(404);
    if (wunsch.personId === null || wunsch.personId === k.personId) {
      return { fehler: "MIT_SCHICHT_UNGUELTIG" };
    }
    mitPersonId = wunsch.personId;
  } else if (mitPersonId === k.personId) {
    return { fehler: "MIT_PERSON_UNGUELTIG" };
  }
  if (
    mitPersonId &&
    (await aktiveMitglieder(tx, k.lagerId, abteilungId, [mitPersonId])).length <
      1
  ) {
    throw new HTTPException(404);
  }
  const [offen] = await tx
    .select({ id: diensttausch.id })
    .from(diensttausch)
    .where(
      and(
        eq(diensttausch.lagerId, k.lagerId),
        eq(diensttausch.schichtId, e.schichtId),
        eq(diensttausch.status, "offen"),
      ),
    );
  if (offen) return { fehler: "ANFRAGE_OFFEN" };

  const neu = await legeZeileAn(tx, diensttausch, k, {
    vonPersonId: k.personId,
    schichtId: e.schichtId,
    mitPersonId,
    mitSchichtId: e.mitSchichtId ?? null,
    notiz: e.notiz ?? null,
  });
  const leitung = await tx
    .select({ id: lagerMitglied.personId })
    .from(lagerMitglied)
    .where(
      and(
        eq(lagerMitglied.lagerId, k.lagerId),
        eq(lagerMitglied.rolle, "lagerleitung"),
      ),
    );
  const zustellung = await benachrichtige(tx, {
    lagerId: k.lagerId,
    empfaengerIds: leitung.map((l) => l.id),
    art: "diensttausch_anfrage",
    objekt: { typ: "diensttausch", id: neu.id },
    ausgeloestVon: k.personId,
  });
  return { tausch: tauschAnsicht(neu), zustellung };
}

async function ladeTausch(tx: Leser, lagerId: string, id: string) {
  const [zeile] = await tx
    .select()
    .from(diensttausch)
    .where(and(eq(diensttausch.lagerId, lagerId), eq(diensttausch.id, id)));
  if (!zeile) throw new HTTPException(404);
  return zeile;
}

// Die anfragende Person zieht eine offene Anfrage zurück. Eine fremde Anfrage ist 403 NICHT_DEINE_ANFRAGE, eine schon entschiedene 409 BEREITS_ENTSCHIEDEN. Keine Benachrichtigung: Die Lagerleitung sieht den Stand in der Liste
export async function ziehTauschZurueck(
  tx: Tx,
  k: Akteur,
  id: string,
  version: number,
): Promise<Fehler | { tausch: ReturnType<typeof tauschAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  const t = await ladeTausch(tx, k.lagerId, id);
  if (t.vonPersonId !== k.personId) return { fehler: "NICHT_DEINE_ANFRAGE" };
  if (t.status !== "offen") return { fehler: "BEREITS_ENTSCHIEDEN" };
  return {
    tausch: tauschAnsicht(
      await aendereZeile(tx, diensttausch, k, {
        id,
        version,
        werte: {
          status: "zurueckgezogen",
          entschiedenVon: k.personId,
          entschiedenAm: new Date(),
        },
        ansicht: tauschAnsicht,
      }),
    ),
  };
}

// Die Regeln aus #388 für die neuen Plätze: Wer neu in einem Abschnitt steht, ist dort nicht abwesend (F) und hat dort keinen anderen Dienst als die beiden getauschten Schichten. Zwei Abfragen gleichzeitig; ein Platz ist (Person, Tag, Abschnitt)
async function pruefePlaetze(
  tx: Leser,
  lagerId: string,
  plaetze: { personId: string; lagertagId: string; tagesabschnittId: string }[],
  ausser: string[],
): Promise<TauschFehler | undefined> {
  const [abwesend, doppelt] = await Promise.all([
    tx
      .select({ id: anwesenheit.id })
      .from(anwesenheit)
      .where(
        and(
          eq(anwesenheit.lagerId, lagerId),
          eq(anwesenheit.wert, "F"),
          or(
            ...plaetze.map((p) =>
              and(
                eq(anwesenheit.personId, p.personId),
                eq(anwesenheit.lagertagId, p.lagertagId),
                eq(anwesenheit.tagesabschnittId, p.tagesabschnittId),
              ),
            ),
          ),
        ),
      )
      .limit(1),
    tx
      .select({ id: schicht.id })
      .from(schicht)
      .where(
        and(
          eq(schicht.lagerId, lagerId),
          notInArray(schicht.id, ausser),
          or(
            ...plaetze.map((p) =>
              and(
                eq(schicht.personId, p.personId),
                eq(schicht.lagertagId, p.lagertagId),
                eq(schicht.tagesabschnittId, p.tagesabschnittId),
              ),
            ),
          ),
        ),
      )
      .limit(1),
  ]);
  if (abwesend.length > 0) return "ABWESEND";
  if (doppelt.length > 0) return "DOPPELBELEGT";
  return undefined;
}

// Die Lagerleitung entscheidet über eine offene Anfrage. Alles unter der Lagersperre: Zwei gleichzeitige Entscheide auf dieselbe Anfrage (oder auf zwei Anfragen, die dieselbe Schicht betreffen) laufen nacheinander; der zweite sieht den Stand des ersten (409 BEREITS_ENTSCHIEDEN oder 409 SCHICHT_GEAENDERT). Eine veraltete Version der Anfrage ist 409 VERSION_KONFLIKT.
// Annehmen: Die Schichten müssen noch so stehen wie bei der Anfrage (sonst 409 SCHICHT_GEAENDERT, die Anfrage bleibt offen und lässt sich ablehnen); wer übernimmt, ist ein aktives Mitglied (409 PERSON_NICHT_VERFUEGBAR) und die Regeln des Schichtplans gelten (409 ABWESEND, 409 DOPPELBELEGT). Ohne Wunschperson nennt der Entscheid sie (400 MIT_PERSON_UNGUELTIG, wenn sie fehlt oder von der Wunschperson abweicht).
// Umbuchen: Mit Wunschschicht tauschen beide die Person; liegen beide im selben Abschnitt desselben Tages, tauschen die Schichten den Dienst (die Personen blieben sonst kurz doppelt im Abschnitt, was der Teilindex verbietet). Sonst übernimmt die Wunschperson die Schicht. Die Benachrichtigung geht an die anfragende und, wenn angenommen, an die andere Person
export async function entscheideTausch(
  tx: Tx,
  k: Akteur,
  abteilungId: string,
  id: string,
  e: z.output<typeof tauschEntscheiden>,
): Promise<
  | Fehler
  | { tausch: ReturnType<typeof tauschAnsicht>; zustellungen: Zustellung[] }
> {
  await sperreLager(tx, k.lagerId);
  const t = await ladeTausch(tx, k.lagerId, id);
  if (t.status !== "offen") return { fehler: "BEREITS_ENTSCHIEDEN" };

  let mitPersonId = t.mitPersonId;
  let eigene: SchichtZeile | undefined;
  let andere: SchichtZeile | undefined;
  if (e.entscheid === "angenommen") {
    if (
      (t.mitPersonId && e.mitPersonId && t.mitPersonId !== e.mitPersonId) ||
      (!t.mitPersonId && !e.mitPersonId)
    ) {
      return { fehler: "MIT_PERSON_UNGUELTIG" };
    }
    mitPersonId = t.mitPersonId ?? e.mitPersonId!;
    const schichten = await ladeSchichten(tx, k.lagerId, [
      t.schichtId,
      ...(t.mitSchichtId ? [t.mitSchichtId] : []),
    ]);
    eigene = schichten.get(t.schichtId);
    andere = t.mitSchichtId ? schichten.get(t.mitSchichtId) : undefined;
    if (
      !eigene ||
      eigene.personId !== t.vonPersonId ||
      (t.mitSchichtId && (!andere || andere.personId !== mitPersonId))
    ) {
      return { fehler: "SCHICHT_GEAENDERT" };
    }
    if (
      (await aktiveMitglieder(tx, k.lagerId, abteilungId, [mitPersonId]))
        .length < 1
    ) {
      return { fehler: "PERSON_NICHT_VERFUEGBAR" };
    }
    const fehler = await pruefePlaetze(
      tx,
      k.lagerId,
      [
        { personId: mitPersonId, ...platz(eigene) },
        ...(andere ? [{ personId: t.vonPersonId, ...platz(andere) }] : []),
      ],
      [eigene.id, ...(andere ? [andere.id] : [])],
    );
    if (fehler) return { fehler };
  }

  const neu = await aendereZeile(tx, diensttausch, k, {
    id,
    version: e.version,
    werte: {
      status: e.entscheid,
      mitPersonId,
      entschiedenVon: k.personId,
      entschiedenAm: new Date(),
    },
    ansicht: tauschAnsicht,
  });

  if (eigene) {
    if (gleicherPlatz(eigene, andere)) {
      await aendereZeile(tx, schicht, k, {
        id: eigene.id,
        version: eigene.version,
        werte: { dienstId: andere!.dienstId },
        ansicht: schichtAnsicht,
      });
      await aendereZeile(tx, schicht, k, {
        id: andere!.id,
        version: andere!.version,
        werte: { dienstId: eigene.dienstId },
        ansicht: schichtAnsicht,
      });
    } else {
      await aendereZeile(tx, schicht, k, {
        id: eigene.id,
        version: eigene.version,
        werte: { personId: mitPersonId },
        ansicht: schichtAnsicht,
      });
      if (andere) {
        await aendereZeile(tx, schicht, k, {
          id: andere.id,
          version: andere.version,
          werte: { personId: t.vonPersonId },
          ansicht: schichtAnsicht,
        });
      }
    }
  }

  const objekt = { typ: "diensttausch", id } as const;
  const zustellungen = [
    await benachrichtige(tx, {
      lagerId: k.lagerId,
      empfaengerIds: [t.vonPersonId],
      art: "diensttausch_entscheid",
      objekt,
      ausgeloestVon: k.personId,
    }),
  ];
  if (e.entscheid === "angenommen") {
    zustellungen.push(
      await benachrichtige(tx, {
        lagerId: k.lagerId,
        empfaengerIds: [mitPersonId!],
        art: "diensttausch_entscheid",
        objekt,
        ausgeloestVon: k.personId,
      }),
    );
  }
  return { tausch: tauschAnsicht(neu), zustellungen };
}

// Den Entscheid zurücknehmen (#848), das «Rückgängig» der App nach «Annehmen» oder «Ablehnen»: Die Anfrage ist wieder offen. Unter der Lagersperre wie der Entscheid; eine offene oder zurückgezogene Anfrage ist 409 NICHT_ENTSCHIEDEN, eine veraltete Version 409 VERSION_KONFLIKT, eine neue offene Anfrage für dieselbe Schicht 409 ANFRAGE_OFFEN.
// Angenommen: bucht zurück, nur solange die Schichten seit dem Entscheid unverändert sind. Der Entscheid schrieb unter derselben Sperre zuerst die Anfrage und gleich danach die Schichten, ihre Folgenummern folgen also direkt auf die der Anfrage; jede spätere Änderung hat eine höhere (sonst 409 SCHICHT_GEAENDERT). Wer zurückkommt, muss die Regeln des Schichtplans erfüllen (409 ABWESEND, DOPPELBELEGT, PERSON_NICHT_VERFUEGBAR).
// shortcut: mit_person_id bleibt die beim Entscheid gewählte Person (die Anfrage speichert nicht, ob sie eine Wunschperson hatte); eine andere Person: ablehnen, neu anfragen lassen. Keine Benachrichtigung, die Apps sehen den Stand über den Feed; eine eigene Art, wenn Rückmeldungen kommen
export async function nimmEntscheidZurueck(
  tx: Tx,
  k: Akteur,
  abteilungId: string,
  id: string,
  version: number,
): Promise<Fehler | { tausch: ReturnType<typeof tauschAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  const t = await ladeTausch(tx, k.lagerId, id);
  if (t.status !== "angenommen" && t.status !== "abgelehnt") {
    return { fehler: "NICHT_ENTSCHIEDEN" };
  }
  const [offen] = await tx
    .select({ id: diensttausch.id })
    .from(diensttausch)
    .where(
      and(
        eq(diensttausch.lagerId, k.lagerId),
        eq(diensttausch.schichtId, t.schichtId),
        eq(diensttausch.status, "offen"),
      ),
    );
  if (offen) return { fehler: "ANFRAGE_OFFEN" };

  let eigene: SchichtZeile | undefined;
  let andere: SchichtZeile | undefined;
  if (t.status === "angenommen") {
    const schichten = await ladeSchichten(tx, k.lagerId, [
      t.schichtId,
      ...(t.mitSchichtId ? [t.mitSchichtId] : []),
    ]);
    eigene = schichten.get(t.schichtId);
    andere = t.mitSchichtId ? schichten.get(t.mitSchichtId) : undefined;
    const betroffen = [eigene, ...(t.mitSchichtId ? [andere] : [])];
    if (
      betroffen.some(
        (s) =>
          !s ||
          s.lagerSeq <= t.lagerSeq ||
          s.lagerSeq > t.lagerSeq + betroffen.length,
      )
    ) {
      return { fehler: "SCHICHT_GEAENDERT" };
    }
    // Erst prüfen, dann schreiben: Ein Fehler kommt als Wert zurück, die Transaktion schreibt also alles bis dahin
    if (!gleicherPlatz(eigene!, andere)) {
      const zurueck = [t.vonPersonId, ...(andere ? [t.mitPersonId!] : [])];
      if (
        (await aktiveMitglieder(tx, k.lagerId, abteilungId, zurueck)).length <
        zurueck.length
      ) {
        return { fehler: "PERSON_NICHT_VERFUEGBAR" };
      }
      const fehler = await pruefePlaetze(
        tx,
        k.lagerId,
        [
          { personId: t.vonPersonId, ...platz(eigene!) },
          ...(andere ? [{ personId: t.mitPersonId!, ...platz(andere) }] : []),
        ],
        [eigene!.id, ...(andere ? [andere.id] : [])],
      );
      if (fehler) return { fehler };
    }
  }

  const neu = await aendereZeile(tx, diensttausch, k, {
    id,
    version,
    werte: { status: "offen", entschiedenVon: null, entschiedenAm: null },
    ansicht: tauschAnsicht,
  });

  if (eigene) {
    if (gleicherPlatz(eigene, andere)) {
      // Der Tausch der Dienste ist sein eigenes Gegenstück
      await aendereZeile(tx, schicht, k, {
        id: eigene.id,
        version: eigene.version,
        werte: { dienstId: andere!.dienstId },
        ansicht: schichtAnsicht,
      });
      await aendereZeile(tx, schicht, k, {
        id: andere!.id,
        version: andere!.version,
        werte: { dienstId: eigene.dienstId },
        ansicht: schichtAnsicht,
      });
    } else {
      await aendereZeile(tx, schicht, k, {
        id: eigene.id,
        version: eigene.version,
        werte: { personId: t.vonPersonId },
        ansicht: schichtAnsicht,
      });
      if (andere) {
        await aendereZeile(tx, schicht, k, {
          id: andere.id,
          version: andere.version,
          werte: { personId: t.mitPersonId },
          ansicht: schichtAnsicht,
        });
      }
    }
  }
  return { tausch: tauschAnsicht(neu) };
}

// Beide Schichten im selben Abschnitt desselben Tages: Der Entscheid tauschte die Dienste statt der Personen
const gleicherPlatz = (eigene: SchichtZeile, andere?: SchichtZeile) =>
  andere !== undefined &&
  andere.lagertagId === eigene.lagertagId &&
  andere.tagesabschnittId === eigene.tagesabschnittId;

const platz = (s: { lagertagId: string; tagesabschnittId: string }) => ({
  lagertagId: s.lagertagId,
  tagesabschnittId: s.tagesabschnittId,
});

// Alle Anfragen des Lagers, älteste zuerst (UUIDv7); eine Abfrage je Seite
export async function ladeTausche(
  db: Leser,
  lagerId: string,
  p: {
    status?: z.infer<typeof tauschAbfrage>["status"];
    nach?: string;
    limit: number;
  },
) {
  const zeilen = await db
    .select()
    .from(diensttausch)
    .where(
      and(
        eq(diensttausch.lagerId, lagerId),
        p.status ? eq(diensttausch.status, p.status) : undefined,
        p.nach ? gt(diensttausch.id, p.nach) : undefined,
      ),
    )
    .orderBy(asc(diensttausch.id))
    .limit(p.limit + 1);
  const seite = zeilen.slice(0, p.limit).map(tauschAnsicht);
  return {
    tausche: seite,
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.id : null,
  };
}

// Die Antworten der Routen nennen zusätzlich Namen und Schicht-Details (#520): vonName und mitName (Anzeigename des Lagers, Regel von anzeigeNamenLager), dazu je Schicht Dienst, Tag und Abschnitt. Gebündelt für beliebig viele Anfragen: eine Abfrage für die Schichten, eine für die Namen (nur wenn eine Person vorkommt). Die Felder der Ansicht bleiben unverändert (die Feed- und Konfliktantworten des Sync-Kerns nutzen tauschAnsicht allein). Eine Schicht, die es nicht mehr gibt, hat keine Details (null)
export async function tauschMitNamen(
  db: Db,
  zugriff: LagerZugriff,
  tausche: ReturnType<typeof tauschAnsicht>[],
) {
  if (tausche.length === 0) return [];
  const schichtIds = [
    ...new Set(
      tausche.flatMap((t) => [t.schichtId, t.mitSchichtId].filter((s) => !!s)),
    ),
  ] as string[];
  const [schichten, { namen, bilder }] = await Promise.all([
    db
      .select({
        id: schicht.id,
        dienst: dienst.name,
        datum: lagertag.datum,
        tagesabschnitt: tagesabschnitt.name,
      })
      .from(schicht)
      .innerJoin(
        dienst,
        and(
          eq(dienst.lagerId, schicht.lagerId),
          eq(dienst.id, schicht.dienstId),
        ),
      )
      .innerJoin(
        lagertag,
        and(
          eq(lagertag.lagerId, schicht.lagerId),
          eq(lagertag.id, schicht.lagertagId),
        ),
      )
      .innerJoin(
        tagesabschnitt,
        and(
          eq(tagesabschnitt.lagerId, schicht.lagerId),
          eq(tagesabschnitt.id, schicht.tagesabschnittId),
        ),
      )
      .where(
        and(
          eq(schicht.lagerId, zugriff.lager.id),
          inArray(schicht.id, schichtIds),
        ),
      ),
    anzeigeNamenUndBilder(
      db,
      zugriff.lager.id,
      darf(zugriff, "teilnehmer.bearbeiten"),
    ),
  ]);
  const je = new Map(
    schichten.map(({ id, ...details }) => [id, details] as const),
  );
  return tausche.map((t) => ({
    ...t,
    vonName: namen.get(t.vonPersonId) ?? null,
    mitName: t.mitPersonId ? (namen.get(t.mitPersonId) ?? null) : null,
    vonBildUrl: bilder.get(t.vonPersonId) ?? null,
    mitBildUrl: t.mitPersonId ? (bilder.get(t.mitPersonId) ?? null) : null,
    schicht: je.get(t.schichtId) ?? null,
    mitSchicht: t.mitSchichtId ? (je.get(t.mitSchichtId) ?? null) : null,
  }));
}
