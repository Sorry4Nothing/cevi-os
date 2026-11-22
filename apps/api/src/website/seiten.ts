import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { darfBearbeiten, TEAM_ROLLE } from "../bearbeiten.js";
import type { Db } from "../db/client.js";
import {
  abteilung,
  bearbeiter,
  personPlattformRolle,
  personTag,
  plattformEntwickler,
  plattformRolle,
  plattformRolleRecht,
  tag,
} from "../db/schema.js";
import type { Person } from "../rechte.js";

// Ein Pfadstück der Adresse: a-z, 0-9 und «-» (die Datenbank prüft dasselbe mit CHECK)
export const adresseSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);
export const MAX_TIEFE = 5;
// Auf der obersten Ebene gehören diese Adressen der API, der Verwaltung und den Dateien der Website; Unterseiten dürfen sie tragen.
// «sitemap.xml», «robots.txt» und «.well-known» scheitern schon am Format, stehen hier aber mit, damit die Liste die Regel nennt
export const RESERVIERTE_ADRESSEN: readonly string[] = [
  "api",
  "admin",
  "health",
  "datenschutz",
  "konto-loeschen",
  "support",
  "website",
  "anmelden",
  "medien",
  "ical",
  "sitemap.xml",
  "robots.txt",
  ".well-known",
];

export type SeitenKnoten = {
  id: string;
  elternId: string | null;
  adresse: string;
  reihenfolge: number;
  tagId: string | null;
};
export type Knoten = Map<string, SeitenKnoten>;

// Ketten über elternId, wie viele Schritte höchstens: Eine kaputte Zeile in der Datenbank darf nie eine Endlosschleife machen
const SCHUTZ = 100;

// Adressen von der Wurzel bis zur Seite; leer, wenn die Seite fehlt
export function adressenVon(knoten: Knoten, id: string): string[] {
  const kette: string[] = [];
  for (
    let k = knoten.get(id), n = 0;
    k && n < SCHUTZ;
    k = k.elternId ? knoten.get(k.elternId) : undefined, n++
  ) {
    kette.unshift(k.adresse);
  }
  return kette;
}

// Ebenen von der Wurzel bis zur Seite (Wurzelseite = 1)
export const tiefeVon = (knoten: Knoten, id: string) =>
  adressenVon(knoten, id).length;

// Ebenen im Teilbaum unter der Seite, sie selbst eingerechnet
export function hoeheVon(knoten: Knoten, id: string, n = 0): number {
  if (n >= SCHUTZ) return n;
  let tiefste = 0;
  for (const k of knoten.values()) {
    if (k.elternId === id)
      tiefste = Math.max(tiefste, hoeheVon(knoten, k.id, n + 1));
  }
  return tiefste + 1;
}

// Hängt «id» unter «elternId» (null = Wurzel; id undefined = neue Seite), ohne Zyklus und höchstens MAX_TIEFE Ebenen?
export function pruefeLage(
  knoten: Knoten,
  id: string | undefined,
  elternId: string | null,
): "ok" | "zyklus" | "zu_tief" {
  if (id !== undefined && elternId !== null) {
    // Zyklus: Die Seite ist selbst oder ein Vorfahre der neuen Elternseite
    const vorfahren = new Set<string>();
    for (
      let k = knoten.get(elternId), n = 0;
      k && n < SCHUTZ;
      k = k.elternId ? knoten.get(k.elternId) : undefined, n++
    ) {
      vorfahren.add(k.id);
    }
    if (vorfahren.has(id)) return "zyklus";
  }
  const oben = elternId === null ? 0 : tiefeVon(knoten, elternId);
  const unten = id === undefined ? 1 : hoeheVon(knoten, id);
  return oben + unten > MAX_TIEFE ? "zu_tief" : "ok";
}

