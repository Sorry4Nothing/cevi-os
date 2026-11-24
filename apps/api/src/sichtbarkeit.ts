import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client.js";
import { personTag, tag } from "./db/schema.js";
import { siehtAlles, type Person } from "./rechte.js";

// Gemeinsame Sichtbarkeit (#333) für Seiten, Bausteine, Termine, Räume, Dokumente und Medien.
//
// Speicherung am Objekt, zwei Spalten, keine Zuordnungstabelle:
//   sichtbarkeit       text   not null   'oeffentlich' | 'angemeldet' | 'tags'  (CHECK in der Datenbank)
//   sichtbarkeit_tags  uuid[] not null default '{}'   die Tag-Menge, nur bei 'tags' gelesen
// Die Tag-IDs sind nicht per Fremdschlüssel gesichert: Ein gelöschter Tag lässt eine tote ID zurück, die nie passt (fail-closed, das Objekt sieht dann nur die Abteilungsleitung).

// Wert in der API; die Menge hat höchstens 50 Tags und keine Doppelten (shortcut: Obergrenze willkürlich, bei Bedarf anheben)
export const sichtbarkeitSchema = z.discriminatedUnion("art", [
  z.strictObject({ art: z.literal("oeffentlich") }),
  z.strictObject({ art: z.literal("angemeldet") }),
  z.strictObject({
    art: z.literal("tags"),
    tagIds: z
      .array(z.uuid())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
]);
export type Sichtbarkeit = z.infer<typeof sichtbarkeitSchema>;

// Wert in die zwei Spalten und zurück
export function sichtbarkeitSpalten(wert: Sichtbarkeit) {
  return {
    sichtbarkeit: wert.art,
    sichtbarkeitTags: wert.art === "tags" ? wert.tagIds : [],
  };
}
export function sichtbarkeitAusSpalten(zeile: {
  sichtbarkeit: Sichtbarkeit["art"];
  sichtbarkeitTags: string[];
}): Sichtbarkeit {
  return zeile.sichtbarkeit === "tags"
    ? { art: "tags", tagIds: zeile.sichtbarkeitTags }
    : { art: zeile.sichtbarkeit };
}

// Tag-IDs der Person, nur aus der Abteilung der Sitzung
export async function ladeTagIds(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
): Promise<string[]> {
  const zeilen = await db
    .select({ id: personTag.tagId })
    .from(personTag)
    .innerJoin(tag, eq(tag.id, personTag.tagId))
    .where(
      and(
        eq(personTag.userId, person.id),
        eq(tag.abteilungId, person.abteilungId),
      ),
    );
  return zeilen.map((z) => z.id);
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

// (a) Einzelnes Objekt, reine Funktion. person null = ohne Sitzung. Wer eine Sitzung hat, sieht nur Objekte der eigenen Abteilung, auch öffentliche; die Abteilungsleitung und der Entwickler sehen dort alles, auch Tag-Mengen ohne eigenen Tag und leere
export function sichtbarFuer(
  person: (SichtPerson & { tagIds: readonly string[] }) | null,
  objekt: { abteilungId: string; sichtbarkeit: Sichtbarkeit },
): boolean {
  const wert = objekt.sichtbarkeit;
  if (!person) return wert.art === "oeffentlich";
  if (person.abteilungId !== objekt.abteilungId) return false;
  if (siehtAlles(person) || wert.art !== "tags") return true;
  return wert.tagIds.some((id) => person.tagIds.includes(id));
}

// Spalten oder Ausdrücke des Objekts (Text «tabelle.spalte» als sql`…` geht auch)
export type SichtSpalten = {
  abteilungId: AnyColumn | SQL;
  sichtbarkeit: AnyColumn | SQL;
  sichtbarkeitTags: AnyColumn | SQL;
};

// (b) Filter für Listen, gleiche Regeln wie sichtbarFuer. EXISTS statt Join: Eine Zeile bleibt eine Zeile, auch wenn mehrere Tags passen. Die Tags der Person lädt die Abfrage selbst, nur aus der Abteilung des Objekts.
// Ohne Sitzung (null) filtert er nur auf «oeffentlich»; die Abteilung des Auftritts setzt der Aufrufer selbst
export function sichtbarkeitFilter(
  person: SichtPerson | null,
  spalten: SichtSpalten,
): SQL {
  const { abteilungId, sichtbarkeit, sichtbarkeitTags } = spalten;
  if (!person) return sql`${sichtbarkeit} = 'oeffentlich'`;
  const eigeneAbteilung = sql`${abteilungId} = ${person.abteilungId}`;
  if (siehtAlles(person)) return eigeneAbteilung;
  return sql`(${eigeneAbteilung} and (${sichtbarkeit} in ('oeffentlich', 'angemeldet') or (${sichtbarkeit} = 'tags' and exists (select 1 from person_tag as sicht_pt inner join tag as sicht_tag on sicht_tag.id = sicht_pt.tag_id where sicht_pt.user_id = ${person.id} and sicht_tag.abteilung_id = ${abteilungId} and sicht_tag.id = any(${sichtbarkeitTags})))))`;
}
