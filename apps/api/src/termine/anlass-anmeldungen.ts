/* eslint-disable @typescript-eslint/no-unused-vars -- Rümpfe bis #443 */
import type { Db } from "../db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Was die Verwaltung der Anlässe (#442) über Anmeldungen wissen muss. Die Tabelle der Anmeldungen kommt mit #443 (Migration 0124): Bis dahin gibt es keine, und beide Funktionen antworten «keine».
// #443 ersetzt die Rümpfe durch Abfragen auf die Tabelle; die Routen und ihre Tests bleiben. Beide laufen in der Transaktion der Route, die den Anlass schon gesperrt hat (FOR UPDATE).

// Wie viele Anmeldungen der Anlass hat (Löschen und «anmeldungFuer» ändern sind nur ohne Anmeldungen erlaubt)
export async function zaehleAnmeldungen(
  _tx: Db | Tx,
  _anlassId: string,
): Promise<number> {
  return 0;
}

// Die Schlüssel der Felder des Anlasses, zu denen es Antworten gibt (Schlüssel und Typ dieser Felder sind fest)
export async function schluesselMitAntworten(
  _tx: Db | Tx,
  _anlassId: string,
): Promise<Set<string>> {
  return new Set();
}
