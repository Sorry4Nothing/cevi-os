import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { abteilung, bearbeiter, personTag, tag } from "./db/schema.js";
import { hatRolle, type Person } from "./rechte.js";

// Ein Modell für alle bearbeitbaren Objekte (#334), aufgebaut auf Person aus rechte.ts:
// Abteilungsleitung (person.admin) darf alles; eine Stufenleitung die Objekte ihrer Stufe; alle anderen nur über eine Zeile in «bearbeiter»,
// auf die Person oder auf einen Tag, den sie trägt. Eine Zeile ohne objekt_id gilt für alle Objekte des Typs: so ist die Rolle «Redaktion» (Typ «seite») gebaut.
// Ein Tag verleiht für sich nichts; das Recht steht erst in der Zeile, die nur die Abteilungsleitung anlegt (/api/v1/admin/bearbeiter).
export const OBJEKT_TYPEN = ["seite"] as const;
export type ObjektTyp = (typeof OBJEKT_TYPEN)[number];

// Konvention wie überall: Die Route lädt ihr Objekt in SQL auf person.abteilungId gefiltert (sonst 404) und fragt erst dann; ein «false» ist dann ein 403.
// Jede Abfrage hier schränkt zusätzlich auf die Abteilung der Person ein: Eine Zeile oder ein Tag einer anderen Abteilung gibt nie ein Recht.
function sonderrecht(
  person: Pick<Person, "id" | "abteilungId">,
  objektTyp: ObjektTyp,
  objektId: AnyColumn | SQL,
): SQL {
  return sql`exists (select 1 from ${bearbeiter} where ${bearbeiter.abteilungId} = ${person.abteilungId} and ${bearbeiter.objektTyp} = ${objektTyp} and (${bearbeiter.objektId} is null or ${bearbeiter.objektId} = ${objektId}) and (${bearbeiter.userId} = ${person.id} or ${bearbeiter.tagId} in (select ${personTag.tagId} from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${person.abteilungId} where ${personTag.userId} = ${person.id})))`;
}

// stufeId: die Stufe, zu der das Objekt gehört (Stufenseite); ohne sie gibt es kein Stufenrecht
export async function darfBearbeiten(
  db: Pick<Db, "select">,
  person: Person,
  objektTyp: ObjektTyp,
  objektId: string,
  { stufeId }: { stufeId?: string } = {},
) {
  if (person.admin) return true;
  if (stufeId !== undefined && hatRolle(person, stufeId, "stufenleitung")) {
    return true;
  }
  // Eine Zeile aus der eigenen Abteilung trägt das exists; select ohne from kennt Drizzle nicht
  const [zeile] = await db
    .select({
      ok: sql<boolean>`${sonderrecht(person, objektTyp, sql`${objektId}::uuid`)}`,
    })
    .from(abteilung)
    .where(eq(abteilung.id, person.abteilungId));
  return zeile?.ok === true;
}

// Filter für Listen im Editor: nur Objekte der Abteilung der Person, die sie bearbeiten darf. spalten sind die Spalten der Objekttabelle
export function bearbeitbar(
  person: Person,
  objektTyp: ObjektTyp,
  spalten: { id: AnyColumn; abteilungId: AnyColumn; stufeId?: AnyColumn },
): SQL {
  const eigeneAbteilung = sql`${spalten.abteilungId} = ${person.abteilungId}`;
  if (person.admin) return eigeneAbteilung;
  const stufen = person.rollen
    .filter((r) => r.typ === "stufenleitung")
    .map((r) => r.stufeId);
  const stufenrecht =
    spalten.stufeId && stufen.length > 0
      ? sql`${inArray(spalten.stufeId, stufen)} or `
      : sql``;
  return and(
    eigeneAbteilung,
    sql`(${stufenrecht}${sonderrecht(person, objektTyp, spalten.id)})`,
  ) as SQL;
}
