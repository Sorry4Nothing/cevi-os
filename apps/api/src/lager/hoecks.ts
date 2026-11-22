import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  aufgabe,
  HOECK_ART,
  hoeck,
  hoeckAnwesenheit,
  lagerMitglied,
  ressort,
  TRAKTANDUM_STATUS,
  traktandum,
  traktandumVerantwortlich,
  user,
} from "../db/schema.js";
import { leseUmfang as aufgabenUmfang } from "./aufgaben.js";
import { darf, type LagerZugriff } from "./policy.js";
import { httpsAdresse, sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile, type Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Höcks, Traktanden und Höck-Modus des Lagers (#378): Ansichten, Eingabeschemas, Abfragen und die Schreibwege. Die Tabellen hoeck und traktandum sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet.
//
// Rechte (lager/rechte-katalog.ts):
//   hoecks.lesen_alle   alle Höcks und Traktanden lesen (Höck-Modus, Entscheide-Sammlung)
//   hoecks.team_lesen   nur Höcks der Art «team» lesen, und von diesen nur Datum, Zeit, Titel und Ort
//   hoecks.bearbeiten   Höcks, Traktanden und Anwesenheit ändern (wer das darf, liest auch alle)
// Ein Höck der Lagerleitung ist für die Rolle mit nur «team_lesen» unbekannt (404, dieselbe Antwort wie für einen Höck, den es nicht gibt).
//
// Das Protokoll eines Höcks liegt als Verknüpfung auf eine Datei im SharePoint (#379); hier steht nur der kurze Entscheid je Traktandum. Die Spalte hoeck.protokoll_id ist vorbereitet und über die API noch nicht setzbar.

export const hoeckLeseRechte = [
  "hoecks.lesen_alle",
  "hoecks.bearbeiten",
  "hoecks.team_lesen",
] as const;
export const hoeckAlleRechte = [
  "hoecks.lesen_alle",
  "hoecks.bearbeiten",
] as const;

// Wie viel die Rolle von den Höcks lesen darf: alles, nur die Team-Höcks (reduziert) oder nichts (undefined)
export function hoeckUmfang(
  zugriff: Pick<LagerZugriff, "rolle"> & Partial<Pick<LagerZugriff, "rechte">>,
) {
  if (
    darf(zugriff, "hoecks.lesen_alle") ||
    darf(zugriff, "hoecks.bearbeiten")
  ) {
    return "alle" as const;
  }
  return darf(zugriff, "hoecks.team_lesen") ? ("team" as const) : undefined;
}

// Zeilenfilter des Feeds: Wer nicht alle Höcks lesen darf, sieht nur die der Art «team». Beurteilt auch gelöschte Zeilen
registriereLagerTabelle({
  tabelle: hoeck,
  recht: hoeckLeseRechte,
  sichtbar: async (db, zugriff, ids) => {
    if (hoeckUmfang(zugriff) === "alle") return new Set(ids);
    if (ids.length === 0) return new Set<string>();
    const zeilen = await db
      .select({ id: hoeck.id })
      .from(hoeck)
      .where(
        and(
          eq(hoeck.lagerId, zugriff.lager.id),
          inArray(hoeck.id, ids),
          eq(hoeck.art, "team"),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});
registriereLagerTabelle({ tabelle: traktandum, recht: hoeckAlleRechte });

export const hoeckAktiv = isNull(hoeck.geloeschtAm);
export const traktandumAktiv = isNull(traktandum.geloeschtAm);

export type HoeckZeile = typeof hoeck.$inferSelect;
export type TraktandumZeile = typeof traktandum.$inferSelect;

// Ansichten für die Antwort und die Konfliktantwort des Sync-Kerns: nur die Spalten der Route, nie die ganze Zeile
export const hoeckAnsicht = (h: HoeckZeile) => ({
  id: h.id,
  version: h.version,
  art: h.art,
  datum: h.datum,
  zeit: h.zeit,
  titel: h.titel,
  ort: h.ort,
  gaeste: h.gaeste,
  protokollId: h.protokollId,
});
// Das Team sieht von einem Team-Höck nur, wann, was und wo
export const hoeckTeamAnsicht = (
  h: Pick<HoeckZeile, "id" | "version" | "datum" | "zeit" | "titel" | "ort">,
) => ({
  id: h.id,
  version: h.version,
  datum: h.datum,
  zeit: h.zeit,
  titel: h.titel,
  ort: h.ort,
});
export const traktandumAnsicht = (t: TraktandumZeile) => ({
  id: t.id,
  version: t.version,
  hoeckId: t.hoeckId,
  titel: t.titel,
  text: t.text,
  entscheid: t.entscheid,
  links: t.links,
  reihenfolge: t.reihenfolge,
  aufgabeId: t.aufgabeId,
  status: t.status,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). protokollId setzt nur #379
const version = z.number().int().min(1);
const datum = z.iso.date().refine((wert) => !wert.startsWith("0000"));
const zeit = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const titel = z.string().trim().min(1).max(200);
const ort = z.string().trim().min(1).max(200).nullable();
const gaeste = z.string().trim().min(1).max(500).nullable();
const text = z.string().trim().min(1).max(5000).nullable();
const entscheid = z.string().trim().min(1).max(1000).nullable();
const hoeckFelder = {
  art: z.enum(HOECK_ART),
  datum,
  zeit: zeit.nullable(),
  ort,
  gaeste,
};
export const hoeckAnlegen = z.strictObject({
  titel,
  art: hoeckFelder.art,
  datum,
  zeit: hoeckFelder.zeit.optional(),
  ort: ort.optional(),
  gaeste: gaeste.optional(),
});
export const hoeckAendern = z
  .strictObject({
    version,
    titel: titel.optional(),
    art: hoeckFelder.art.optional(),
    datum: datum.optional(),
    zeit: hoeckFelder.zeit.optional(),
    ort: ort.optional(),
    gaeste: gaeste.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});
export const hoeckAbfrage = z.strictObject({
  // Cursor: die ID des letzten Höcks der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  von: datum.optional(),
  bis: datum.optional(),
});
export const entscheideAbfrage = z.strictObject({
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const links = z.array(z.strictObject({ titel, url: httpsAdresse })).max(10);
const personen = z
  .array(z.uuid())
  .max(50)
  .refine((l) => new Set(l).size === l.length);
const traktandumFelder = {
  hoeckId: z.uuid().nullable(),
  text,
  entscheid,
  links,
  verantwortlichePersonIds: personen,
  aufgabeId: z.uuid().nullable(),
  status: z.enum(TRAKTANDUM_STATUS),
  reihenfolge: z.number().int().min(0).max(100000),
};
const optional = Object.fromEntries(
  Object.entries(traktandumFelder).map(([k, f]) => [k, f.optional()]),
) as {
  [K in keyof typeof traktandumFelder]: z.ZodOptional<
    (typeof traktandumFelder)[K]
  >;
};
export const traktandumAnlegen = z.strictObject({ titel, ...optional });
export const traktandumAendern = z
  .strictObject({ version, titel: titel.optional(), ...optional })
  .refine((b) => Object.keys(b).length > 1);
export const traktandumReihenfolge = z.strictObject({
  // null: die Punkte für den nächsten Höck
  hoeckId: z.uuid().nullable(),
  eintraege: z
    .array(z.strictObject({ id: z.uuid(), version }))
    .min(1)
    .max(200)
    .refine((l) => new Set(l.map((e) => e.id)).size === l.length),
});
export const traktandenUebernehmen = z.strictObject({
  // Ohne Angabe alle offenen Punkte für den nächsten Höck
  traktandumIds: z.array(z.uuid()).min(1).max(200).optional(),
});

type PersonKurz = { id: string; name: string | null; ceviName: string | null };

// Ein JSON-Wert aus einer Unterabfrage: Der Treiber liefert ihn als Text, die Abfrage dekodiert ihn selbst
const jsonListe = <T>(abfrage: SQL) =>
  sql<T[]>`coalesce((${abfrage}), '[]'::json)`.mapWith(
    (w) => (typeof w === "string" ? JSON.parse(w) : w) as T[],
  );

// Die Unterabfragen laufen als Teil der Hauptabfrage: keine Abfrage je Zeile
const anwesende = () =>
  jsonListe<PersonKurz>(
    sql`select json_agg(json_build_object('id', ${user.id}, 'name', ${user.name}, 'ceviName', ${user.ceviName}) order by ${user.name}, ${user.id}) from ${hoeckAnwesenheit} inner join ${user} on ${user.id} = ${hoeckAnwesenheit.personId} where ${hoeckAnwesenheit.hoeckId} = ${hoeck.id}`,
  );
const verantwortliche = () =>
  jsonListe<PersonKurz>(
    sql`select json_agg(json_build_object('id', ${user.id}, 'name', ${user.name}, 'ceviName', ${user.ceviName}) order by ${user.name}, ${user.id}) from ${traktandumVerantwortlich} inner join ${user} on ${user.id} = ${traktandumVerantwortlich.personId} where ${traktandumVerantwortlich.traktandumId} = ${traktandum.id}`,
  );

const zaehle = (abfrage: SQL) => sql<number>`(${abfrage})`.mapWith(Number);

export type HoeckListeEintrag = ReturnType<typeof hoeckAnsicht> & {
  anzahlTraktanden: number;
  anzahlAnwesende: number;
};

// Eine Seite Höcks in einer Abfrage, nach Datum und ID. Wer nur Team-Höcks lesen darf (umfang «team»), bekommt nur diese und nur Datum, Zeit, Titel und Ort. Die Zahlen kommen als Unterabfragen derselben Abfrage
export async function ladeHoecks(
  db: Pick<Db, "select">,
  lagerId: string,
  umfang: "alle" | "team",
  p: { nach?: string; limit?: number; von?: string; bis?: string },
): Promise<{
  hoecks: (HoeckListeEintrag | ReturnType<typeof hoeckTeamAnsicht>)[];
  naechster: string | null;
}> {
  const limit = p.limit ?? 100;
  const zeilen = await db
    .select({
      zeile: hoeck,
      // Die Unterabfragen stehen in einem eigenen sql: In einer Abfrage mit nur einer Tabelle lässt drizzle die Tabellennamen vor den Spalten weg, und «hoeck_id = id» meinte dann die Spalten der Unterabfrage selbst
      anzahlTraktanden: zaehle(
        sql`select count(*) from ${traktandum} where ${traktandum.hoeckId} = ${hoeck.id} and ${traktandum.lagerId} = ${hoeck.lagerId} and ${traktandumAktiv}`,
      ),
      anzahlAnwesende: zaehle(
        sql`select count(*) from ${hoeckAnwesenheit} where ${hoeckAnwesenheit.hoeckId} = ${hoeck.id}`,
      ),
    })
    .from(hoeck)
    .where(
      and(
        eq(hoeck.lagerId, lagerId),
        hoeckAktiv,
        umfang === "team" ? eq(hoeck.art, "team") : undefined,
        p.von ? sql`${hoeck.datum} >= ${p.von}` : undefined,
        p.bis ? sql`${hoeck.datum} <= ${p.bis}` : undefined,
        p.nach
          ? sql`(${hoeck.datum}, ${hoeck.id}) > (select h.datum, h.id from hoeck h where h.id = ${p.nach} and h.lager_id = ${lagerId})`
          : undefined,
      ),
    )
    .orderBy(asc(hoeck.datum), asc(hoeck.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  return {
    hoecks: seite.map((z) =>
      umfang === "team"
        ? hoeckTeamAnsicht(z.zeile)
        : {
            ...hoeckAnsicht(z.zeile),
            anzahlTraktanden: z.anzahlTraktanden,
            anzahlAnwesende: z.anzahlAnwesende,
          },
    ),
    naechster: zeilen.length > limit ? seite[limit - 1]!.zeile.id : null,
  };
}

export type TraktandumAntwort = ReturnType<typeof traktandumAnsicht> & {
  verantwortliche: PersonKurz[];
};

// Traktanden eines Höcks (hoeckId) oder die Punkte für den nächsten Höck (null) in einer Abfrage, nach Reihenfolge und ID
export async function ladeTraktanden(
  db: Pick<Db, "select">,
  lagerId: string,
  p: { hoeckId?: string | null; id?: string; limit?: number },
): Promise<TraktandumAntwort[]> {
  const zeilen = await db
    .select({ zeile: traktandum, verantwortliche: verantwortliche() })
    .from(traktandum)
    .where(
      and(
        eq(traktandum.lagerId, lagerId),
        traktandumAktiv,
        p.id ? eq(traktandum.id, p.id) : undefined,
        p.hoeckId === undefined
          ? undefined
          : p.hoeckId === null
            ? isNull(traktandum.hoeckId)
            : eq(traktandum.hoeckId, p.hoeckId),
      ),
    )
    .orderBy(asc(traktandum.reihenfolge), asc(traktandum.id))
    .limit(p.limit ?? 500);
  return zeilen.map((z) => ({
    ...traktandumAnsicht(z.zeile),
    verantwortliche: z.verantwortliche,
  }));
}

export async function ladeTraktandum(
  db: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  return (await ladeTraktanden(db, lagerId, { id }))[0];
}

// Ein Höck mit seinen Traktanden in zwei Abfragen: der Höck mit den Anwesenden (Unterabfrage), dann alle Traktanden mit Verantwortlichen. Für die Rolle mit nur «team» ist es eine Abfrage und nur die Team-Ansicht. undefined: gibt es nicht (oder ist für die Rolle unbekannt)
export async function ladeHoeck(
  db: Pick<Db, "select">,
  lagerId: string,
  id: string,
  umfang: "alle" | "team",
) {
  const [zeile] = await db
    .select({ zeile: hoeck, anwesende: anwesende() })
    .from(hoeck)
    .where(
      and(
        eq(hoeck.id, id),
        eq(hoeck.lagerId, lagerId),
        hoeckAktiv,
        umfang === "team" ? eq(hoeck.art, "team") : undefined,
      ),
    );
  if (!zeile) return undefined;
  if (umfang === "team") return hoeckTeamAnsicht(zeile.zeile);
  return {
    ...hoeckAnsicht(zeile.zeile),
    anwesende: zeile.anwesende,
    traktanden: await ladeTraktanden(db, lagerId, { hoeckId: id }),
  };
}

// Die Rohzeile für Schreibwege; undefined: gibt es im Lager nicht (mehr)
export async function ladeHoeckZeile(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(hoeck)
    .where(and(eq(hoeck.id, id), eq(hoeck.lagerId, lagerId), hoeckAktiv));
  return zeile;
}
export async function ladeTraktandumZeile(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(traktandum)
    .where(
      and(
        eq(traktandum.id, id),
        eq(traktandum.lagerId, lagerId),
        traktandumAktiv,
      ),
    );
  return zeile;
}

type Akteur = { lagerId: string; personId: string };

export async function legeHoeckAn(
  tx: Tx,
  k: Akteur,
  eingabe: z.output<typeof hoeckAnlegen>,
) {
  await sperreLager(tx, k.lagerId);
  return legeZeileAn(tx, hoeck, k, eingabe);
}

export async function aendereHoeck(
  tx: Tx,
  k: Akteur,
  id: string,
  eingabe: z.output<typeof hoeckAendern>,
) {
  const { version: erwartet, ...werte } = eingabe;
  await sperreLager(tx, k.lagerId);
  if (!(await ladeHoeckZeile(tx, k.lagerId, id))) {
    throw new HTTPException(404);
  }
  return aendereZeile(tx, hoeck, k, {
    id,
    version: erwartet,
    werte,
    ansicht: hoeckAnsicht,
  });
}

// Ein Höck mit Traktanden lässt sich nicht löschen (409 HOECK_HAT_TRAKTANDEN): Entscheide gehen nie als Nebenwirkung verloren. Die Traktanden zuerst auf den nächsten Höck schieben oder löschen
export async function loescheHoeck(
  tx: Tx,
  k: Akteur,
  id: string,
  erwartet: number,
): Promise<{ fehler: "HOECK_HAT_TRAKTANDEN" } | undefined> {
  await sperreLager(tx, k.lagerId);
  if (!(await ladeHoeckZeile(tx, k.lagerId, id))) {
    throw new HTTPException(404);
  }
  const [n] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(traktandum)
    .where(
      and(
        eq(traktandum.lagerId, k.lagerId),
        eq(traktandum.hoeckId, id),
        traktandumAktiv,
      ),
    );
  if (n!.n > 0) return { fehler: "HOECK_HAT_TRAKTANDEN" };
  await loescheZeile(tx, hoeck, k, {
    id,
    version: erwartet,
    ansicht: hoeckAnsicht,
  });
  return undefined;
}

export type Pruefung =
  | {
      fehler: "KEIN_MITGLIED" | "HOECK_UNBEKANNT" | "AUFGABE_UNBEKANNT";
    }
  | undefined;

// Verantwortliche sind Mitglieder dieses Lagers, Höck und Aufgabe gibt es in diesem Lager und sind nicht gelöscht (Ziele aus der Anfrage sind nie ein Nachweis, SR-11). Die Fremdschlüssel halten dasselbe noch einmal fest
export async function pruefeTraktandumWerte(
  tx: Pick<Db, "select">,
  lagerId: string,
  werte: {
    hoeckId?: string | null;
    aufgabeId?: string | null;
    verantwortlichePersonIds?: string[];
  },
): Promise<Pruefung> {
  const gesucht = werte.verantwortlichePersonIds ?? [];
  if (gesucht.length > 0) {
    const gefunden = await tx
      .select({ id: lagerMitglied.personId })
      .from(lagerMitglied)
      .where(
        and(
          eq(lagerMitglied.lagerId, lagerId),
          inArray(lagerMitglied.personId, gesucht),
        ),
      );
    if (gefunden.length !== gesucht.length) return { fehler: "KEIN_MITGLIED" };
  }
  if (typeof werte.hoeckId === "string") {
    if (!(await ladeHoeckZeile(tx, lagerId, werte.hoeckId))) {
      return { fehler: "HOECK_UNBEKANNT" };
    }
  }
  if (typeof werte.aufgabeId === "string") {
    const [a] = await tx
      .select({ id: aufgabe.id })
      .from(aufgabe)
      .where(
        and(
          eq(aufgabe.id, werte.aufgabeId),
          eq(aufgabe.lagerId, lagerId),
          isNull(aufgabe.geloeschtAm),
        ),
      );
    if (!a) return { fehler: "AUFGABE_UNBEKANNT" };
  }
  return undefined;
}

// Setzt die Verantwortlichen auf genau diese Personen (nur die Unterschiede werden geschrieben)
async function setzeVerantwortliche(
  tx: Tx,
  lagerId: string,
  traktandumId: string,
  personIds: string[],
) {
  const soll = new Set(personIds);
  const ist = await tx
    .select({ id: traktandumVerantwortlich.personId })
    .from(traktandumVerantwortlich)
    .where(eq(traktandumVerantwortlich.traktandumId, traktandumId));
  const da = new Set(ist.map((z) => z.id));
  const weg = [...da].filter((id) => !soll.has(id));
  const dazu = [...soll].filter((id) => !da.has(id));
  if (weg.length > 0) {
    await tx
      .delete(traktandumVerantwortlich)
      .where(
        and(
          eq(traktandumVerantwortlich.traktandumId, traktandumId),
          inArray(traktandumVerantwortlich.personId, weg),
        ),
      );
  }
  if (dazu.length > 0) {
    await tx
      .insert(traktandumVerantwortlich)
      .values(dazu.map((personId) => ({ lagerId, traktandumId, personId })));
  }
}

// Die nächste freie Stelle am Ende der Liste eines Höcks (oder der Punkte für den nächsten Höck)
async function endeVon(tx: Tx, lagerId: string, hoeckId: string | null) {
  const [ende] = await tx
    .select({
      n: sql<number>`coalesce(max(${traktandum.reihenfolge}) + 1, 0)`.mapWith(
        Number,
      ),
    })
    .from(traktandum)
    .where(
      and(
        eq(traktandum.lagerId, lagerId),
        traktandumAktiv,
        hoeckId === null
          ? isNull(traktandum.hoeckId)
          : eq(traktandum.hoeckId, hoeckId),
      ),
    );
  return ende!.n;
}

export type SchreibErgebnis =
  { fehler: NonNullable<Pruefung>["fehler"] } | { id: string; version: number };

export async function legeTraktandumAn(
  tx: Tx,
  k: Akteur,
  eingabe: z.output<typeof traktandumAnlegen>,
): Promise<SchreibErgebnis> {
  const { verantwortlichePersonIds, ...werte } = eingabe;
  await sperreLager(tx, k.lagerId);
  const fehler = await pruefeTraktandumWerte(tx, k.lagerId, {
    ...werte,
    verantwortlichePersonIds,
  });
  if (fehler) return fehler;
  const neu = await legeZeileAn(tx, traktandum, k, {
    ...werte,
    hoeckId: werte.hoeckId ?? null,
    reihenfolge:
      werte.reihenfolge ??
      (await endeVon(tx, k.lagerId, werte.hoeckId ?? null)),
  });
  await setzeVerantwortliche(
    tx,
    k.lagerId,
    neu.id,
    verantwortlichePersonIds ?? [],
  );
  return { id: neu.id, version: neu.version };
}

export async function aendereTraktandum(
  tx: Tx,
  k: Akteur,
  id: string,
  eingabe: z.output<typeof traktandumAendern>,
): Promise<SchreibErgebnis> {
  const { version: erwartet, verantwortlichePersonIds, ...werte } = eingabe;
  await sperreLager(tx, k.lagerId);
  const alt = await ladeTraktandumZeile(tx, k.lagerId, id);
  if (!alt) throw new HTTPException(404);
  const fehler = await pruefeTraktandumWerte(tx, k.lagerId, {
    ...werte,
    verantwortlichePersonIds,
  });
  if (fehler) return fehler;
  // Wechselt der Punkt den Höck (oder wird auf den nächsten Höck geschoben), kommt er ans Ende der neuen Liste, wenn die Anfrage keine Stelle nennt
  const wechselt = werte.hoeckId !== undefined && werte.hoeckId !== alt.hoeckId;
  const neu = await aendereZeile(tx, traktandum, k, {
    id,
    version: erwartet,
    werte: {
      ...werte,
      ...(wechselt && werte.reihenfolge === undefined
        ? { reihenfolge: await endeVon(tx, k.lagerId, werte.hoeckId ?? null) }
        : {}),
    },
    ansicht: traktandumAnsicht,
  });
  if (verantwortlichePersonIds) {
    await setzeVerantwortliche(tx, k.lagerId, id, verantwortlichePersonIds);
  }
  return { id, version: neu.version };
}

// Löschen geht allein über loescheZeile des Sync-Kerns (das Löschverhalten ändert #427 dort, nicht hier)
export async function loescheTraktandum(
  tx: Tx,
  k: Akteur,
  id: string,
  erwartet: number,
) {
  await sperreLager(tx, k.lagerId);
  if (!(await ladeTraktandumZeile(tx, k.lagerId, id))) {
    throw new HTTPException(404);
  }
  await loescheZeile(tx, traktandum, k, {
    id,
    version: erwartet,
    ansicht: traktandumAnsicht,
  });
}

// Die Stelle in der Liste ist die neue Reihenfolge; was schon stimmt, bleibt unberührt (keine neue Version, kein Feed-Eintrag). Alles oder nichts: Ein Eintrag, der nicht in dieser Liste steht, ist 404
export async function ordneTraktanden(
  tx: Tx,
  k: Akteur,
  hoeckId: string | null,
  eintraege: { id: string; version: number }[],
) {
  await sperreLager(tx, k.lagerId);
  const vorhanden = await tx
    .select()
    .from(traktandum)
    .where(
      and(
        eq(traktandum.lagerId, k.lagerId),
        traktandumAktiv,
        hoeckId === null
          ? isNull(traktandum.hoeckId)
          : eq(traktandum.hoeckId, hoeckId),
      ),
    );
  const nachId = new Map(vorhanden.map((z) => [z.id, z]));
  if (eintraege.some((e) => !nachId.has(e.id))) throw new HTTPException(404);
  for (const [stelle, e] of eintraege.entries()) {
    if (nachId.get(e.id)!.reihenfolge === stelle) continue;
    await aendereZeile(tx, traktandum, k, {
      id: e.id,
      version: e.version,
      werte: { reihenfolge: stelle },
      ansicht: traktandumAnsicht,
    });
  }
}

// Übernimmt die offenen Punkte für den nächsten Höck in diesen Höck, ans Ende seiner Liste und in ihrer bisherigen Reihenfolge. Es ist eine Aktion des Servers auf dem Stand unter der Lagersperre: Sie braucht keine Versionen und verschiebt nichts doppelt. Gibt die Zahl der übernommenen Punkte zurück
export async function uebernehmeTraktanden(
  tx: Tx,
  k: Akteur,
  hoeckId: string,
  ids?: string[],
) {
  await sperreLager(tx, k.lagerId);
  if (!(await ladeHoeckZeile(tx, k.lagerId, hoeckId))) {
    throw new HTTPException(404);
  }
  const offen = await tx
    .select()
    .from(traktandum)
    .where(
      and(
        eq(traktandum.lagerId, k.lagerId),
        traktandumAktiv,
        isNull(traktandum.hoeckId),
        eq(traktandum.status, "offen"),
        ids ? inArray(traktandum.id, ids) : undefined,
      ),
    )
    .orderBy(asc(traktandum.reihenfolge), asc(traktandum.id));
  const ende = await endeVon(tx, k.lagerId, hoeckId);
  for (const [i, t] of offen.entries()) {
    await aendereZeile(tx, traktandum, k, {
      id: t.id,
      version: t.version,
      werte: { hoeckId, reihenfolge: ende + i },
      ansicht: traktandumAnsicht,
    });
  }
  return offen.length;
}

// Anwesenheit im Höck: ein Haken je Person. Nur Mitglieder des Lagers (400 KEIN_MITGLIED). Beides ist idempotent
export async function setzeHoeckAnwesenheit(
  tx: Tx,
  k: { lagerId: string },
  hoeckId: string,
  personId: string,
  anwesend: boolean,
): Promise<{ fehler: "KEIN_MITGLIED" } | undefined> {
  if (!(await ladeHoeckZeile(tx, k.lagerId, hoeckId))) {
    throw new HTTPException(404);
  }
  if (!anwesend) {
    await tx
      .delete(hoeckAnwesenheit)
      .where(
        and(
          eq(hoeckAnwesenheit.hoeckId, hoeckId),
          eq(hoeckAnwesenheit.personId, personId),
        ),
      );
    return undefined;
  }
  const [m] = await tx
    .select({ id: lagerMitglied.personId })
    .from(lagerMitglied)
    .where(
      and(
        eq(lagerMitglied.lagerId, k.lagerId),
        eq(lagerMitglied.personId, personId),
      ),
    );
  if (!m) return { fehler: "KEIN_MITGLIED" };
  await tx
    .insert(hoeckAnwesenheit)
    .values({ lagerId: k.lagerId, hoeckId, personId })
    .onConflictDoNothing();
  return undefined;
}

// Entscheide-Sammlung: alle Traktanden mit Entscheid, neueste Höcks zuerst, in einer Abfrage (mit dem Höck), Seitenwechsel über die ID des letzten Traktandums
export async function ladeEntscheide(
  db: Pick<Db, "select">,
  lagerId: string,
  p: { nach?: string; limit?: number },
) {
  const limit = p.limit ?? 100;
  const zeilen = await db
    .select({
      id: traktandum.id,
      titel: traktandum.titel,
      entscheid: traktandum.entscheid,
      aufgabeId: traktandum.aufgabeId,
      hoeckId: hoeck.id,
      hoeckDatum: hoeck.datum,
      hoeckTitel: hoeck.titel,
    })
    .from(traktandum)
    .innerJoin(
      hoeck,
      and(
        eq(hoeck.id, traktandum.hoeckId),
        eq(hoeck.lagerId, traktandum.lagerId),
      ),
    )
    .where(
      and(
        eq(traktandum.lagerId, lagerId),
        traktandumAktiv,
        hoeckAktiv,
        sql`${traktandum.entscheid} is not null`,
        p.nach
          ? sql`(${hoeck.datum}, ${traktandum.id}) < (select h.datum, t.id from traktandum t join hoeck h on h.id = t.hoeck_id and h.lager_id = t.lager_id where t.id = ${p.nach} and t.lager_id = ${lagerId})`
          : undefined,
      ),
    )
    .orderBy(desc(hoeck.datum), desc(traktandum.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  return {
    entscheide: seite.map(({ hoeckId, hoeckDatum, hoeckTitel, ...t }) => ({
      ...t,
      hoeck: { id: hoeckId, datum: hoeckDatum, titel: hoeckTitel },
    })),
    naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
  };
}

// Höck-Modus (#378): alles, was die App für die Sitzung braucht, in vier Abfragen und unabhängig von der Zahl der Traktanden: der Höck mit den Anwesenden, die Traktanden mit Verantwortlichen, die Mitglieder zum Abhaken, die Ressort-Runde. Nur mit hoecks.lesen_alle oder hoecks.bearbeiten (die Route prüft es)
// Ressort-Runde nach Rolle: ohne ressorts.lesen fehlt sie (null); ohne das Recht, alle Aufgaben zu lesen, stehen die Ressorts ohne Zahlen (die Zahlen würden Aufgaben verraten, die die Rolle nicht lesen darf)
export async function ladeHoeckModus(
  db: Pick<Db, "select">,
  zugriff: LagerZugriff,
  id: string,
) {
  const lagerId = zugriff.lager.id;
  const h = await ladeHoeck(db, lagerId, id, "alle");
  if (!h || !("traktanden" in h)) return undefined;
  const { anwesende: da, ...hoeckTeil } = h;
  const dabei = new Set(da.map((p) => p.id));
  const mitglieder = await db
    .select({
      id: user.id,
      name: user.name,
      ceviName: user.ceviName,
      rolle: lagerMitglied.rolle,
    })
    .from(lagerMitglied)
    .innerJoin(user, eq(user.id, lagerMitglied.personId))
    .where(eq(lagerMitglied.lagerId, lagerId))
    .orderBy(asc(user.name), asc(user.id));
  const runde = darf(zugriff, "ressorts.lesen")
    ? await ladeRessortRunde(db, lagerId, aufgabenUmfang(zugriff) === "alle")
    : null;
  return {
    hoeck: hoeckTeil,
    mitglieder: mitglieder.map((m) => ({ ...m, anwesend: dabei.has(m.id) })),
    ressortRunde: runde,
  };
}

// Je Ressort die Aufgaben nach Stand: gesamt, erledigt, offen (nicht erledigt) und überfällig (Frist vorbei, nicht erledigt, Datum in der Schweiz). Eine Abfrage mit Gruppierung; mitZahlen false: nur die Ressorts
async function ladeRessortRunde(
  db: Pick<Db, "select">,
  lagerId: string,
  mitZahlen: boolean,
) {
  const leitung = alias(user, "leitung");
  const zahl = (bedingung: SQL) =>
    sql<number>`count(${aufgabe.id}) filter (where ${bedingung})`.mapWith(
      Number,
    );
  const zeilen = await db
    .select({
      id: ressort.id,
      kuerzel: ressort.kuerzel,
      name: ressort.name,
      leitungId: leitung.id,
      leitungName: leitung.name,
      leitungCeviName: leitung.ceviName,
      gesamt: zahl(sql`true`),
      erledigt: zahl(sql`${aufgabe.status} = 'erledigt'`),
      offen: zahl(sql`${aufgabe.status} <> 'erledigt'`),
      ueberfaellig: zahl(
        sql`${aufgabe.status} <> 'erledigt' and ${aufgabe.frist} < (now() at time zone 'Europe/Zurich')::date`,
      ),
    })
    .from(ressort)
    .leftJoin(leitung, eq(leitung.id, ressort.leitungPersonId))
    .leftJoin(
      aufgabe,
      and(
        mitZahlen ? eq(aufgabe.ressortId, ressort.id) : sql`false`,
        eq(aufgabe.lagerId, ressort.lagerId),
        isNull(aufgabe.geloeschtAm),
      ),
    )
    .where(and(eq(ressort.lagerId, lagerId), isNull(ressort.geloeschtAm)))
    .groupBy(ressort.id, leitung.id)
    .orderBy(asc(ressort.reihenfolge), asc(ressort.id))
    .limit(200);
  return zeilen.map((z) => ({
    id: z.id,
    kuerzel: z.kuerzel,
    name: z.name,
    leitung: z.leitungId
      ? { id: z.leitungId, name: z.leitungName, ceviName: z.leitungCeviName }
      : null,
    aufgaben: mitZahlen
      ? {
          gesamt: z.gesamt,
          erledigt: z.erledigt,
          offen: z.offen,
          ueberfaellig: z.ueberfaellig,
        }
      : null,
  }));
}
