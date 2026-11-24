import { HTTPException } from "hono/http-exception";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  abteilungsleitungPerson,
  bearbeiter,
  personPlattformRolle,
  personTag,
  plattformEntwickler,
  plattformRolle,
  rolle,
  user,
} from "../db/schema.js";
import type { Person } from "../rechte.js";
import { darf, ZweiterFaktorFehlt } from "./darf.js";
import { rechteModus } from "./modus.js";
import { ladeRechteSatz, type Objekt } from "./satz.js";
import { rechtSql, type RechtSpalten } from "./sql.js";

// Bausteine der Umstellung von Personen, Kindern, Stufen, Gruppen, Import, Anwesenheit und Programmen auf darf() (#650). Hier steht, was mehrere Routen teilen; die Regeln je Route stehen in der Route.

type Lesbar = Pick<Db, "select" | "execute">;

// Das Objekt einer Stufe (die Stufe ist zugleich eine Gruppe): Stufenrollen treffen über stufeId, Gruppenrollen über tagId
export const stufeObjekt = (
  person: Pick<Person, "abteilungId">,
  stufeId: string,
): Objekt => ({ abteilungId: person.abteilungId, stufeId, tagId: stufeId });

// Das Objekt einer Gruppe (Tag jedes Typs)
export const gruppeObjekt = (
  person: Pick<Person, "abteilungId">,
  tagId: string,
): Objekt => ({ abteilungId: person.abteilungId, tagId });

// Das Recht und der zweite Faktor, ohne zu werfen: für Pfade, die bei fehlendem Recht etwas anderes tun als 403 (ein 404, eine kleinere Antwort). Fehlt der Faktor, gilt das Recht nicht
export async function hatRechtMitFaktor(
  db: Lesbar,
  person: Person,
  recht: string,
  objekt?: Objekt,
): Promise<boolean> {
  if (!(await darf(db, person, recht, objekt))) return false;
  if (person.zweiterFaktor) return true;
  return !(await ladeRechteSatz(db, person)).braucht2Faktor(recht, objekt);
}

// Mindestens eines der Rechte verlangen, am selben Objekt: sonst 403, und 403 ZWEITER_FAKTOR_FEHLT, wenn die Person eines hat, aber den Faktor nicht
export async function verlangeEines(
  db: Lesbar,
  person: Person,
  rechte: readonly string[],
  objekt?: Objekt,
): Promise<string> {
  let ohneFaktor = false;
  for (const recht of rechte) {
    if (!(await darf(db, person, recht, objekt))) continue;
    if (await hatRechtMitFaktor(db, person, recht, objekt)) return recht;
    ohneFaktor = true;
  }
  if (ohneFaktor) throw new ZweiterFaktorFehlt();
  throw new HTTPException(403);
}

// Wie weit die Person die Personenliste sieht (#650): «voll» mit Startpasswörtern (Personen verwalten), «lesen» ohne sie (Personen sehen). Ohne eines der beiden Rechte: 403. Wer Mitglieder einer Gruppe ändert, braucht zum Auswählen «Personen sehen» dazu
export type PersonenSicht = "voll" | "lesen";

export async function personenSicht(
  db: Lesbar,
  person: Person,
): Promise<PersonenSicht> {
  const recht = await verlangeEines(db, person, [
    "personen.verwalten",
    "personen.sehen",
  ]);
  return recht === "personen.verwalten" ? "voll" : "lesen";
}

// Konten, die nur die Abteilungsleitung betreut (Eskalationsschutz, #650): wer zurücksetzen, deaktivieren oder ändern darf, übernimmt sonst ein Konto mit Rechten, die er selbst nicht hat. Das sind die Abteilungsleitung, Entwickler, Personen mit einer Plattformrolle, einer Rolle in einer Gruppe (auch einer Stufenrolle) und Personen mit einem Sonderrecht an einer Seite. Eine Abfrage; nur Kennungen
export async function geschuetzteKonten(
  db: Pick<Db, "execute">,
  abteilungId: string,
  userIds?: readonly string[],
): Promise<Set<string>> {
  const nur: SQL =
    userIds && userIds.length > 0
      ? sql`and ${user.id} in (${sql.join(
          userIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const zeilen = (await db.execute(sql`
    select ${user.id} as id from ${user}
    where ${user.abteilungId} = ${abteilungId} ${nur}
      and (
        exists (select 1 from ${abteilungsleitungPerson} where ${abteilungsleitungPerson.userId} = ${user.id})
        or exists (select 1 from ${plattformEntwickler} where ${plattformEntwickler.userId} = ${user.id})
        or exists (select 1 from ${personPlattformRolle} inner join ${plattformRolle} on ${plattformRolle.id} = ${personPlattformRolle.rolleId} and ${plattformRolle.abteilungId} = ${abteilungId} where ${personPlattformRolle.userId} = ${user.id})
        or exists (select 1 from ${personTag} where ${personTag.userId} = ${user.id} and ${personTag.rolleId} is not null)
        or exists (select 1 from ${rolle} where ${rolle.userId} = ${user.id})
        or exists (select 1 from ${bearbeiter} where ${bearbeiter.abteilungId} = ${abteilungId} and ${bearbeiter.userId} = ${user.id})
      )`)) as unknown as { id: string }[];
  return new Set([...zeilen].map((z) => z.id));
}

// Eine Bedingung für eine Liste in SQL, je nach Modus (modus.ts): «alt» nur der alte Weg, «schatten» der alte Weg und, was Plattform- und Gruppenrollen zusätzlich geben, «neu» nur der Rechtesatz. Der alte Weg ist eine Bedingung oder ein Wahrheitswert, den die Route aus der Person kennt
export function listenBedingung(
  person: Person,
  recht: string,
  alt: SQL | boolean,
  spalten: RechtSpalten = {},
): SQL {
  const altSql =
    typeof alt === "boolean" ? (alt ? sql`true` : sql`false`) : alt;
  switch (rechteModus()) {
    case "alt":
      return altSql;
    case "schatten":
      return sql`(${altSql} or ${rechtSql(person, recht, spalten, "rollen")})`;
    case "neu":
      return rechtSql(person, recht, spalten);
  }
}

// Die Stufen unter den gefragten, deren Kinder die Person sehen darf («Kinder sehen» oder «Kinder verwalten», je Stufe, mit zweitem Faktor). Eine kleine Rechnung je Stufe, nie je Kind
export async function sichtbareKinderStufen(
  db: Lesbar,
  person: Person,
  stufeIds: Iterable<string>,
  rechte: readonly string[] = ["kinder.sehen", "kinder.verwalten"],
): Promise<Set<string>> {
  const erlaubt = new Set<string>();
  for (const stufeId of new Set(stufeIds)) {
    for (const recht of rechte) {
      if (
        await hatRechtMitFaktor(db, person, recht, stufeObjekt(person, stufeId))
      ) {
        erlaubt.add(stufeId);
        break;
      }
    }
  }
  return erlaubt;
}
