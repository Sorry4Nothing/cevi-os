import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { profilbild, user } from "../db/schema.js";
import type { Baustein } from "./bausteine.js";
import type { Seitendokument } from "./dokument.js";
import type { WebsitePerson } from "./rendern.js";

// Personen der Plattform auf der öffentlichen Website (#560), für den Baustein «personen».
// Eine Person erscheint nur mit ausdrücklicher Freigabe (user.website_freigabe_am) und aktivem Konto; ohne Freigabe weder Name noch Bild.
// Das Bild ist ihr Profilbild. Der Abgleich legt es als Datei in die Ausgabe: Besucher rufen nie die Route der Plattform ab, und die Adresse verrät keine ID.

// Dateien der Profilbilder in der Ausgabe; der Abgleich löscht, was er nicht mehr braucht (Widerruf, neues Bild, Konto weg)
export const PERSON_DATEI = /^website\/person-[0-9a-f]{16}\.jpg$/;

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

// Eine Abfrage für alle Seiten des Laufs. dateien: [Pfad in der Ausgabe, Bytes] je Bild
export async function ladeWebsitePersonen(
  db: Pick<Db, "select">,
  abteilungId: string,
  ids: string[],
): Promise<{
  personen: Map<string, WebsitePerson>;
  dateien: [string, Uint8Array][];
}> {
  const personen = new Map<string, WebsitePerson>();
  const dateien = new Map<string, Uint8Array>();
  if (ids.length === 0) return { personen, dateien: [] };
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
        isNotNull(user.websiteFreigabeAm),
        isNull(user.deaktiviertAm),
        sql`${user.banned} is not true`,
      ),
    );
  for (const z of zeilen) {
    const name = anzeigename(z.ceviName, z.name);
    if (name === "") continue;
    let bild: string | undefined;
    if (z.bild) {
      const bytes = new Uint8Array(z.bild);
      // Der Name der Datei ist der Hash des Inhalts: ein neues Bild hat eine neue Adresse, und sie nennt keine Person
      const pfad = `website/person-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.jpg`;
      dateien.set(pfad, bytes);
      bild = `/${pfad}`;
    }
    personen.set(z.id, { name, ...(bild && { bild }) });
  }
  return { personen, dateien: [...dateien] };
}
