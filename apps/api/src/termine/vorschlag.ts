import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { personTag, tag } from "../db/schema.js";
import type { terminVorschlag } from "../db/schema-vorschlag.js";
import type { Person } from "../rechte.js";

// Terminvorschläge (#439): Wer vorschlagen darf, die Eingabe und die Antwort. Entscheiden gehört zu #440

// Obergrenzen; die Längen stehen auch als CHECK in der Tabelle
export const MAX_OFFENE_JE_PERSON = 10;
export const MAX_TAGS = 20;

// Annahme A9 (vom Nutzer zu bestätigen): die Abteilungsleitung, Personen mit einer Rolle als Stufenleitung oder Leitung und Personen mit einem Tag vom Typ funktion oder team. Rollen und Admin stehen schon in der Sitzung; nur sonst fragt es die Datenbank (eine Abfrage)
export async function darfVorschlagen(db: Db, person: Person) {
  if (person.admin || person.rollen.length > 0) return true;
  const [treffer] = await db
    .select({ eins: sql`1` })
    .from(personTag)
    .innerJoin(tag, eq(tag.id, personTag.tagId))
    .where(
      and(
        eq(personTag.userId, person.id),
        eq(tag.abteilungId, person.abteilungId),
        inArray(tag.typ, ["funktion", "team"]),
      ),
    )
    .limit(1);
  return !!treffer;
}

// Steuerzeichen sind verboten, vor allem NUL: Postgres kann es nicht speichern, das wäre ein 500 statt 400. Mehrzeilige Texte erlauben Tab und Zeilenumbruch
// eslint-disable-next-line no-control-regex
const EINZEILIG = /^[^\u0000-\u001F\u007F]*$/;
// eslint-disable-next-line no-control-regex
export const MEHRZEILIG = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
// Leer heisst «nicht gesetzt» und wird null
const leerZuNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const optional = (max: number, muster: RegExp) =>
  z.preprocess(
    leerZuNull,
    z.string().trim().max(max).regex(muster).nullable().optional(),
  );
// PostgreSQL 18 lehnt das Jahr 0000 ab (Fehler 22008), zod lässt es durch
const kalendertag = z.iso.date().refine((wert) => !wert.startsWith("0000"));
const zeit = z.iso.datetime({ offset: true });

export const vorschlagSchema = z
  .strictObject({
    titel: z.string().trim().min(1).max(120).regex(EINZEILIG),
    ganztaegig: z.boolean(),
    beginn: zeit.optional(),
    ende: zeit.optional(),
    tagVon: kalendertag.optional(),
    tagBis: kalendertag.optional(),
    ort: optional(120, EINZEILIG),
    beschreibung: optional(2000, MEHRZEILIG),
    bemerkung: optional(1000, MEHRZEILIG),
    tagIds: z
      .array(z.uuid().toLowerCase())
      .min(1)
      .max(MAX_TAGS)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  // Ganztägig braucht genau tagVon und tagBis, sonst genau beginn und ende; ende nach beginn, tagBis nicht vor tagVon
  .refine((v) =>
    v.ganztaegig
      ? v.tagVon !== undefined &&
        v.tagBis !== undefined &&
        v.beginn === undefined &&
        v.ende === undefined &&
        v.tagBis >= v.tagVon
      : v.beginn !== undefined &&
        v.ende !== undefined &&
        v.tagVon === undefined &&
        v.tagBis === undefined &&
        Date.parse(v.ende) > Date.parse(v.beginn),
  );
export type VorschlagEingabe = z.infer<typeof vorschlagSchema>;

export const idPfad = z.strictObject({ id: z.uuid() });
export const meineAbfrage = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.uuid().optional(),
});

// Heute in Schweizer Zeit als YYYY-MM-DD (schwedisches Format ist ISO); ein ganztägiger Vorschlag darf heute beginnen
export const heuteInZuerich = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

// Beginn nicht in der Vergangenheit: der Zeitpunkt nach jetzt, bei ganztägigen der erste Tag ab heute
export function liegtInVergangenheit(v: VorschlagEingabe) {
  return v.ganztaegig
    ? v.tagVon! < heuteInZuerich()
    : Date.parse(v.beginn!) <= Date.now();
}

type Zeile = typeof terminVorschlag.$inferSelect;
export type TagAnsicht = { id: string; name: string; typ: string };

// Die Tags aller Vorschläge einer Seite in einer Abfrage; ein gelöschter oder fremder Tag fällt weg
export async function ladeTags(
  db: Db,
  abteilungId: string,
  zeilen: Pick<Zeile, "tagIds">[],
) {
  const ids = [...new Set(zeilen.flatMap((z) => z.tagIds))];
  const nachId = new Map<string, TagAnsicht>();
  if (ids.length === 0) return nachId;
  const tags = await db
    .select({ id: tag.id, name: tag.name, typ: tag.typ })
    .from(tag)
    .where(and(inArray(tag.id, ids), eq(tag.abteilungId, abteilungId)));
  for (const t of tags) nachId.set(t.id, t);
  return nachId;
}

// Die Antwort kennt nie abteilung_id und nicht die Person, die entschieden hat
export function vorschlagAnsicht(v: Zeile, tags: Map<string, TagAnsicht>) {
  return {
    id: v.id,
    status: v.status,
    titel: v.titel,
    ganztaegig: v.ganztaegig,
    beginn: v.beginn,
    ende: v.ende,
    tagVon: v.tagVon,
    tagBis: v.tagBis,
    ort: v.ort,
    beschreibung: v.beschreibung,
    bemerkung: v.bemerkung,
    tags: v.tagIds.flatMap((id) => tags.get(id) ?? []),
    begruendung: v.begruendung,
    entschiedenAm: v.entschiedenAm,
    erstelltAm: v.erstelltAm,
    vorgeschlagenVon: v.vorgeschlagenVon,
  };
}
