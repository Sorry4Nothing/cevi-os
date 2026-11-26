import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { personTag, tag } from "./db/schema.js";
import { siehtAlles, type Person } from "./rechte.js";

// Gemeinsame Sichtbarkeit (#333) für Seiten, Bausteine, Termine, Räume, Dokumente und Medien.
//
// Speicherung am Objekt, drei Spalten, keine Zuordnungstabelle:
//   sichtbarkeit         text   not null   'oeffentlich' | 'angemeldet' | 'tags'  (CHECK in der Datenbank)
//   sichtbarkeit_tags    uuid[] not null default '{}'   die Tag-Menge, nur bei 'tags' gelesen
//   sichtbarkeit_rollen  jsonb  not null default '{}'   je Tag die Rollen, die es sehen (#844); ohne Schlüssel die ganze Gruppe
// Die Tag-IDs sind nicht per Fremdschlüssel gesichert: Ein gelöschter Tag lässt eine tote ID zurück, die nie passt (fail-closed, das Objekt sieht dann nur die Abteilungsleitung).

// Rollen in einer Gruppe (#844): Gruppenleitung und Stufenleitung sind die Systemrollen der Stufe (person_tag.rolle wie in der Sicht «rolle»), alle anderen Mitglieder sind Teilnehmende.
// Bei Anlässen zählen zu den Teilnehmenden auch die Kinder der Stufe und ihre Eltern (termine/anlass-sicht.ts). Die Stufenleitung sieht alles, was die Gruppenleitung sieht (wie bei den Rechten).
export const SICHT_ROLLEN = [
  "teilnehmende",
  "leitung",
  "stufenleitung",
] as const;
export type SichtRolle = (typeof SICHT_ROLLEN)[number];

const rollenListe = z
  .array(z.enum(SICHT_ROLLEN))
  .min(1)
  .max(SICHT_ROLLEN.length)
  .refine((r) => new Set(r).size === r.length);

// Wert in der API; die Menge hat höchstens 50 Tags und keine Doppelten (shortcut: Obergrenze willkürlich, bei Bedarf anheben).
// rollen: nur für gewählte Tags, Schlüssel klein geschrieben wie in der Datenbank (sonst fände die SQL-Prüfung den Schlüssel nicht und gäbe die ganze Gruppe frei)
export const sichtbarkeitSchema = z.discriminatedUnion("art", [
  z.strictObject({ art: z.literal("oeffentlich") }),
  z.strictObject({ art: z.literal("angemeldet") }),
  z
    .strictObject({
      art: z.literal("tags"),
      tagIds: z
        .array(z.uuid())
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length),
      rollen: z.record(z.uuid(), rollenListe).optional(),
    })
    .refine((w) =>
      Object.keys(w.rollen ?? {}).every(
        (id) => id === id.toLowerCase() && w.tagIds.includes(id),
      ),
    ),
]);
export type Sichtbarkeit = z.infer<typeof sichtbarkeitSchema>;
export type SichtRollen = Partial<Record<string, readonly SichtRolle[]>>;

// Wert in die drei Spalten und zurück; ohne Einschränkung fehlt «rollen» in der Antwort (wie vor #844)
export function sichtbarkeitSpalten(wert: Sichtbarkeit) {
  return {
    sichtbarkeit: wert.art,
    sichtbarkeitTags: wert.art === "tags" ? wert.tagIds : [],
    sichtbarkeitRollen: (wert.art === "tags" && wert.rollen) || {},
  };
}
export function sichtbarkeitAusSpalten(zeile: {
  sichtbarkeit: Sichtbarkeit["art"];
  sichtbarkeitTags: string[];
  sichtbarkeitRollen: SichtRollen;
}): Sichtbarkeit {
  const rollen = zeile.sichtbarkeitRollen as Record<string, SichtRolle[]>;
  return zeile.sichtbarkeit === "tags"
    ? {
        art: "tags",
        tagIds: zeile.sichtbarkeitTags,
        ...(Object.keys(rollen).length > 0 && { rollen }),
      }
    : { art: zeile.sichtbarkeit };
}

// Darf diese Rolle sehen? erlaubt fehlt: die ganze Gruppe
export function rolleErlaubt(
  erlaubt: readonly SichtRolle[] | undefined,
  rolle: SichtRolle,
) {
  return (
    !erlaubt ||
    erlaubt.includes(rolle) ||
    (rolle === "stufenleitung" && erlaubt.includes("leitung"))
  );
}

// Die Rolle einer Person in der Gruppe aus person_tag.rolle (Freitext, den der Trigger den Systemrollen nachführt)
export const rolleAusSpalte = (rolle: AnyColumn | SQL) =>
  sql<SichtRolle>`(case when ${rolle} in ('leitung', 'stufenleitung') then ${rolle} else 'teilnehmende' end)`;

