import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { abteilung, anlass, bearbeiter, personTag, tag } from "./db/schema.js";
import { plattformRechtSql } from "./plattform.js";
import { hatRolle, siehtAlles, type Person } from "./rechte.js";
import { darf } from "./rechtemodell/darf.js";
import { rechteModus } from "./rechtemodell/modus.js";
import { rechtSql } from "./rechtemodell/sql.js";

// Ein Modell für alle bearbeitbaren Objekte (#334), aufgebaut auf Person aus rechte.ts:
// Abteilungsleitung und Entwickler (siehtAlles) dürfen alles; eine Stufenleitung die Objekte ihrer Stufe; wer das Plattformrecht «Seiten bearbeiten» hat (Rolle Webmaster, #426), alle Seiten;
// alle anderen nur über eine Zeile in «bearbeiter» für genau dieses Objekt, auf die Person oder auf einen Tag, den sie trägt.
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
  return sql`exists (select 1 from ${bearbeiter} where ${bearbeiter.abteilungId} = ${person.abteilungId} and ${bearbeiter.objektTyp} = ${objektTyp} and ${bearbeiter.objektId} = ${objektId} and (${bearbeiter.userId} = ${person.id} or ${bearbeiter.tagId} in (select ${personTag.tagId} from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${person.abteilungId} where ${personTag.userId} = ${person.id})))`;
}

// Verantwortliche eines Teams (#352, Annahme: Rolle «verantwortlich» am Tag, Wert offen). Nur Tags vom Typ «team»: Bei einer Stufe entscheidet die Stufenleitung, ein Freitext am Stufen-Tag verleiht nichts
function teamVerantwortung(
  person: Pick<Person, "id" | "abteilungId">,
  tagId: AnyColumn | SQL,
): SQL {
  return sql`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} where ${personTag.userId} = ${person.id} and ${personTag.tagId} = ${tagId} and lower(${personTag.rolle}) = ${TEAM_ROLLE} and ${tag.typ} = 'team' and ${tag.abteilungId} = ${person.abteilungId})`;
}
export const TEAM_ROLLE = "verantwortlich";

// Das Plattformrecht, das ein Objekt des Typs ganz öffnet. Bearbeiten ist «Seiten bearbeiten»; Veröffentlichen ist ein eigenes Recht («Seiten veröffentlichen»), die Stufenleitung und die Sonderrechte pro Seite tragen beides
const PLATTFORM_RECHT = {
  seite: {
    bearbeiten: "seiten.bearbeiten",
    veroeffentlichen: "seiten.veroeffentlichen",
  },
} as const;

type Aktion = keyof (typeof PLATTFORM_RECHT)["seite"];

// stufeId: die Stufe, zu der das Objekt gehört (Stufenseite); ohne sie gibt es kein Stufenrecht.
// tagId: die Gruppe, zu der das Objekt gehört (Seite eines Teams); ohne sie gibt es kein Teamrecht.
// veroeffentlichen: Die Frage gilt dem Veröffentlichen und Zurückziehen; statt «Seiten bearbeiten» zählt dann «Seiten veröffentlichen»
export async function darfBearbeiten(
  db: Pick<Db, "select">,
  person: Person,
  objektTyp: ObjektTyp,
  objektId: string,
  {
    stufeId,
    tagId,
    veroeffentlichen,
  }: { stufeId?: string; tagId?: string; veroeffentlichen?: boolean } = {},
) {
  if (siehtAlles(person)) return true;
  if (stufeId !== undefined && hatRolle(person, stufeId, "stufenleitung")) {
    return true;
  }
  const aktion: Aktion = veroeffentlichen ? "veroeffentlichen" : "bearbeiten";
  // Eine Abfrage trägt alle Wege (Plattformrecht, Zeile aus der eigenen Abteilung, Team); select ohne from kennt Drizzle nicht
  const [zeile] = await db
    .select({
      ok: sql<boolean>`(${plattformRechtSql(person, [PLATTFORM_RECHT[objektTyp][aktion]])} or ${sonderrecht(person, objektTyp, sql`${objektId}::uuid`)}${
        tagId === undefined
          ? sql``
          : sql` or ${teamVerantwortung(person, sql`${tagId}::uuid`)}`
      })`,
    })
    .from(abteilung)
    .where(eq(abteilung.id, person.abteilungId));
  return zeile?.ok === true;
}

