import { inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  abteilungsleitungRecht,
  bearbeiter,
  gruppenRolle,
  gruppenRolleRecht,
  personPlattformRolle,
  personTag,
  plattformEntwickler,
  plattformRolle,
  plattformRolleRecht,
  raum,
  tag,
} from "../db/schema.js";
import type { Person } from "../rechte.js";
import { eintragVon, istRecht, type Bezug, type RechtId } from "./katalog.js";
import {
  MITGLIED_STANDARD,
  RAUM_TEAM_STANDARD,
  STUFENROLLEN_STANDARD,
} from "./standard.js";

// Hat der Entwickler der Abteilungsleitung dieser Abteilung das Recht weggenommen? Dieselbe Frage wie RechteSatz.alVerzichtet, für Listen
export const alVerzichtetSql = (abteilungId: string, recht: string): SQL =>
  sql`exists (select 1 from ${abteilungsleitungRecht} where ${abteilungsleitungRecht.abteilungId} = ${abteilungId} and ${recht} = any(${abteilungsleitungRecht.ohne}))`;

// Spalten der Tabelle, die die Liste abfragt; je nach Bezug des Rechts braucht es einige davon. Fehlt eine, trifft «eigene» nichts (fail-closed)
export interface RechtSpalten {
  abteilungId?: AnyColumn | SQL;
  // Die Seite (für die Sonderrechte je Seite)
  id?: AnyColumn | SQL;
  tagId?: AnyColumn | SQL;
  stufeId?: AnyColumn | SQL;
  anlassId?: AnyColumn | SQL;
  raumTeamTagId?: AnyColumn | SQL;
}