// SQL: Lässt die Einschränkung des Objekts für diesen Tag die Rolle zu? Gleiche Regel wie rolleErlaubt
export const rolleErlaubtSql = (
  rollen: AnyColumn | SQL,
  tagId: SQL,
  rolle: SQL,
) =>
  sql`(${rollen} -> ${tagId} is null or ${rollen} -> ${tagId} @> to_jsonb(${rolle}) or (${rolle} = 'stufenleitung' and ${rollen} -> ${tagId} @> '"leitung"'))`;

export type Gruppe = { tagId: string; rolle: SichtRolle };

// Gruppen der Person mit ihrer Rolle, nur aus der Abteilung der Sitzung
export async function ladeGruppen(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
): Promise<Gruppe[]> {
  return db
    .select({ tagId: personTag.tagId, rolle: rolleAusSpalte(personTag.rolle) })
    .from(personTag)
    .innerJoin(tag, eq(tag.id, personTag.tagId))
    .where(
      and(
        eq(personTag.userId, person.id),
        eq(tag.abteilungId, person.abteilungId),
      ),
    );
}

// Eingabeprüfung für Routen: Alle Tags der Menge müssen zur Abteilung gehören, sonst kennt der Aufrufer fremde Tag-IDs
export async function tagsGehoerenZurAbteilung(
  db: Db,
  abteilungId: string,
  tagIds: readonly string[],
): Promise<boolean> {
  if (tagIds.length === 0) return true;
  const gefunden = await db
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.abteilungId, abteilungId), inArray(tag.id, [...tagIds])));
  return gefunden.length === new Set(tagIds).size;
}

export type SichtPerson = Pick<
  Person,
  "id" | "abteilungId" | "abteilungsleitung" | "entwickler"
>;

// (a) Einzelnes Objekt, reine Funktion. person null = ohne Sitzung. Wer eine Sitzung hat, sieht nur Objekte der eigenen Abteilung, auch öffentliche; die Abteilungsleitung und der Entwickler sehen dort alles, auch Tag-Mengen ohne eigenen Tag und leere.
// Bei «tags» muss eine Gruppe der Person passen und, wenn das Objekt die Gruppe auf Rollen einschränkt, ihre Rolle darin
export function sichtbarFuer(
  person: (SichtPerson & { gruppen: readonly Gruppe[] }) | null,
  objekt: { abteilungId: string; sichtbarkeit: Sichtbarkeit },
): boolean {
  const wert = objekt.sichtbarkeit;
  if (!person) return wert.art === "oeffentlich";
  if (person.abteilungId !== objekt.abteilungId) return false;
  if (siehtAlles(person) || wert.art !== "tags") return true;
  const rollen: SichtRollen = wert.rollen ?? {};
  return person.gruppen.some(
    (g) =>
      wert.tagIds.includes(g.tagId) &&
      rolleErlaubt(
        Object.hasOwn(rollen, g.tagId) ? rollen[g.tagId] : undefined,
        g.rolle,
      ),
  );
}

// Spalten oder Ausdrücke des Objekts (Text «tabelle.spalte» als sql`…` geht auch)
export type SichtSpalten = {
  abteilungId: AnyColumn | SQL;
  sichtbarkeit: AnyColumn | SQL;
  sichtbarkeitTags: AnyColumn | SQL;
  sichtbarkeitRollen: AnyColumn | SQL;
};

// (b) Filter für Listen, gleiche Regeln wie sichtbarFuer. EXISTS statt Join: Eine Zeile bleibt eine Zeile, auch wenn mehrere Tags passen. Die Tags der Person lädt die Abfrage selbst, nur aus der Abteilung des Objekts.
// Ohne Sitzung (null) filtert er nur auf «oeffentlich»; die Abteilung des Auftritts setzt der Aufrufer selbst
export function sichtbarkeitFilter(
  person: SichtPerson | null,
  spalten: SichtSpalten,
): SQL {
  const { abteilungId, sichtbarkeit, sichtbarkeitTags, sichtbarkeitRollen } =
    spalten;
  if (!person) return sql`${sichtbarkeit} = 'oeffentlich'`;
  const eigeneAbteilung = sql`${abteilungId} = ${person.abteilungId}`;
  if (siehtAlles(person)) return eigeneAbteilung;
  const rolleErlaubt = rolleErlaubtSql(
    sichtbarkeitRollen,
    sql`sicht_tag.id::text`,
    rolleAusSpalte(sql`sicht_pt.rolle`),
  );
  return sql`(${eigeneAbteilung} and (${sichtbarkeit} in ('oeffentlich', 'angemeldet') or (${sichtbarkeit} = 'tags' and exists (select 1 from person_tag as sicht_pt inner join tag as sicht_tag on sicht_tag.id = sicht_pt.tag_id where sicht_pt.user_id = ${person.id} and sicht_tag.abteilung_id = ${abteilungId} and sicht_tag.id = any(${sichtbarkeitTags}) and ${rolleErlaubt}))))`;
}
