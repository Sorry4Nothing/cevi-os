import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { kind, kindEltern, personTag, tag } from "../db/schema.js";
import type { Person } from "../rechte.js";

// Sicht der Termine (Epic #430, #435): Ein Termin gehört zu den Tags in programm_tag; die Person sieht ihn, wenn sie einen dieser Tags hat.
// Anders als bei programm_stufe heisst «kein Tag» hier «für niemanden sichtbar», auch nicht für die Abteilungsleitung.

// Die Tags der Person, getrennt nach Herkunft: eigene Tags (person_tag, auch die Stufenrolle) und die Stufen der aktiven Kinder (Annahme A1, abgeleitet, nicht gespeichert)
export interface SichtTags {
  eigene: string[];
  ueberKinder: string[];
}

// Beginn in Schweizer Zeit: Ein ganztägiger Termin beginnt um Mitternacht seines ersten Tages
export const TERMIN_BEGINN = sql`coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich')`;

// Eine Abfrage für beide Herkünfte, nur aus der Abteilung der Sitzung
export async function ladeSichtTags(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
): Promise<SichtTags> {
  const zeilen = await db
    .select({ quelle: sql<string>`'eigene'::text`, id: personTag.tagId })
    .from(personTag)
    .innerJoin(
      tag,
      and(eq(tag.id, personTag.tagId), eq(tag.abteilungId, person.abteilungId)),
    )
    .where(eq(personTag.userId, person.id))
    .unionAll(
      db
        .select({ quelle: sql<string>`'kind'::text`, id: kind.stufeId })
        .from(kind)
        .innerJoin(
          kindEltern,
          and(eq(kindEltern.kindId, kind.id), eq(kindEltern.userId, person.id)),
        )
        .where(
          and(
            eq(kind.abteilungId, person.abteilungId),
            isNull(kind.inaktivSeit),
          ),
        ),
    );
  const nach = (quelle: string) => [
    ...new Set(zeilen.filter((z) => z.quelle === quelle).map((z) => z.id)),
  ];
  return { eigene: nach("eigene"), ueberKinder: nach("kind") };
}

// Alle Tags der Person, ohne Doppelte
export const alleSichtTags = (t: SichtTags) => [
  ...new Set([...t.eigene, ...t.ueberKinder]),
];

// EXISTS statt Join: Ein Termin mit mehreren passenden Tags erscheint genau einmal. «intern» blendet den Termin für alle aus (A5).
// Eigene Tags sehen «leitende» und «eltern», die Stufen der Kinder nur «eltern»
export function meineTermine(
  person: Pick<Person, "abteilungId">,
  t: SichtTags,
) {
  const tagsDes = (ids: string[]) =>
    sql`exists (select 1 from programm_tag where programm_tag.programm_id = programm.id and ${inArray(sql`programm_tag.tag_id`, ids)})`;
  const teile: SQL[] = [];
  if (t.eigene.length > 0) {
    teile.push(
      sql`(programm.sichtbarkeit in ('leitende', 'eltern') and ${tagsDes(t.eigene)})`,
    );
  }
  if (t.ueberKinder.length > 0) {
    teile.push(
      sql`(programm.sichtbarkeit = 'eltern' and ${tagsDes(t.ueberKinder)})`,
    );
  }
  if (teile.length === 0) return sql`false`;
  return sql`(programm.abteilung_id = ${person.abteilungId} and (${sql.join(teile, sql` or `)}))`;
}

// Einhängepunkt für «Alle Termine» (#436, Annahme A2): Termine von Anlässen mit Sichtbarkeit «angemeldet» oder «oeffentlich», die nicht in «Mein Kalender» liegen. #442 füllt die Regel; bis dahin gibt es keine.
export function anlassTermine(): SQL {
  return sql`false`;
}

// «Alle Termine» (Web): Die Abteilungsleitung sieht jeden Termin der Abteilung mit mindestens einem Tag («intern» wie überall ausgeblendet, A5); alle anderen «Mein Kalender» plus die Anlass-Termine. Ohne Tag nie.
export function alleTermine(
  person: Pick<Person, "abteilungId" | "admin">,
  t: SichtTags,
) {
  if (person.admin) {
    return sql`(programm.abteilung_id = ${person.abteilungId} and programm.sichtbarkeit <> 'intern' and exists (select 1 from programm_tag join tag on tag.id = programm_tag.tag_id and tag.abteilung_id = programm.abteilung_id where programm_tag.programm_id = programm.id))`;
  }
  return sql`(${meineTermine(person, t)} or ${anlassTermine()})`;
}
