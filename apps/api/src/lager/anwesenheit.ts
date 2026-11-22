import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  anwesenheit,
  anwesenheitAnfrage,
  lagerMitglied,
} from "../db/schema.js";
import { benachrichtige, type Zustellung } from "./benachrichtigung.js";
import { sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeileAn, type Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";
import { pruefeTageUndAbschnitte } from "./zeitplan.js";

// Anwesenheit im Lager (#390), so wie im bisherigen Tool: A anwesend, F abwesend, O offen. Die Matrix ist Person (Leitende: Konto; Teilnehmende: teilnehmer_id) mal Lagertag mal Abschnitt des Tages.
// Speicherung: eine Zeile je Feld, aber nur für A und F. «O» ist der Normalfall und braucht keine Zeile; eine Zeile mit O entsteht nur, wenn die Lagerleitung ein eingetragenes Feld wieder öffnet. Das hält die Tabelle klein (rund 100 Personen mal 14 Tage mal 3 Abschnitte sind höchstens 4200 Zeilen je Lager, in der Regel weniger) und gibt jedem Feld seine eigene Version, damit zwei Leute nie dasselbe Dokument überschreiben (Fehler 4 des alten Tools). Eine kompaktere Speicherung (ein JSON je Person und Tag oder je Person) gäbe das auf: Versionskonflikt, Eindeutigkeit und «nur leere Felder» liessen sich nicht mehr in der Datenbank halten.
// Regeln: Die Lagerleitung (anwesenheit.bearbeiten) trägt für alle ein und überschreibt jedes Feld, mit der zuletzt gesehenen Version. Das Team (anwesenheit.eigene) trägt nur die eigenen, noch offenen Felder direkt ein und nur bis zur Frist; ein eingetragenes Feld oder ein Feld nach der Frist ändert es nur per Anfrage (409 ANFRAGE_NOETIG), die die Lagerleitung annimmt oder ablehnt. Das Team löscht nie und schreibt nie für andere (die Route nimmt keine Personen-ID entgegen).

// Der Feed meldet Anwesenheit nur, wer sie ganz lesen darf: Der Zeilenfilter der Tabellen kennt die Person nicht, das Team bekäme sonst fremde Zeilen-IDs. Das Team liest seine Felder über GET .../anwesenheit/eigene
registriereLagerTabelle({
  tabelle: anwesenheit,
  recht: "anwesenheit.lesen_alle",
});
registriereLagerTabelle({
  tabelle: anwesenheitAnfrage,
  recht: "anwesenheit.bearbeiten",
});

export type AnwesenheitsWert = "A" | "F" | "O";

export const anwesenheitAnsicht = (r: typeof anwesenheit.$inferSelect) => ({
  id: r.id,
  version: r.version,
  personId: r.personId,
  teilnehmerId: r.teilnehmerId,
  lagertagId: r.lagertagId,
  tagesabschnittId: r.tagesabschnittId,
  wert: r.wert,
});
export const anfrageAnsicht = (r: typeof anwesenheitAnfrage.$inferSelect) => ({
  id: r.id,
  version: r.version,
  personId: r.personId,
  lagertagId: r.lagertagId,
  tagesabschnittId: r.tagesabschnittId,
  wert: r.wert,
  notiz: r.notiz,
  status: r.status,
  entschiedenVon: r.entschiedenVon,
  entschiedenAm: r.entschiedenAm,
  erstelltAm: r.erstelltAm,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Höchstens 100 Felder je Anfrage: Ein ganzer Tag ist ein Aufruf mit seinen Abschnitten, ein ganzes Lager einer Person passt auch hinein
export const MAX_FELDER = 100;
const wert = z.enum(["A", "F", "O"]);
const version = z.number().int().min(1);
const feld = { lagertagId: z.uuid(), tagesabschnittId: z.uuid() };
const schluessel = (e: {
  personId?: string;
  teilnehmerId?: string;
  lagertagId: string;
  tagesabschnittId: string;
}) =>
  `${e.personId ?? e.teilnehmerId ?? ""}|${e.lagertagId}|${e.tagesabschnittId}`;
const eindeutig = (liste: Parameters<typeof schluessel>[0][]) =>
  new Set(liste.map(schluessel)).size === liste.length;

export const eigeneSetzen = z.strictObject({
  eintraege: z
    .array(z.strictObject({ ...feld, wert }))
    .min(1)
    .max(MAX_FELDER)
    .refine(eindeutig),
});
export const leitungSetzen = z.strictObject({
  eintraege: z
    .array(
      z
        .strictObject({
          personId: z.uuid().optional(),
          teilnehmerId: z.uuid().optional(),
          ...feld,
          wert,
          // Die Version des Feldes, die die App zuletzt gesehen hat; ohne Angabe gilt das Feld als leer
          version: version.optional(),
        })
        .refine(
          (e) => (e.personId === undefined) !== (e.teilnehmerId === undefined),
        ),
    )
    .min(1)
    .max(MAX_FELDER)
    .refine(eindeutig),
});
export const anfragenAnlegen = z.strictObject({
  eintraege: z
    .array(z.strictObject({ ...feld, wert }))
    .min(1)
    .max(MAX_FELDER)
    .refine(eindeutig),
  notiz: z.string().trim().min(1).max(500).optional(),
});
export const anfragenEntscheiden = z.strictObject({
  entscheid: z.enum(["angenommen", "abgelehnt"]),
  anfragen: z
    .array(z.strictObject({ id: z.uuid(), version }))
    .min(1)
    .max(50)
    .refine((l) => new Set(l.map((a) => a.id)).size === l.length),
});
export const fristSetzen = z.strictObject({
  frist: z.iso.datetime({ offset: true }).nullable(),
});
export const matrixAbfrage = z.strictObject({
  // Lagertage, kommagetrennt; ohne Angabe alle
  lagertagIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",") : undefined))
    .pipe(z.array(z.uuid()).min(1).max(40).optional()),
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
export const anfragenAbfrage = z.strictObject({
  status: z.enum(["offen", "angenommen", "abgelehnt"]).optional(),
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

type Feld = { lagertagId: string; tagesabschnittId: string };
type Zeile = typeof anwesenheit.$inferSelect;
const zeilenSchluessel = (z: Zeile) =>
  schluessel({
    personId: z.personId ?? undefined,
    teilnehmerId: z.teilnehmerId ?? undefined,
    lagertagId: z.lagertagId,
    tagesabschnittId: z.tagesabschnittId,
  });
const pick = (f: Feld): Feld => ({
  lagertagId: f.lagertagId,
  tagesabschnittId: f.tagesabschnittId,
});
export type Gesperrt = Feld & { grund: "eingetragen" | "frist" };
type Reader = Pick<Db, "select">;

// Lagertag und Abschnitt jedes Feldes sind Zeilen dieses Lagers (#374); die Fremdschlüssel halten dasselbe noch einmal fest
const felderStimmen = (tx: Reader, lagerId: string, items: Feld[]) =>
  pruefeTageUndAbschnitte(
    tx,
    lagerId,
    items.map((i) => i.lagertagId),
    items.map((i) => i.tagesabschnittId),
  );

const feldSchluessel = (f: Feld) => `${f.lagertagId}|${f.tagesabschnittId}`;
const tageVon = (items: Feld[]) => [...new Set(items.map((i) => i.lagertagId))];

// Alle Felder dieser Personen an diesen Tagen in einer Abfrage; geladen wird unter der Lagersperre, damit die Entscheidungen unten auf dem Stand beruhen, den die Schreiber vor uns hinterlassen haben
async function ladeFelder(
  tx: Reader,
  lagerId: string,
  tage: string[],
  personIds: string[],
  teilnehmerIds: string[] = [],
) {
  const anwesende = [
    personIds.length > 0 ? inArray(anwesenheit.personId, personIds) : undefined,
    teilnehmerIds.length > 0
      ? inArray(anwesenheit.teilnehmerId, teilnehmerIds)
      : undefined,
  ].filter((a) => a !== undefined);
  if (anwesende.length === 0) return new Map<string, Zeile>();
  const zeilen = await tx
    .select()
    .from(anwesenheit)
    .where(
      and(
        eq(anwesenheit.lagerId, lagerId),
        isNull(anwesenheit.geloeschtAm),
        inArray(anwesenheit.lagertagId, tage),
        or(...anwesende),
      ),
    );
  return new Map(zeilen.map((z) => [zeilenSchluessel(z), z]));
}

type Schreiber = { lagerId: string; personId: string };

export type LeitungEintrag = Feld & {
  personId?: string;
  teilnehmerId?: string;
  wert: AnwesenheitsWert;
  version?: number;
};

// Die Lagerleitung schreibt für alle. Gleicher Wert wie schon eingetragen ist kein Fehler (die Wiederholung einer Anfrage liefert dasselbe), ein anderer Wert braucht die zuletzt gesehene Version (409 VERSION_KONFLIKT). «O» auf ein Feld ohne Zeile schreibt nichts
export async function setzeAlsLeitung(
  tx: Tx,
  k: Schreiber,
  items: LeitungEintrag[],
): Promise<
  | { eintraege: ReturnType<typeof anwesenheitAnsicht>[] }
  | { fehler: "KEIN_MITGLIED" | "FELD_UNBEKANNT" }
> {
  await sperreLager(tx, k.lagerId);
  if (!(await felderStimmen(tx, k.lagerId, items))) {
    return { fehler: "FELD_UNBEKANNT" };
  }
  const personIds = [
    ...new Set(items.flatMap((i) => (i.personId ? [i.personId] : []))),
  ];
  if (personIds.length > 0) {
    const mitglieder = await tx
      .select({ id: lagerMitglied.personId })
      .from(lagerMitglied)
      .where(
        and(
          eq(lagerMitglied.lagerId, k.lagerId),
          inArray(lagerMitglied.personId, personIds),
        ),
      );
    if (mitglieder.length !== personIds.length) {
      return { fehler: "KEIN_MITGLIED" };
    }
  }
  // shortcut: Teilnehmende werden nicht gegen ihre Tabelle geprüft, weil #384 sie erst anlegt; eine fremde ID bleibt in diesem Lager folgenlos, aber unsichtbar falsch. Beim Zusammenführen mit #384 hier prüfen und den Fremdschlüssel (lager_id, id) in einer Migration ergänzen
  const vorhanden = await ladeFelder(tx, k.lagerId, tageVon(items), personIds, [
    ...new Set(items.flatMap((i) => (i.teilnehmerId ? [i.teilnehmerId] : []))),
  ]);
  const ergebnis: ReturnType<typeof anwesenheitAnsicht>[] = [];
  for (const i of items) {
    const alt = vorhanden.get(schluessel(i));
    if (!alt) {
      if (i.wert === "O") continue;
      const neu = await legeZeileAn(tx, anwesenheit, k, {
        personId: i.personId,
        teilnehmerId: i.teilnehmerId,
        lagertagId: i.lagertagId,
        tagesabschnittId: i.tagesabschnittId,
        wert: i.wert,
      });
      ergebnis.push(anwesenheitAnsicht(neu));
    } else if (alt.wert === i.wert) {
      ergebnis.push(anwesenheitAnsicht(alt));
    } else {
      const neu = await aendereZeile(tx, anwesenheit, k, {
        id: alt.id,
        // Version 0 gibt es nie: Wer das Feld als leer sah, bekommt den Konflikt mit dem aktuellen Stand
        version: i.version ?? 0,
        werte: { wert: i.wert },
        ansicht: anwesenheitAnsicht,
      });
      ergebnis.push(anwesenheitAnsicht(neu));
    }
  }
  return { eintraege: ergebnis };
}

const fristVorbei = (frist: Date | null, jetzt: Date) =>
  frist !== null && frist.getTime() <= jetzt.getTime();

// Das Team trägt eigene, offene Felder ein. Ist ein Feld mit einem anderen Wert eingetragen (A oder F) oder die Frist vorbei, schreibt der Aufruf nichts und nennt die gesperrten Felder; ein Feld, das schon den gewünschten Wert hat, ist kein Fehler (eine Wiederholung bleibt folgenlos)
export async function setzeAlsEigene(
  tx: Tx,
  k: Schreiber,
  items: (Feld & { wert: AnwesenheitsWert })[],
  frist: Date | null,
  jetzt = new Date(),
): Promise<
  | { eintraege: ReturnType<typeof anwesenheitAnsicht>[] }
  | { gesperrt: Gesperrt[] }
  | { fehler: "FELD_UNBEKANNT" }
> {
  await sperreLager(tx, k.lagerId);
  if (!(await felderStimmen(tx, k.lagerId, items))) {
    return { fehler: "FELD_UNBEKANNT" };
  }
  const vorhanden = await ladeFelder(tx, k.lagerId, tageVon(items), [
    k.personId,
  ]);
  const eigene = (i: Feld) =>
    vorhanden.get(schluessel({ personId: k.personId, ...i }));
  const gesperrt: Gesperrt[] = [];
  for (const i of items) {
    const aktuell = eigene(i)?.wert ?? "O";
    if (aktuell === i.wert) continue;
    if (aktuell !== "O") {
      gesperrt.push({ ...pick(i), grund: "eingetragen" });
    } else if (fristVorbei(frist, jetzt)) {
      gesperrt.push({ ...pick(i), grund: "frist" });
    }
  }
  if (gesperrt.length > 0) return { gesperrt };

  const ergebnis: ReturnType<typeof anwesenheitAnsicht>[] = [];
  for (const i of items) {
    const alt = eigene(i);
    if (alt?.wert === i.wert) {
      ergebnis.push(anwesenheitAnsicht(alt));
    } else if (i.wert === "O") {
      // Offen auf ein offenes Feld: nichts zu tun
      if (alt) ergebnis.push(anwesenheitAnsicht(alt));
    } else if (alt) {
      // Eine Zeile mit O (von der Lagerleitung geöffnet) wird wieder besetzt
      ergebnis.push(
        anwesenheitAnsicht(
          await aendereZeile(tx, anwesenheit, k, {
            id: alt.id,
            version: alt.version,
            werte: { wert: i.wert },
            ansicht: anwesenheitAnsicht,
          }),
        ),
      );
    } else {
      ergebnis.push(
        anwesenheitAnsicht(
          await legeZeileAn(tx, anwesenheit, k, {
            personId: k.personId,
            lagertagId: i.lagertagId,
            tagesabschnittId: i.tagesabschnittId,
            wert: i.wert,
          }),
        ),
      );
    }
  }
  return { eintraege: ergebnis };
}

export type AnfrageFehler = {
  fehler: "KEINE_ANFRAGE_NOETIG" | "ANFRAGE_OFFEN";
  felder: Feld[];
};
export type FeldFehler = { fehler: "FELD_UNBEKANNT" };

// Anfragen anlegen: eine Zeile je Feld, eine Benachrichtigung für alle Lagerleitungen. Eine Anfrage gibt es nur, wo das Team nicht direkt eintragen kann (Feld eingetragen oder Frist vorbei) und der Wert sich ändert; je Person und Feld höchstens eine offene
export async function legeAnfragenAn(
  tx: Tx,
  k: Schreiber,
  items: (Feld & { wert: AnwesenheitsWert })[],
  notiz: string | undefined,
  frist: Date | null,
  jetzt = new Date(),
): Promise<
  | { anfragen: ReturnType<typeof anfrageAnsicht>[]; zustellung: Zustellung }
  | AnfrageFehler
  | FeldFehler
> {
  await sperreLager(tx, k.lagerId);
  if (!(await felderStimmen(tx, k.lagerId, items))) {
    return { fehler: "FELD_UNBEKANNT" };
  }
  const vorhanden = await ladeFelder(tx, k.lagerId, tageVon(items), [
    k.personId,
  ]);
  const offen = await tx
    .select({
      lagertagId: anwesenheitAnfrage.lagertagId,
      tagesabschnittId: anwesenheitAnfrage.tagesabschnittId,
    })
    .from(anwesenheitAnfrage)
    .where(
      and(
        eq(anwesenheitAnfrage.lagerId, k.lagerId),
        eq(anwesenheitAnfrage.personId, k.personId),
        eq(anwesenheitAnfrage.status, "offen"),
        isNull(anwesenheitAnfrage.geloeschtAm),
        inArray(anwesenheitAnfrage.lagertagId, tageVon(items)),
      ),
    );
  const offenSchluessel = new Set(offen.map(feldSchluessel));
  const unnoetig: Feld[] = [];
  const doppelt: Feld[] = [];
  for (const i of items) {
    const aktuell =
      vorhanden.get(schluessel({ personId: k.personId, ...i }))?.wert ?? "O";
    const direktMoeglich = aktuell === "O" && !fristVorbei(frist, jetzt);
    if (aktuell === i.wert || direktMoeglich) unnoetig.push(pick(i));
    else if (offenSchluessel.has(feldSchluessel(i))) doppelt.push(pick(i));
  }
  if (unnoetig.length > 0) {
    return { fehler: "KEINE_ANFRAGE_NOETIG", felder: unnoetig };
  }
  if (doppelt.length > 0) return { fehler: "ANFRAGE_OFFEN", felder: doppelt };

  const anfragen = [];
  for (const i of items) {
    anfragen.push(
      await legeZeileAn(tx, anwesenheitAnfrage, k, {
        personId: k.personId,
        lagertagId: i.lagertagId,
        tagesabschnittId: i.tagesabschnittId,
        wert: i.wert,
        notiz,
      }),
    );
  }
  const leitung = await tx
    .select({ id: lagerMitglied.personId })
    .from(lagerMitglied)
    .where(
      and(
        eq(lagerMitglied.lagerId, k.lagerId),
        eq(lagerMitglied.rolle, "lagerleitung"),
      ),
    );
  // Eine Benachrichtigung je Aufruf, auch für einen ganzen Tag; der Push nennt weder Person noch Feld
  const zustellung = await benachrichtige(tx, {
    lagerId: k.lagerId,
    empfaengerIds: leitung.map((l) => l.id),
    art: "anwesenheit_anfrage",
    objekt: { typ: "anwesenheit_anfrage", id: anfragen[0]!.id },
    ausgeloestVon: k.personId,
  });
  return { anfragen: anfragen.map(anfrageAnsicht), zustellung };
}

// Die Lagerleitung entscheidet über offene Anfragen. Annehmen setzt das Feld auf den angefragten Wert (auch ohne die Frist und ohne die Sperre des Teams), Ablehnen ändert nur die Anfrage. Jede Anfrage braucht die zuletzt gesehene Version (409 VERSION_KONFLIKT); eine schon entschiedene Anfrage ist 409 BEREITS_ENTSCHIEDEN, eine unbekannte 404. Alles oder nichts
export async function entscheideAnfragen(
  tx: Tx,
  k: Schreiber,
  entscheid: "angenommen" | "abgelehnt",
  items: { id: string; version: number }[],
): Promise<
  | {
      anfragen: ReturnType<typeof anfrageAnsicht>[];
      zustellungen: Zustellung[];
    }
  | { fehler: "BEREITS_ENTSCHIEDEN"; ids: string[] }
> {
  await sperreLager(tx, k.lagerId);
  const zeilen = await tx
    .select()
    .from(anwesenheitAnfrage)
    .where(
      and(
        eq(anwesenheitAnfrage.lagerId, k.lagerId),
        isNull(anwesenheitAnfrage.geloeschtAm),
        inArray(
          anwesenheitAnfrage.id,
          items.map((i) => i.id),
        ),
      ),
    );
  if (zeilen.length !== items.length) throw new HTTPException(404);
  const entschieden = zeilen.filter((z) => z.status !== "offen");
  if (entschieden.length > 0) {
    return { fehler: "BEREITS_ENTSCHIEDEN", ids: entschieden.map((z) => z.id) };
  }
  const nachId = new Map(zeilen.map((z) => [z.id, z]));
  const felder =
    entscheid === "angenommen"
      ? await ladeFelder(
          tx,
          k.lagerId,
          [...new Set(zeilen.map((z) => z.lagertagId))],
          [...new Set(zeilen.map((z) => z.personId))],
        )
      : new Map<string, typeof anwesenheit.$inferSelect>();

  const ergebnis = [];
  for (const i of items) {
    const a = nachId.get(i.id)!;
    ergebnis.push(
      await aendereZeile(tx, anwesenheitAnfrage, k, {
        id: a.id,
        version: i.version,
        werte: {
          status: entscheid,
          entschiedenVon: k.personId,
          entschiedenAm: new Date(),
        },
        ansicht: anfrageAnsicht,
      }),
    );
    if (entscheid !== "angenommen") continue;
    const alt = felder.get(schluessel({ ...a }));
    if (!alt) {
      if (a.wert !== "O") {
        await legeZeileAn(tx, anwesenheit, k, {
          personId: a.personId,
          lagertagId: a.lagertagId,
          tagesabschnittId: a.tagesabschnittId,
          wert: a.wert,
        });
      }
    } else if (alt.wert !== a.wert) {
      await aendereZeile(tx, anwesenheit, k, {
        id: alt.id,
        version: alt.version,
        werte: { wert: a.wert },
        ansicht: anwesenheitAnsicht,
      });
    }
  }

  // Eine Benachrichtigung je anfragende Person; der Push sagt nur, dass entschieden wurde
  const zustellungen: Zustellung[] = [];
  const erste = new Map<string, string>();
  for (const a of ergebnis)
    if (!erste.has(a.personId)) erste.set(a.personId, a.id);
  for (const [personId, anfrageId] of erste) {
    zustellungen.push(
      await benachrichtige(tx, {
        lagerId: k.lagerId,
        empfaengerIds: [personId],
        art: "anwesenheit_entscheid",
        objekt: { typ: "anwesenheit_anfrage", id: anfrageId },
        ausgeloestVon: k.personId,
      }),
    );
  }
  return { anfragen: ergebnis.map(anfrageAnsicht), zustellungen };
}

// Seite der Matrix: eine Abfrage für alle Personen und Abschnitte der gewünschten Lagertage, nach ID geordnet (UUIDv7, also nach Entstehung), der Cursor ist die ID der letzten Zeile
export async function ladeMatrix(
  db: Reader,
  lagerId: string,
  p: { lagertagIds?: string[]; nach?: string; limit: number },
) {
  const zeilen = await db
    .select()
    .from(anwesenheit)
    .where(
      and(
        eq(anwesenheit.lagerId, lagerId),
        isNull(anwesenheit.geloeschtAm),
        p.lagertagIds
          ? inArray(anwesenheit.lagertagId, p.lagertagIds)
          : undefined,
        p.nach ? gt(anwesenheit.id, p.nach) : undefined,
      ),
    )
    .orderBy(asc(anwesenheit.id))
    .limit(p.limit + 1);
  const seite = zeilen.slice(0, p.limit).map(anwesenheitAnsicht);
  return {
    eintraege: seite,
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.id : null,
  };
}

// Für den Schichtplan (#388) und die Tagesseite (#391): wer an diesem Lagertag in welchem Abschnitt anwesend (A) oder abwesend (F) ist. Wer nicht aufgeführt ist, ist offen (O). Eine Abfrage je Aufruf, die Aufrufer fragen je Tag einmal und gruppieren selbst. Gibt nur IDs zurück; die Namen lösen die Aufrufer auf
export async function anwesenheitFuerTag(
  db: Reader,
  lagerId: string,
  lagertagId: string,
) {
  return db
    .select({
      personId: anwesenheit.personId,
      teilnehmerId: anwesenheit.teilnehmerId,
      tagesabschnittId: anwesenheit.tagesabschnittId,
      wert: anwesenheit.wert,
    })
    .from(anwesenheit)
    .where(
      and(
        eq(anwesenheit.lagerId, lagerId),
        eq(anwesenheit.lagertagId, lagertagId),
        isNull(anwesenheit.geloeschtAm),
        sql`${anwesenheit.wert} <> 'O'`,
      ),
    );
}

// Zusammenfassung: wie viele Leitende und Teilnehmende je Lagertag, Abschnitt und Wert eingetragen sind, in einer Abfrage. «Offen» ergibt sich aus der Zahl der Anwesenden minus A und F
export async function ladeZusammenfassung(
  db: Reader,
  lagerId: string,
  // Nur dieser Lagertag (Aggregat «Heute», #395)
  lagertagId?: string,
) {
  return db
    .select({
      lagertagId: anwesenheit.lagertagId,
      tagesabschnittId: anwesenheit.tagesabschnittId,
      wert: anwesenheit.wert,
      leitende:
        sql<number>`count(*) filter (where ${anwesenheit.personId} is not null)`.mapWith(
          Number,
        ),
      teilnehmende:
        sql<number>`count(*) filter (where ${anwesenheit.teilnehmerId} is not null)`.mapWith(
          Number,
        ),
    })
    .from(anwesenheit)
    .where(
      and(
        eq(anwesenheit.lagerId, lagerId),
        isNull(anwesenheit.geloeschtAm),
        lagertagId ? eq(anwesenheit.lagertagId, lagertagId) : undefined,
      ),
    )
    .groupBy(
      anwesenheit.lagertagId,
      anwesenheit.tagesabschnittId,
      anwesenheit.wert,
    )
    .orderBy(
      asc(anwesenheit.lagertagId),
      asc(anwesenheit.tagesabschnittId),
      asc(anwesenheit.wert),
    );
}
