import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { user } from "../db/schema.js";
import { GESCHLECHTER, type Geschlecht } from "../geschlecht.js";
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
    geaendert += await setze(
      db,
      abteilungId,
      inArray(user.ceviDbId, nummern),
      wert,
    );
  }
  return geaendert;
}

// Für ein Konto, das der tägliche Abgleich nur über Vorname plus Nachname zuordnet (#857): dieselben Grenzen, aber ohne gemerkte Nummer
export const uebernehmeGeschlechtFuerKonto = (
  db: Db,
  abteilungId: string,
  kontoId: string,
  wert: Geschlecht | null,
) => setze(db, abteilungId, eq(user.id, kontoId), wert);

async function setze(
  db: Db,
  abteilungId: string,
  welche: SQL,
  wert: Geschlecht | null,
) {
  const zeilen = await db
    .update(user)
    .set({ geschlecht: wert })
    .where(
      and(
        eq(user.abteilungId, abteilungId),
        welche,
        eq(user.geschlechtVonHand, false),
        sql`${user.geschlecht} is distinct from ${wert}`,
        keinKindKonto(user.id),
      ),
    )
    .returning({ id: user.id });
  return zeilen.length;
}
