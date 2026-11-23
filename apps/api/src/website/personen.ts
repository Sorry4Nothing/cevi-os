import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { personTag, profilbild, tag, user } from "../db/schema.js";
import type { Baustein } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";
import type { StufenMitglied, WebsitePerson } from "./rendern.js";

// Personen der Plattform auf der öffentlichen Website (#560, Regel seit #610): Eine Person erscheint, wenn sie eine Rolle mit Aussenwirkung hat, und aktiv ist (Konto nicht gesperrt oder deaktiviert).
// Das ist keine Wahl der Person und keine Freigabe: Wer Leitung oder Stufenleitung einer Stufe ist, steht auf der Seite der Stufe. Kinder sind eigene Datensätze (Tabelle kind) und kommen hier nie vor; keine E-Mail, kein Telefon.
// Das Bild ist ihr Profilbild. Der Abgleich legt es als Datei in die Ausgabe: Besucher rufen nie die Route der Plattform ab, und die Adresse verrät keine ID.

// Dateien der Profilbilder in der Ausgabe; der Abgleich löscht, was er nicht mehr braucht (neues Bild, Rolle weg, Konto weg)
export const PERSON_DATEI = /^website\/person-[0-9a-f]{16}\.jpg$/;

// Rollen mit Aussenwirkung (Stufenrollen, siehe schema.ts «rolle»); weitere Rollen kommen mit dem Rollenkatalog (#585)
export const AUSSENROLLEN = ["leitung", "stufenleitung"] as const;
const ROLLEN_SQL = sql.raw(AUSSENROLLEN.map((r) => `'${r}'`).join(", "));

// Hat die Person (in der Abfrage auf «user») eine Rolle mit Aussenwirkung in einer Stufe ihrer Abteilung?
export const hatAussenrolle = sql<boolean>`exists (select 1 from person_tag as aussen_pt inner join tag as aussen_tag on aussen_tag.id = aussen_pt.tag_id where aussen_pt.user_id = ${user.id} and aussen_tag.typ = 'stufe' and aussen_tag.abteilung_id = ${user.abteilungId} and aussen_pt.rolle in (${ROLLEN_SQL}))`;

// IDs der Personen, die in Bausteinen «personen» stehen
export function personenIn(dokumente: Iterable<Seitendokument>): string[] {
  const ids = new Set<string>();
  for (const dok of dokumente) {
    for (const b of dok.bausteine as Baustein[]) {
      if (b.typ === "personen") {
        b.daten.eintraege.forEach((e) => ids.add(e.personId.toLowerCase()));
      }
    }
  }
  return [...ids];
}

// Anzeigename: der Cevi-Name, sonst der Vorname (das erste Wort des Namens im Konto); nie der ganze Name
const anzeigename = (ceviName: string | null, name: string) =>
  ceviName?.trim() || name.trim().split(/\s+/)[0] || "";

const AKTIV = and(isNull(user.deaktiviertAm), sql`${user.banned} is not true`);

// Eine Abfrage je Art für alle Seiten des Laufs. ids: Personen der Bausteine «personen»; stufenIds: Stufen-Tags der Bausteine «leitungsteam».
// dateien: [Pfad in der Ausgabe, Bytes] je Bild
export async function ladeWebsitePersonen(
  db: Pick<Db, "select">,
  abteilungId: string,
  ids: string[],
  stufenIds: string[] = [],
): Promise<{
  personen: Map<string, WebsitePerson>;
  stufenteams: Map<string, StufenMitglied[]>;
  dateien: [string, Uint8Array][];
}> {
  const personen = new Map<string, WebsitePerson>();
  const stufenteams = new Map<string, StufenMitglied[]>();
  const dateien = new Map<string, Uint8Array>();
  // Der Name der Datei ist der Hash des Inhalts: ein neues Bild hat eine neue Adresse, und sie nennt keine Person
  const bildAdresse = (inhalt: Buffer | Uint8Array | null) => {
    if (!inhalt) return undefined;
    const bytes = new Uint8Array(inhalt);
    const pfad = `website/person-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.jpg`;
    dateien.set(pfad, bytes);
    return `/${pfad}`;
  };
  if (ids.length > 0) {
    const zeilen = await db
      .select({
        id: user.id,
        name: user.name,
        ceviName: user.ceviName,
        bild: profilbild.inhalt,
      })
      .from(user)
      .leftJoin(profilbild, eq(profilbild.userId, user.id))
      .where(
        and(
          eq(user.abteilungId, abteilungId),
          inArray(user.id, ids),
          hatAussenrolle,
          AKTIV,
        ),
      );
    for (const z of zeilen) {
      const name = anzeigename(z.ceviName, z.name);
      if (name === "") continue;
      const bild = bildAdresse(z.bild);
      personen.set(z.id, { name, ...(bild && { bild }) });
    }
  }
  if (stufenIds.length > 0) {
    const zeilen = await db
      .select({
        tagId: personTag.tagId,
        name: user.name,
        ceviName: user.ceviName,
        rolle: personTag.rolle,
        bild: profilbild.inhalt,
      })
      .from(personTag)
      .innerJoin(
        tag,
        and(
          eq(tag.id, personTag.tagId),
          eq(tag.typ, "stufe"),
          eq(tag.abteilungId, abteilungId),
        ),
      )
      .innerJoin(
        user,
        and(eq(user.id, personTag.userId), eq(user.abteilungId, abteilungId)),
      )
      .leftJoin(profilbild, eq(profilbild.userId, user.id))
      .where(
        and(
          inArray(personTag.tagId, stufenIds),
          inArray(personTag.rolle, [...AUSSENROLLEN]),
          AKTIV,
        ),
      )
      // Stufenleitung vor Leitung, dann die Reihenfolge der Kontakte (null zuletzt) und der Name
      .orderBy(
        sql`${personTag.rolle} = 'stufenleitung' desc`,
        sql`${personTag.prioritaet} asc nulls last`,
        asc(user.name),
        asc(user.id),
      );
    for (const z of zeilen) {
      const name = anzeigename(z.ceviName, z.name);
      if (name === "") continue;
      const bild = bildAdresse(z.bild);
      const liste = stufenteams.get(z.tagId) ?? [];
      liste.push({
        name,
        funktion: z.rolle === "stufenleitung" ? "Stufenleitung" : "Leitung",
        ...(bild && { bild }),
      });
      stufenteams.set(z.tagId, liste);
    }
  }
  return { personen, stufenteams, dateien: [...dateien] };
}
