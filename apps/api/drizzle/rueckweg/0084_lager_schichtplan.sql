-- Rückweg zu 0084_lager_schichtplan (#388), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0084_lager_schichtplan.sql
-- Danach den Code auf den Stand vor 0084 zurückstellen (ohne Dienste und Schichtplan).
-- Es gehen alle Dienste und Schichten verloren.
DROP TABLE "schicht";
DROP TABLE "dienst";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