// Die beiden Wege zum Zugang ohne Amt, als SQL-Bedingung: eine Zeile in «bearbeiter» für Seiten (auf die Person oder einen Tag, den sie trägt) und die Verantwortung für ein Team (#352)
const bearbeiterZugang = (person: Person) =>
  sql`exists (select 1 from ${bearbeiter} where ${bearbeiter.abteilungId} = ${person.abteilungId} and ${bearbeiter.objektTyp} = 'seite' and (${bearbeiter.userId} = ${person.id} or ${bearbeiter.tagId} in (select ${personTag.tagId} from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} and ${tag.abteilungId} = ${person.abteilungId} where ${personTag.userId} = ${person.id})))`;
const teamZugang = (person: Person) =>
  sql`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} where ${personTag.userId} = ${person.id} and lower(${personTag.rolle}) = ${TEAM_ROLLE} and ${tag.typ} = 'team' and ${tag.abteilungId} = ${person.abteilungId})`;

// Eine Plattformrolle mit mindestens einem Recht oder die Zeile des Entwicklers (#423). Als eigener Ausdruck: Drizzle liesse in einer Auswahl mit nur einer Tabelle den Tabellennamen vor Spalten weg, die direkt im Text stehen
const plattformZugang = (person: Person) =>
  sql`(exists (select 1 from ${personPlattformRolle} inner join ${plattformRolle} on ${plattformRolle.id} = ${personPlattformRolle.rolleId} and ${plattformRolle.abteilungId} = ${person.abteilungId} inner join ${plattformRolleRecht} on ${plattformRolleRecht.rolleId} = ${plattformRolle.id} where ${personPlattformRolle.userId} = ${person.id}) or exists (select 1 from ${plattformEntwickler} where ${plattformEntwickler.userId} = ${person.id}))`;

// Zugang zum Namensraum /api/v1/redaktion: Abteilungsleitung, Stufenleitung, Verantwortliche eines Teams (#352) oder eine Zeile in «bearbeiter» für Seiten (auf die Person oder einen Tag, den sie trägt).
// Das Recht an einer einzelnen Seite prüft darfBearbeiten; dies ist nur die Tür. #426 öffnet sie für die Rechte der Plattformrollen (plattform.ts), indem es diese Funktion ändert
export async function hatRedaktionszugang(db: Db, person: Person) {
  if (person.admin || person.rollen.some((r) => r.typ === "stufenleitung")) {
    return true;
  }
  const [zeile] = await db
    .select({
      ok: sql<boolean>`${bearbeiterZugang(person)} or ${teamZugang(person)}`,
    })
    .from(abteilung)
    .where(eq(abteilung.id, person.abteilungId));
  return zeile?.ok === true;
}

// Hat die Person ein erweitertes Recht (#423)? Das sind die Abteilungsleitung, jede Plattformrolle mit einem Recht (und der Entwickler), eine Zeile in «bearbeiter» und die Verantwortung für ein Team. Einfach ist nur das Amt der Stufenleitung an der eigenen Stufenseite: Wer sonst nichts hat, braucht keinen zweiten Faktor.
// Eine Abfrage; sie entfällt für Admins und für Personen, die den zweiten Faktor schon haben (der Aufrufer prüft das zuerst)
export async function hatErweitertesRecht(db: Db, person: Person) {
  if (person.admin) return true;
  const [zeile] = await db
    .select({
      ok: sql<boolean>`${plattformZugang(person)} or ${bearbeiterZugang(person)} or ${teamZugang(person)}`,
    })
    .from(abteilung)
    .where(eq(abteilung.id, person.abteilungId));
  return zeile?.ok === true;
}

// Neue Seiten anlegen, löschen und eine Seite auf die oberste Ebene setzen: Abteilungsleitung und Redaktion (Zeile in «bearbeiter» ohne Objekt, «alle Seiten»). Die Nil-UUID trifft nur eine solche Zeile
const KEINE_SEITE = "00000000-0000-0000-0000-000000000000";
export const darfSeitenVerwalten = (db: Pick<Db, "select">, person: Person) =>
  darfBearbeiten(db, person, "seite", KEINE_SEITE);
