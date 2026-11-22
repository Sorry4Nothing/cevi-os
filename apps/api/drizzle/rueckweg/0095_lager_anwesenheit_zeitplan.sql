-- Rückweg zu 0095_lager_anwesenheit_zeitplan (#374), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0095_lager_anwesenheit_zeitplan.sql
-- Danach den Code auf den Stand vor 0095 zurückstellen. Entfernt nur die Fremdschlüssel und den Index; Einträge, die die Migration vorwärts gelöscht hat, kommen nicht zurück.
DROP INDEX "anwesenheit_abschnitt_idx";
ALTER TABLE "anwesenheit_anfrage" DROP CONSTRAINT "anwesenheit_anfrage_abschnitt_fk";
ALTER TABLE "anwesenheit_anfrage" DROP CONSTRAINT "anwesenheit_anfrage_lagertag_fk";
ALTER TABLE "anwesenheit" DROP CONSTRAINT "anwesenheit_abschnitt_fk";
ALTER TABLE "anwesenheit" DROP CONSTRAINT "anwesenheit_lagertag_fk";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
