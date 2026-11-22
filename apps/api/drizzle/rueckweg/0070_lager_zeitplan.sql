-- Rückweg zu 0070_lager_zeitplan (#374), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0070_lager_zeitplan.sql
-- Danach den Code auf den Stand vor 0070 zurückstellen (ohne Zeitplan). Steht 0095 schon, zuerst deren Rückweg ausführen (die Fremdschlüssel von anwesenheit zeigen auf lagertag und tagesabschnitt).
-- Es gehen alle Meilensteine, Lagertage und Tagesabschnitte verloren sowie der Bezug der relativen Fristen; die berechnete Frist bleibt als absolutes Datum stehen.
ALTER TABLE "aufgabe" DROP CONSTRAINT "aufgabe_relative_frist_check";
ALTER TABLE "aufgabe" DROP CONSTRAINT "aufgabe_frist_meilenstein_fk";
DROP INDEX "aufgabe_frist_meilenstein_idx";
DROP INDEX "aufgabe_erinnerung_idx";
ALTER TABLE "aufgabe" DROP COLUMN "frist_versatz_tage";
ALTER TABLE "aufgabe" DROP COLUMN "frist_meilenstein_id";
DROP TABLE "tagesabschnitt";
DROP TABLE "lagertag";
DROP TABLE "meilenstein";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