// Der Anlass, dessen Seite diese Seite ist (anlass.seite_id): Rollen des OK gelten für die Seite ihres Anlasses (#643). Als Ausdruck für Listen und als Abfrage für eine einzelne Seite
const anlassDerSeite = (seiteId: AnyColumn | SQL) =>
  sql`(select ${anlass.id} from ${anlass} where ${anlass.seiteId} = ${seiteId} limit 1)`;

// Das Recht an einer einzelnen Seite über das Rechtemodell (#648): Abteilungsleitung, Plattformrollen, Stufenleitung, Sonderrechte, Gruppenrollen. Die Seite kommt aus der Abteilung der Person geladen (fremd = 404 vorher); abteilungId der Zeile sichert das zusätzlich. veroeffentlichen: Die Frage gilt dem Veröffentlichen und Zurückziehen. Wirft nie: Ein Fehler der Abfrage ist ein 500, nie «erlaubt»
export async function darfSeite(
  db: Pick<Db, "select" | "execute">,
  person: Person,
  zeile: { id: string; abteilungId?: string; tagId: string | null },
  { veroeffentlichen = false }: { veroeffentlichen?: boolean } = {},
) {
  if (siehtAlles(person)) return true;
  const [a] = await db
    .select({ id: anlass.id })
    .from(anlass)
    .where(eq(anlass.seiteId, zeile.id))
    .limit(1);
  return darf(
    db,
    person,
    veroeffentlichen ? "seiten.veroeffentlichen" : "seiten.bearbeiten",
    {
      abteilungId: zeile.abteilungId ?? person.abteilungId,
      seiteId: zeile.id,
      tagId: zeile.tagId,
      stufeId: zeile.tagId,
      anlassId: a?.id ?? null,
    },
  );
}

// Filter für Listen im Editor: nur Objekte der Abteilung der Person, die sie bearbeiten darf. spalten sind die Spalten der Objekttabelle
export function bearbeitbar(
  person: Person,
  objektTyp: ObjektTyp,
  spalten: {
    id: AnyColumn;
    abteilungId: AnyColumn;
    stufeId?: AnyColumn;
    tagId?: AnyColumn;
  },
): SQL {
  const eigeneAbteilung = sql`${spalten.abteilungId} = ${person.abteilungId}`;
  if (siehtAlles(person)) return eigeneAbteilung;
  const modus = rechteModus();
  const rechtSpalten = {
    abteilungId: spalten.abteilungId,
    id: spalten.id,
    stufeId: spalten.stufeId,
    tagId: spalten.tagId,
    anlassId: anlassDerSeite(spalten.id),
  };
  // Modus «neu»: nur das Rechtemodell entscheidet, in einer Bedingung für die ganze Liste
  if (modus === "neu") {
    return rechtSql(person, "seiten.bearbeiten", rechtSpalten);
  }
  // Schatten: der alte Weg und zusätzlich, was Plattform- und Gruppenrollen geben
  const ausRollen =
    modus === "alt"
      ? sql``
      : sql` or ${rechtSql(person, "seiten.bearbeiten", rechtSpalten, "rollen")}`;
  const stufen = person.rollen
    .filter((r) => r.typ === "stufenleitung")
    .map((r) => r.stufeId);
  const stufenrecht =
    spalten.stufeId && stufen.length > 0
      ? sql`${inArray(spalten.stufeId, stufen)} or `
      : sql``;
  const plattform = plattformRechtSql(person, [
    PLATTFORM_RECHT[objektTyp].bearbeiten,
  ]);
  return and(
    eigeneAbteilung,
    sql`(${stufenrecht}${plattform} or ${sonderrecht(person, objektTyp, spalten.id)}${
      spalten.tagId
        ? sql` or ${teamVerantwortung(person, spalten.tagId)}`
        : sql``
    }${ausRollen})`,
  ) as SQL;
}
