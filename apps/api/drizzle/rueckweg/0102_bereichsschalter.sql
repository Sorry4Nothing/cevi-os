-- Rückweg zu 0102_bereichsschalter (#424), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0102_bereichsschalter.sql
-- Danach den Code auf den Stand vor 0102 zurückstellen (ohne Wartungsmodus und Sperre).
-- Es gehen alle gerade aktiven Schalter verloren, die Einträge im Audit-Log bleiben.
DROP TABLE "bereichsschalter";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
