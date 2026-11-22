-- Rückweg zu 0125_raum (#446), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0125_raum.sql
-- Danach den Code auf den Stand vor 0125 zurückstellen. Es gehen alle Räume verloren.
-- Spätere Tabellen, die auf raum zeigen (ab 0126, Raumanfragen), zuerst zurückbauen.
DROP TABLE "raum";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
