-- Rückweg zu 0103_anwesenheit_teilnehmer_fk (#384), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0103_anwesenheit_teilnehmer_fk.sql
-- Danach den Code auf den Stand vor 0103 zurückstellen. Entfernt nur den Fremdschlüssel; Einträge, die die Migration vorwärts gelöscht hat, kommen nicht zurück.
ALTER TABLE "anwesenheit" DROP CONSTRAINT "anwesenheit_teilnehmer_fk";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
