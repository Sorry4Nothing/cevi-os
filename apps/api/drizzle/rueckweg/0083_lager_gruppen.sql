-- Rückweg zu 0083_lager_gruppen (#387), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0083_lager_gruppen.sql
-- Danach den Code auf den Stand vor 0083 zurückstellen (ohne Gruppen und ohne «nicht dabei»).
-- Es gehen alle Gruppen, ihre Zuordnungen und die Abwahl der Teilnehmenden verloren; die Teilnehmenden selbst bleiben.
DROP TABLE "gruppe_zuordnung";
DROP TABLE "gruppe";
ALTER TABLE "teilnehmer" DROP COLUMN "abgewaehlt";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
