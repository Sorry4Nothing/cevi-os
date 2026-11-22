-- Rückweg zu 0077_lager_umfragen (#382), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0077_lager_umfragen.sql
-- Danach den Code auf den Stand vor 0077 zurückstellen (ohne Umfragen und Reaktionen).
-- Es gehen alle Umfragen, Stimmen und Reaktionen verloren; die Beiträge der Pinnwand bleiben.
DROP TABLE "reaktion";
DROP TABLE "umfrage_stimme";
DROP TABLE "umfrage_option";
DROP TABLE "umfrage";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
