-- Rückweg zu 0068_lager_aufgaben (#372), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0068_lager_aufgaben.sql
-- Danach den Code auf den Stand vor 0068 zurückstellen (ohne Aufgaben).
-- Es gehen alle Aufgaben und ihre Unterstützung verloren.
DROP TABLE "aufgabe_unterstuetzung";
DROP TABLE "aufgabe";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
