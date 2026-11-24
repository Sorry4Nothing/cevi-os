import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Nur der Besitzer der Tabellen migriert; die API-Rolle darf das Schema nicht ändern
const url = process.env.MIGRATION_DATABASE_URL;
// Nur der Name: Die URL kann ein Passwort enthalten
if (!url) throw new Error("Fehlende Umgebungsvariable: MIGRATION_DATABASE_URL");

// Eine Verbindung für die DDL; die NOTICEs des Migrators («already exists») sind kein Fehler
const sql = postgres(url, { max: 1, onnotice: () => {} });

// Wie viele Migrationen schon angewendet sind; ohne Schema (erster Lauf) null
const angewendet = () =>
  sql<
    { n: number }[]
  >`select count(*)::int as n from drizzle.__drizzle_migrations`
    .then((z) => z[0]?.n ?? 0)
    .catch(() => 0);

try {
  const vorher = await angewendet();
  await migrate(drizzle(sql), {
    // Unabhängig vom Arbeitsverzeichnis
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  const neu = (await angewendet()) - vorher;
  // Änderungsprotokoll (#662): Ein Update der Datenbank ist eine Änderung mit Wirkung. Nur bei einem Update (vorher gab es schon Migrationen), nie beim ersten Aufbau; scheitert das Schreiben, bleibt die Migration gültig
  if (vorher > 0 && neu > 0) {
    await sql`insert into aktivitaet (art, akteur, aktion, bereich, ergebnis, anzahl) values ('system', 'system', 'migration', 'system', 'erfolg', ${neu})`.catch(
      () => {},
    );
  }
} finally {
  await sql.end();
}
