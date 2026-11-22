import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  aufgabe,
  aufgabeCheckpunkt,
  aufgabeLink,
  aufgabeStichwort,
  lagerAenderung,
  ressort,
  user,
} from "../db/schema.js";
import {
  aufgabeAnsicht,
  beteiligt,
  istBeteiligt,
  ladeAufgabeZeile,
  leseUmfang,
  ressortJoin,
} from "./aufgaben.js";
import { registriereOperation } from "./operationen.js";
import { darf, type LagerZugriff } from "./policy.js";
import { linkAendern, linkAnlegen, sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile, type Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Details einer Aufgabe (#373): Checkliste, Links und Stichworte. Checkpunkte und Links sind Zeilen des Sync-Kerns mit eigener Version und eigenem Feed-Eintrag, damit zwei Personen nicht dieselbe Liste überschreiben; die Stichworte sind eine Menge ohne eigene Version (wie die Unterstützung) und zählen die Version der Aufgabe hoch. Die Tabellen sind beim ersten Import dieser Datei im Register angemeldet: Feed für jeden, der Aufgaben lesen darf; der Zeilenfilter lässt dem Team nur die Details der eigenen Aufgaben (wie bei der Aufgabe selbst).
//
// Rechte wie die Aufgabe (lager/aufgaben.ts): Lesen aufgaben.lesen_alle, aufgaben.bearbeiten oder, für eigene Aufgaben, aufgaben.eigene. Schreiben braucht aufgaben.bearbeiten. Einzige Ausnahme: Wer nur aufgaben.eigene hat, darf an einer eigenen Aufgabe Checkpunkte abhaken und wieder öffnen (wie den Status), sonst nichts. Eine fremde Aufgabe ist für diese Rolle unbekannt (404).
for (const tabelle of [aufgabeCheckpunkt, aufgabeLink]) {
  registriereLagerTabelle({
    tabelle,
    recht: ["aufgaben.lesen_alle", "aufgaben.bearbeiten", "aufgaben.eigene"],
    sichtbar: async (db: Db, zugriff: LagerZugriff, ids: string[]) => {
      if (leseUmfang(zugriff) === "alle") return new Set(ids);
      if (ids.length === 0) return new Set<string>();
      const zeilen = await db
        .select({ id: tabelle.id })
        .from(tabelle)
        .innerJoin(
          aufgabe,
          and(
            eq(aufgabe.id, tabelle.aufgabeId),
            eq(aufgabe.lagerId, tabelle.lagerId),
          ),
        )
        .leftJoin(ressort, ressortJoin)
        .where(
          and(
            eq(tabelle.lagerId, zugriff.lager.id),
            inArray(tabelle.id, ids),
            beteiligt(zugriff.personId),
          ),
        );
      return new Set(zeilen.map((z) => z.id));
    },
  });
}

export const MAX_CHECKPUNKTE = 100;
export const MAX_LINKS = 30;
export const MAX_STICHWORTE = 30;

export const checkpunktAnsicht = (
  z: typeof aufgabeCheckpunkt.$inferSelect,
) => ({
  id: z.id,
  version: z.version,
  aufgabeId: z.aufgabeId,
  text: z.text,
  erledigt: z.erledigt,
  erledigtVonPersonId: z.personId,
  reihenfolge: z.reihenfolge,
});
export const aufgabeLinkAnsicht = (z: typeof aufgabeLink.$inferSelect) => ({
  id: z.id,
  version: z.version,
  aufgabeId: z.aufgabeId,
  titel: z.titel,
  url: z.url,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Die Links prüft dasselbe Schema wie die der Ressorts: nur https, ohne Zugangsdaten, nie abgerufen (SR-26)
const version = z.number().int().min(1);
const checkText = z.string().trim().min(1).max(500);
const reihenfolge = z.number().int().min(0).max(100000);
export const checkpunktAnlegen = z.strictObject({
  text: checkText,
  reihenfolge: reihenfolge.optional(),
});
export const checkpunktAendern = z
  .strictObject({
    version,
    text: checkText.optional(),
    erledigt: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const checklisteReihenfolge = z.strictObject({
  eintraege: z
    .array(z.strictObject({ id: z.uuid(), version }))
    .min(1)
    .max(MAX_CHECKPUNKTE)
    .refine((l) => new Set(l.map((e) => e.id)).size === l.length),
});
export { linkAendern, linkAnlegen };
// Ein Stichwort: ein bis 40 Zeichen, ohne Steuer- und Formatzeichen
const stichwort = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((w) => !/[\p{C}]/u.test(w));
export const stichworteSetzen = z.strictObject({
  version,
  stichworte: z
    .array(stichwort)
    .max(MAX_STICHWORTE)
    .refine((l) => new Set(l.map((w) => w.toLowerCase())).size === l.length),
});
export const zusammenfuehren = z.strictObject({
  version,
  mitId: z.uuid(),
  mitVersion: version,
});
export const verlaufAbfrage = z.strictObject({
  // Cursor: die Folgenummer des letzten Eintrags der vorigen Seite
  vor: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type Fehler =
  | "ZU_VIELE_CHECKPUNKTE"
  | "ZU_VIELE_LINKS"
  | "ZU_VIELE_STICHWORTE"
  | "NOTIZ_ZU_LANG"
  | "GLEICHE_AUFGABE";
export const FEHLER_TEXT: Record<Fehler, string> = {
  ZU_VIELE_CHECKPUNKTE: `Eine Checkliste hat höchstens ${MAX_CHECKPUNKTE} Punkte.`,
  ZU_VIELE_LINKS: `Eine Aufgabe hat höchstens ${MAX_LINKS} Links.`,
  ZU_VIELE_STICHWORTE: `Eine Aufgabe hat höchstens ${MAX_STICHWORTE} Stichworte.`,
  NOTIZ_ZU_LANG: "Die Notizen beider Aufgaben sind zusammen zu lang.",
  GLEICHE_AUFGABE: "Eine Aufgabe lässt sich nicht mit sich selbst vereinen.",
};
export type Pruefung = { fehler: Fehler } | undefined;

// Wer mit welchem Recht schreibt: alle (aufgaben.bearbeiten) oder nur an eigenen Aufgaben
type Akteur = { lagerId: string; personId: string };
// mitglied: Hat die Person eine Zeile in lager_mitglied? Die Abteilungsleitung braucht keine; dann steht beim Abhaken keine Person im Punkt (der Fremdschlüssel verlangt ein Mitglied)
export type Schreiber = Akteur & { alle: boolean; mitglied: boolean };

// Die Aufgabe, an der geschrieben wird: im Lager, nicht gelöscht; wer nur «eigene» darf, braucht sie als eigene (sonst 404, dieselbe wie für eine, die es nicht gibt). Unter der Lagersperre, damit die Zahl der Details bis zum Schreiben stimmt
async function ladeAufgabeFuer(
  tx: Tx,
  k: Akteur & { alle: boolean },
  aufgabeId: string,
) {
  await sperreLager(tx, k.lagerId);
  const zeile = await ladeAufgabeZeile(tx, k.lagerId, aufgabeId);
  if (
    !zeile ||
    (!k.alle && !(await istBeteiligt(tx, k.lagerId, aufgabeId, k.personId)))
  ) {
    throw new HTTPException(404);
  }
  return zeile;
}

async function ladeCheckpunkt(
  tx: Pick<Db, "select">,
  lagerId: string,
  aufgabeId: string,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(aufgabeCheckpunkt)
    .where(
      and(
        eq(aufgabeCheckpunkt.id, id),
        eq(aufgabeCheckpunkt.lagerId, lagerId),
        eq(aufgabeCheckpunkt.aufgabeId, aufgabeId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
  return zeile;
}

async function ladeLink(
  tx: Pick<Db, "select">,
  lagerId: string,
  aufgabeId: string,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(aufgabeLink)
    .where(
      and(
        eq(aufgabeLink.id, id),
        eq(aufgabeLink.lagerId, lagerId),
        eq(aufgabeLink.aufgabeId, aufgabeId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
  return zeile;
}

// Anzahl und höchste Stelle der Checkpunkte einer Aufgabe in einer Abfrage
async function checklisteMasse(tx: Pick<Db, "select">, aufgabeId: string) {
  const [zeile] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      ende: sql<number>`coalesce(max(${aufgabeCheckpunkt.reihenfolge}) + 1, 0)`,
    })
    .from(aufgabeCheckpunkt)
    .where(and(eq(aufgabeCheckpunkt.aufgabeId, aufgabeId)));
  return zeile!;
}

export async function legeCheckpunktAn(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  eingabe: z.output<typeof checkpunktAnlegen>,
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  const masse = await checklisteMasse(tx, aufgabeId);
  if (masse.n >= MAX_CHECKPUNKTE) {
    return { fehler: "ZU_VIELE_CHECKPUNKTE" as const };
  }
  const neu = await legeZeileAn(tx, aufgabeCheckpunkt, k, {
    aufgabeId,
    text: eingabe.text,
    reihenfolge: eingabe.reihenfolge ?? masse.ende,
  });
  return { zeile: neu };
}

// Abhaken (erledigt) darf auch, wer nur «eigene» hat und an der Aufgabe beteiligt ist; den Text ändern nur Rollen mit aufgaben.bearbeiten (403, nach der Prüfung, dass die Aufgabe für die Person da ist). Wer abhakt, steht im Punkt; öffnen leert die Person. Ein Punkt, der schon so steht, behält seine Person
export async function aendereCheckpunkt(
  tx: Tx,
  k: Schreiber,
  aufgabeId: string,
  id: string,
  eingabe: z.output<typeof checkpunktAendern>,
) {
  await ladeAufgabeFuer(tx, k, aufgabeId);
  if (!k.alle && eingabe.text !== undefined) throw new HTTPException(403);
  const alt = await ladeCheckpunkt(tx, k.lagerId, aufgabeId, id);
  const { version: v, erledigt, text } = eingabe;
  const wechselt = erledigt !== undefined && erledigt !== alt.erledigt;
  return aendereZeile(tx, aufgabeCheckpunkt, k, {
    id,
    version: v,
    werte: {
      ...(text !== undefined ? { text } : {}),
      ...(wechselt
        ? { erledigt, personId: erledigt && k.mitglied ? k.personId : null }
        : {}),
    },
    ansicht: checkpunktAnsicht,
  });
}

export async function loescheCheckpunkt(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  id: string,
  v: number,
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  await ladeCheckpunkt(tx, k.lagerId, aufgabeId, id);
  await loescheZeile(tx, aufgabeCheckpunkt, k, {
    id,
    version: v,
    ansicht: checkpunktAnsicht,
  });
}

// Die Stelle in der Liste ist die neue Reihenfolge; was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag). Die App schickt die Liste so, wie sie sie zeigt; fehlende Punkte behalten ihre Stelle
export async function sortiereCheckliste(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  eintraege: { id: string; version: number }[],
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  const vorhanden = await tx
    .select({
      id: aufgabeCheckpunkt.id,
      reihenfolge: aufgabeCheckpunkt.reihenfolge,
    })
    .from(aufgabeCheckpunkt)
    .where(and(eq(aufgabeCheckpunkt.aufgabeId, aufgabeId)));
  const nachId = new Map(vorhanden.map((z) => [z.id, z]));
  if (eintraege.some((e) => !nachId.has(e.id))) throw new HTTPException(404);
  for (const [stelle, e] of eintraege.entries()) {
    if (nachId.get(e.id)!.reihenfolge === stelle) continue;
    await aendereZeile(tx, aufgabeCheckpunkt, k, {
      id: e.id,
      version: e.version,
      werte: { reihenfolge: stelle },
      ansicht: checkpunktAnsicht,
    });
  }
}

export async function legeLinkAn(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  eingabe: z.output<typeof linkAnlegen>,
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  const [masse] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(aufgabeLink)
    .where(and(eq(aufgabeLink.aufgabeId, aufgabeId)));
  if (masse!.n >= MAX_LINKS) return { fehler: "ZU_VIELE_LINKS" as const };
  return {
    zeile: await legeZeileAn(tx, aufgabeLink, k, { aufgabeId, ...eingabe }),
  };
}

export async function aendereLink(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  id: string,
  eingabe: z.output<typeof linkAendern>,
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  await ladeLink(tx, k.lagerId, aufgabeId, id);
  const { version: v, ...werte } = eingabe;
  return aendereZeile(tx, aufgabeLink, k, {
    id,
    version: v,
    werte,
    ansicht: aufgabeLinkAnsicht,
  });
}

export async function loescheLink(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  id: string,
  v: number,
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  await ladeLink(tx, k.lagerId, aufgabeId, id);
  await loescheZeile(tx, aufgabeLink, k, {
    id,
    version: v,
    ansicht: aufgabeLinkAnsicht,
  });
}

// Setzt die Stichworte auf genau diese Liste. Die Aufgabe zählt dabei ihre Version hoch (Versionsprüfung, Feed-Eintrag); geschrieben werden nur die Unterschiede
export async function setzeStichworte(
  tx: Tx,
  k: Akteur,
  aufgabeId: string,
  v: number,
  liste: string[],
) {
  await ladeAufgabeFuer(tx, { ...k, alle: true }, aufgabeId);
  const neu = await aendereZeile(tx, aufgabe, k, {
    id: aufgabeId,
    version: v,
    werte: {},
    ansicht: aufgabeAnsicht,
  });
  const ist = (
    await tx
      .select({ w: aufgabeStichwort.stichwort })
      .from(aufgabeStichwort)
      .where(eq(aufgabeStichwort.aufgabeId, aufgabeId))
  ).map((z) => z.w);
  const soll = new Set(liste);
  const weg = ist.filter((w) => !soll.has(w));
  const da = new Set(ist);
  const dazu = liste.filter((w) => !da.has(w));
  if (weg.length > 0) {
    await tx
      .delete(aufgabeStichwort)
      .where(
        and(
          eq(aufgabeStichwort.aufgabeId, aufgabeId),
          inArray(aufgabeStichwort.stichwort, weg),
        ),
      );
  }
  if (dazu.length > 0) {
    await tx
      .insert(aufgabeStichwort)
      .values(
        dazu.map((w) => ({ lagerId: k.lagerId, aufgabeId, stichwort: w })),
      );
  }
  return neu;
}

type PersonKurz = { id: string; name: string | null; ceviName: string | null };
export type Details = {
  aufgabeId: string;
  checkliste: (ReturnType<typeof checkpunktAnsicht> & {
    erledigtVon: PersonKurz | null;
  })[];
  links: ReturnType<typeof aufgabeLinkAnsicht>[];
  stichworte: string[];
};

// Alle Details einer Aufgabe in drei Abfragen (Checkliste mit dem Namen dessen, der abgehakt hat; Links; Stichworte). Höchstens 100 Punkte, 30 Links und 30 Stichworte, darum ohne Seitenwechsel. Die Rolle prüft der Aufrufer vorher
export async function ladeDetails(
  db: Pick<Db, "select">,
  lagerId: string,
  aufgabeId: string,
): Promise<Details> {
  const [checkpunkte, links, stichworte] = await Promise.all([
    db
      .select({
        zeile: aufgabeCheckpunkt,
        name: user.name,
        ceviName: user.ceviName,
      })
      .from(aufgabeCheckpunkt)
      .leftJoin(user, eq(user.id, aufgabeCheckpunkt.personId))
      .where(
        and(
          eq(aufgabeCheckpunkt.lagerId, lagerId),
          eq(aufgabeCheckpunkt.aufgabeId, aufgabeId),
        ),
      )
      .orderBy(asc(aufgabeCheckpunkt.reihenfolge), asc(aufgabeCheckpunkt.id)),
    db
      .select()
      .from(aufgabeLink)
      .where(
        and(
          eq(aufgabeLink.lagerId, lagerId),
          eq(aufgabeLink.aufgabeId, aufgabeId),
        ),
      )
      .orderBy(asc(aufgabeLink.id)),
    db
      .select({ w: aufgabeStichwort.stichwort })
      .from(aufgabeStichwort)
      .where(
        and(
          eq(aufgabeStichwort.lagerId, lagerId),
          eq(aufgabeStichwort.aufgabeId, aufgabeId),
        ),
      )
      .orderBy(sql`lower(${aufgabeStichwort.stichwort})`),
  ]);
  return {
    aufgabeId,
    checkliste: checkpunkte.map((c) => ({
      ...checkpunktAnsicht(c.zeile),
      erledigtVon: c.zeile.personId
        ? { id: c.zeile.personId, name: c.name, ceviName: c.ceviName }
        : null,
    })),
    links: links.map(aufgabeLinkAnsicht),
    stichworte: stichworte.map((s) => s.w),
  };
}

// Verlauf einer Aufgabe (#373): Was der Änderungsfeed über die Aufgabe, ihre Checkpunkte und Links festhält (Art, Version, Zeitpunkt), neueste zuerst, dazu wer die Aufgabe angelegt und zuletzt geändert hat. Der Feed hält Einträge 30 Tage (A11), ältere Änderungen fehlen; er speichert weder Inhalte noch Personen. Revisionen mit Inhalt gibt es nicht (Entscheid 22.11.2026)
// shortcut: Der Feed hat keinen Index auf die Zeile; die Abfrage liest die Folgenummern des Lagers der letzten 30 Tage von hinten. Bei sehr aktiven Lagern einen Index (lager_id, zeile_id) auf lager_aenderung ergänzen
export async function ladeVerlauf(
  db: Pick<Db, "select">,
  lagerId: string,
  aufgabeId: string,
  p: { vor?: number; limit: number },
) {
  const kinder = (t: typeof aufgabeCheckpunkt | typeof aufgabeLink) =>
    sql`select ${t.id} from ${t} where ${t.lagerId} = ${lagerId} and ${t.aufgabeId} = ${aufgabeId}`;
  const zeilen = await db
    .select({
      seq: lagerAenderung.seq,
      tabelle: lagerAenderung.tabelle,
      id: lagerAenderung.zeileId,
      art: lagerAenderung.art,
      version: lagerAenderung.version,
      zeitpunkt: lagerAenderung.zeitpunkt,
    })
    .from(lagerAenderung)
    .where(
      and(
        eq(lagerAenderung.lagerId, lagerId),
        p.vor ? lt(lagerAenderung.seq, p.vor) : undefined,
        sql`((${lagerAenderung.tabelle} = 'aufgabe' and ${lagerAenderung.zeileId} = ${aufgabeId})
          or (${lagerAenderung.tabelle} = 'aufgabe_checkpunkt' and ${lagerAenderung.zeileId} in (${kinder(aufgabeCheckpunkt)}))
          or (${lagerAenderung.tabelle} = 'aufgabe_link' and ${lagerAenderung.zeileId} in (${kinder(aufgabeLink)})))`,
      ),
    )
    .orderBy(desc(lagerAenderung.seq))
    .limit(p.limit + 1);
  const seite = zeilen.slice(0, p.limit);
  return {
    eintraege: seite.map((z) => ({
      seq: z.seq,
      objekttyp: z.tabelle,
      id: z.id,
      art: z.art,
      version: z.version,
      zeitpunkt: z.zeitpunkt,
    })),
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.seq : null,
  };
}

// Wer die Aufgabe angelegt und zuletzt geändert hat (zwei Namen in einer Abfrage)
export async function ladeUrheber(
  db: Pick<Db, "select">,
  lagerId: string,
  aufgabeId: string,
) {
  const ersteller = alias(user, "ersteller");
  const aenderer = alias(user, "aenderer");
  const [z] = await db
    .select({
      erstelltAm: aufgabe.erstelltAm,
      erstelltVon: aufgabe.erstelltVon,
      eName: ersteller.name,
      eCevi: ersteller.ceviName,
      geaendertAm: aufgabe.geaendertAm,
      geaendertVon: aufgabe.geaendertVon,
      gName: aenderer.name,
      gCevi: aenderer.ceviName,
    })
    .from(aufgabe)
    .leftJoin(ersteller, eq(ersteller.id, aufgabe.erstelltVon))
    .leftJoin(aenderer, eq(aenderer.id, aufgabe.geaendertVon))
    .where(and(eq(aufgabe.id, aufgabeId), eq(aufgabe.lagerId, lagerId)));
  if (!z) throw new HTTPException(404);
  return {
    erstelltAm: z.erstelltAm,
    erstelltVon: z.erstelltVon
      ? { id: z.erstelltVon, name: z.eName, ceviName: z.eCevi }
      : null,
    geaendertAm: z.geaendertAm,
    geaendertVon: z.geaendertVon
      ? { id: z.geaendertVon, name: z.gName, ceviName: z.gCevi }
      : null,
  };
}

// Die Aufgabe darf diese Rolle lesen: alle oder nur die eigenen (404, wenn nicht)
export async function pruefeLeseZugriff(
  db: Pick<Db, "select">,
  zugriff: LagerZugriff,
  aufgabeId: string,
) {
  const umfang = leseUmfang(zugriff);
  if (!umfang) throw new HTTPException(403);
  const zeile = await ladeAufgabeZeile(db, zugriff.lager.id, aufgabeId);
  if (
    !zeile ||
    (umfang === "eigene" &&
      !(await istBeteiligt(db, zugriff.lager.id, aufgabeId, zugriff.personId)))
  ) {
    throw new HTTPException(404);
  }
  return zeile;
}

// Operationen der Warteschlange (#367): dieselben Schreibwege wie die Routen mit denselben Rechten. Eine Prüfung, die die Route mit 400 beantwortet, lehnt die Operation ab
const schreibe = <T extends { id: string; version: number }>(
  e: { fehler: Fehler } | { zeile: T },
) => {
  if ("fehler" in e) throw new HTTPException(400);
  return { id: e.zeile.id, version: e.zeile.version };
};
const aufgabeUuid = z.uuid();
registriereOperation({
  typ: "checkpunkt.anlegen",
  recht: "aufgaben.bearbeiten",
  schema: z.strictObject({
    aufgabeId: aufgabeUuid,
    ...checkpunktAnlegen.shape,
  }),
  fuehreAus: async ({ tx, zugriff, person }, { aufgabeId: a, ...n }) =>
    schreibe(
      await legeCheckpunktAn(
        tx,
        { lagerId: zugriff.lager.id, personId: person.id },
        a,
        n,
      ),
    ),
});
registriereOperation({
  typ: "checkpunkt.aendern",
  recht: "aufgaben.bearbeiten",
  schema: z
    .strictObject({
      aufgabeId: aufgabeUuid,
      id: z.uuid(),
      version,
      text: checkText.optional(),
      erledigt: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 3),
  fuehreAus: async ({ tx, zugriff, person }, { aufgabeId: a, id, ...n }) => {
    const z = await aendereCheckpunkt(
      tx,
      {
        lagerId: zugriff.lager.id,
        personId: person.id,
        alle: true,
        mitglied: zugriff.mitglied,
      },
      a,
      id,
      n,
    );
    return { id: z.id, version: z.version };
  },
});
// Das Recht «eigene» genügt für eine eigene Aufgabe; wer aufgaben.bearbeiten hat, hakt an jeder ab
registriereOperation({
  typ: "checkpunkt.abhaken",
  recht: "aufgaben.eigene",
  schema: z.strictObject({
    aufgabeId: aufgabeUuid,
    id: z.uuid(),
    version,
    erledigt: z.boolean(),
  }),
  fuehreAus: async ({ tx, zugriff, person }, { aufgabeId: a, id, ...n }) => {
    const z = await aendereCheckpunkt(
      tx,
      {
        lagerId: zugriff.lager.id,
        personId: person.id,
        alle: darf(zugriff, "aufgaben.bearbeiten"),
        mitglied: zugriff.mitglied,
      },
      a,
      id,
      n,
    );
    return { id: z.id, version: z.version };
  },
});
registriereOperation({
  typ: "checkpunkt.loeschen",
  recht: "aufgaben.bearbeiten",
  schema: z.strictObject({ aufgabeId: aufgabeUuid, id: z.uuid(), version }),
  fuehreAus: async ({ tx, zugriff, person }, n) => {
    await loescheCheckpunkt(
      tx,
      { lagerId: zugriff.lager.id, personId: person.id },
      n.aufgabeId,
      n.id,
      n.version,
    );
    return { id: n.id };
  },
});
registriereOperation({
  typ: "aufgabe_link.anlegen",
  recht: "aufgaben.bearbeiten",
  schema: z.strictObject({ aufgabeId: aufgabeUuid, ...linkAnlegen.shape }),
  fuehreAus: async ({ tx, zugriff, person }, { aufgabeId: a, ...n }) =>
    schreibe(
      await legeLinkAn(
        tx,
        { lagerId: zugriff.lager.id, personId: person.id },
        a,
        n,
      ),
    ),
});
registriereOperation({
  typ: "aufgabe_link.aendern",
  recht: "aufgaben.bearbeiten",
  schema: z
    .strictObject({
      aufgabeId: aufgabeUuid,
      id: z.uuid(),
      version,
      titel: linkAnlegen.shape.titel.optional(),
      url: linkAnlegen.shape.url.optional(),
    })
    .refine((b) => Object.keys(b).length > 3),
  fuehreAus: async ({ tx, zugriff, person }, { aufgabeId: a, id, ...n }) => {
    const z = await aendereLink(
      tx,
      { lagerId: zugriff.lager.id, personId: person.id },
      a,
      id,
      n,
    );
    return { id: z.id, version: z.version };
  },
});
registriereOperation({
  typ: "aufgabe_link.loeschen",
  recht: "aufgaben.bearbeiten",
  schema: z.strictObject({ aufgabeId: aufgabeUuid, id: z.uuid(), version }),
  fuehreAus: async ({ tx, zugriff, person }, n) => {
    await loescheLink(
      tx,
      { lagerId: zugriff.lager.id, personId: person.id },
      n.aufgabeId,
      n.id,
      n.version,
    );
    return { id: n.id };
  },
});
registriereOperation({
  typ: "aufgabe.stichworte",
  recht: "aufgaben.bearbeiten",
  schema: z.strictObject({ aufgabeId: aufgabeUuid, ...stichworteSetzen.shape }),
  fuehreAus: async ({ tx, zugriff, person }, n) => {
    const z = await setzeStichworte(
      tx,
      { lagerId: zugriff.lager.id, personId: person.id },
      n.aufgabeId,
      n.version,
      n.stichworte,
    );
    return { id: z.id, version: z.version };
  },
});
registriereOperation({
  typ: "checkpunkt.reihenfolge",
  recht: "aufgaben.bearbeiten",
  schema: z.strictObject({
    aufgabeId: aufgabeUuid,
    ...checklisteReihenfolge.shape,
  }),
  fuehreAus: async ({ tx, zugriff, person }, n) => {
    await sortiereCheckliste(
      tx,
      { lagerId: zugriff.lager.id, personId: person.id },
      n.aufgabeId,
      n.eintraege,
    );
    return { id: n.aufgabeId };
  },
});
