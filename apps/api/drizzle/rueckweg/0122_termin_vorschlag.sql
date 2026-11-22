-- Rückweg zu 0122_termin_vorschlag (#439), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0122_termin_vorschlag.sql
-- Danach den Code auf den Stand vor 0122 zurückstellen. Es gehen alle Terminvorschläge mit ihrem Status verloren.
-- Spätere Tabellen, die auf termin_vorschlag zeigen, zuerst zurückbauen.
DROP TABLE "termin_vorschlag";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
