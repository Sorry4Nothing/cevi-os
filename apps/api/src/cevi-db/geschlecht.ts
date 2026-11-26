import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { user } from "../db/schema.js";
import { GESCHLECHTER } from "../geschlecht.js";
import { keinKindKonto } from "../kind-konto.js";
import type { CeviPerson } from "./felder.js";

// Übernimmt das Geschlecht aus der Cevi-Datenbank in die Konten der Abteilung (#843). Nur Konten mit gemerkter Nummer (eindeutig zugeordnet, cevi-db/vorschlag.ts), nie das Konto eines Kindes, nie eine Angabe, die jemand im Blatt der Person gesetzt oder geändert hat. Eine Angabe aus der Cevi-Datenbank folgt ihr: Ändert sie sich dort oder fehlt sie, ändert oder leert Cevi OS sie auch. Gibt die Zahl der geänderten Konten zurück.
export async function uebernehmeGeschlecht(
  db: Db,
  abteilungId: string,
  personen: readonly CeviPerson[],
) {
  let geaendert = 0;
  for (const wert of [...GESCHLECHTER, null]) {
    const nummern = personen
      .filter((p) => p.geschlecht === wert)
      .map((p) => p.id);
    if (nummern.length === 0) continue;
    const zeilen = await db
      .update(user)
      .set({ geschlecht: wert })
      .where(
        and(
          eq(user.abteilungId, abteilungId),
          inArray(user.ceviDbId, nummern),
          eq(user.geschlechtVonHand, false),
          sql`${user.geschlecht} is distinct from ${wert}`,
          keinKindKonto(user.id),
        ),
      )
      .returning({ id: user.id });
    geaendert += zeilen.length;
  }
  return geaendert;
}
