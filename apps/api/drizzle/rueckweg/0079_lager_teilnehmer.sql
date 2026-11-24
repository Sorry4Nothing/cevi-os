-- Rückweg zu 0079_lager_teilnehmer (#384), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0079_lager_teilnehmer.sql
-- Danach den Code auf den Stand vor 0079 zurückstellen (ohne Teilnehmende und Abzählen).
-- Es gehen alle Teilnehmenden und alle Haken des Abzählens verloren.
DROP TABLE "abzaehlen";
DROP TABLE "teilnehmer";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