// Dieselbe Frage wie RechteSatz.hat, als Bedingung für eine Abfrage, die ohnehin über eine Liste läuft (Seitenlisten, Anfragen, Räume): nie «alles laden, dann je Zeile fragen». Zwei Darstellungen derselben Regel; test/rechtemodell-sql.test.ts hält sie gegeneinander (Property-Test über alle Rechte, Personen und Objekte).
// teil «rollen»: nur Plattform- und Gruppenrollen und der Entwickler, das, was der Schattenbetrieb zum alten Weg hinzufügt (darf.ts)
export function rechtSql(
  person: Pick<Person, "id" | "abteilungId" | "abteilungsleitung" | "rollen">,
  recht: string,
  spalten: RechtSpalten = {},
  teil: "alles" | "rollen" = "alles",
): SQL {
  if (!istRecht(recht)) return sql`false`;
  const e = eintragVon(recht);
  const abt = person.abteilungId;
  // Ein Objekt einer anderen Abteilung gibt nie etwas
  const abteilung = spalten.abteilungId
    ? sql`${spalten.abteilungId} = ${abt}`
    : sql`true`;
  const teile: SQL[] = [];
  const alles = teil === "alles";

  if (alles) {
    if (person.abteilungsleitung && !e.nurEntwickler) {
      if (e.art !== "vergebbar") return sql`${abteilung}`;
      // Die Abteilungsleitung hat jedes vergebbare Recht, ausser der Entwickler hat es ihr weggenommen (#663)
      teile.push(sql`not ${alVerzichtetSql(person.abteilungId, recht)}`);
    }
    if (e.art === "struktur") return sql`${abteilung}`;
  }
  // Der Entwickler hat jedes Recht des Katalogs (Entscheid vom 24.11.2026, #722); was jede Person ohnehin hat (struktur), bekommt er nicht doppelt
  if (e.art !== "struktur") {
    teile.push(
      sql`exists (select 1 from ${plattformEntwickler} where ${plattformEntwickler.userId} = ${person.id})`,
    );
  }
  if (e.art !== "vergebbar") return anwenden(abteilung, teile);

  teile.push(
    sql`exists (select 1 from ${personPlattformRolle} inner join ${plattformRolle} on ${plattformRolle.id} = ${personPlattformRolle.rolleId} and ${plattformRolle.abteilungId} = ${abt} inner join ${plattformRolleRecht} on ${plattformRolleRecht.rolleId} = ${plattformRolle.id} where ${personPlattformRolle.userId} = ${person.id} and ${plattformRolleRecht.recht} = ${recht})`,
  );

  // Gruppenrollen: die Rolle trägt das Recht, und die Geltung passt zum Objekt
  const eigene = e.geltungen.includes("eigene")
    ? gruppeBezug(e.bezug, spalten)
    : undefined;
  const geltung = [
    e.geltungen.includes("alle")
      ? sql`${gruppenRolleRecht.geltung} = 'alle'`
      : undefined,
    eigene
      ? sql`(${gruppenRolleRecht.geltung} = 'eigene' and ${eigene})`
      : undefined,
  ].filter((t): t is SQL => t !== undefined);
  if (geltung.length > 0) {
    teile.push(
      sql`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abt} inner join ${gruppenRolle} on ${gruppenRolle.id} = ${personTag.rolleId} and ${gruppenRolle.tagId} = ${personTag.tagId} and ${gruppenRolle.abteilungId} = ${abt} inner join ${gruppenRolleRecht} on ${gruppenRolleRecht.rolleId} = ${gruppenRolle.id} where ${personTag.userId} = ${person.id} and ${gruppenRolleRecht.recht} = ${recht} and (${sql.join(geltung, sql` or `)}))`,
    );
  }
  if (!alles) return anwenden(abteilung, teile);

  // Stufenrollen aus der Sitzung
  for (const typ of ["stufenleitung", "leitung"] as const) {
    const stufen = person.rollen
      .filter(
        (r) =>
          r.typ === typ || (typ === "leitung" && r.typ === "stufenleitung"),
      )
      .map((r) => r.stufeId);
    if (stufen.length === 0) continue;
    for (const z of STUFENROLLEN_STANDARD[typ]) {
      if (z.recht !== recht) continue;
      if (z.geltung === "alle") teile.push(sql`true`);
      else if (spalten.stufeId) {
        teile.push(
          sql`${inArray(sql`${spalten.stufeId}`, [...new Set(stufen)])}`,
        );
      }
    }
  }

  // Mitgliedschaft ohne Rolle
  for (const [typ, standard] of Object.entries(MITGLIED_STANDARD)) {
    for (const z of standard) {
      if (z.recht !== recht) continue;
      const typBedingung = sql`${tag.typ} = ${typ}`;
      if (z.geltung === "alle") {
        teile.push(
          sql`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abt} where ${personTag.userId} = ${person.id} and ${typBedingung})`,
        );
      } else if (spalten.raumTeamTagId) {
        teile.push(
          sql`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abt} where ${personTag.userId} = ${person.id} and ${typBedingung} and ${personTag.tagId} = ${spalten.raumTeamTagId})`,
        );
      }
    }
  }
  if (RAUM_TEAM_STANDARD.some((z) => z.recht === recht)) {
    teile.push(
      sql`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abt} inner join ${raum} on ${raum.teamTagId} = ${personTag.tagId} and ${raum.abteilungId} = ${abt} where ${personTag.userId} = ${person.id})`,
    );
  }

  // Sonderrechte je Seite
  if (
    (recht === "seiten.bearbeiten" || recht === "seiten.veroeffentlichen") &&
    spalten.id
  ) {
    teile.push(
      sql`exists (select 1 from ${bearbeiter} where ${bearbeiter.abteilungId} = ${abt} and ${bearbeiter.objektTyp} = 'seite' and ${bearbeiter.objektId} = ${spalten.id} and (${bearbeiter.userId} = ${person.id} or ${bearbeiter.tagId} in (select ${personTag.tagId} from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${abt} where ${personTag.userId} = ${person.id})))`,
    );
  }
  return anwenden(abteilung, teile);
}

function anwenden(abteilung: SQL, teile: SQL[]): SQL {
  if (teile.length === 0) return sql`false`;
  return sql`(${abteilung} and (${sql.join(teile, sql` or `)}))`;
}

// Die Bedingung «die Gruppe der Rolle (tag) gehört zum Objekt», je Bezug; `tag` ist die Tabelle der Gruppe in der Unterabfrage
function gruppeBezug(
  bezug: Bezug | undefined,
  s: RechtSpalten,
): SQL | undefined {
  switch (bezug) {
    case "seite": {
      const nachTag = s.tagId ? sql`${tag.id} = ${s.tagId}` : undefined;
      const nachAnlass = s.anlassId
        ? sql`(${tag.anlassId} is not null and ${tag.anlassId} = ${s.anlassId})`
        : undefined;
      const teile = [nachTag, nachAnlass].filter((t): t is SQL => !!t);
      return teile.length > 0
        ? sql`(${sql.join(teile, sql` or `)})`
        : undefined;
    }
    case "anlass":
      return s.anlassId
        ? sql`(${tag.anlassId} is not null and ${tag.anlassId} = ${s.anlassId})`
        : undefined;
    case "raum":
      return s.raumTeamTagId ? sql`${tag.id} = ${s.raumTeamTagId}` : undefined;
    case "gruppe":
      return s.tagId ? sql`${tag.id} = ${s.tagId}` : undefined;
    default:
      return undefined;
  }
}

export type { RechtId };
