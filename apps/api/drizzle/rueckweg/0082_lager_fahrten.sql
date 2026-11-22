-- Rückweg zu 0082_lager_fahrten (#386), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0082_lager_fahrten.sql
-- Danach den Code auf den Stand vor 0082 zurückstellen (ohne Fahrten).
-- Es gehen alle Fahrten und Mitfahrten verloren.
DROP TABLE "fahrt_mitfahrer";
DROP TABLE "fahrt";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
