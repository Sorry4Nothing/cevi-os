-- Rückweg zu 0062_lager_sync (#366), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0062_lager_sync.sql
-- Danach den Code auf den Stand vor 0062 zurückstellen (ohne Sync-Kern).
-- Es geht der Änderungsfeed aller Lager verloren; die Apps laden danach neu. Zeilenversionen und Folgenummern der Lager-Tabellen späterer Issues bleiben stehen und gelten nicht mehr.
DROP TABLE "lager_aenderung";
ALTER TABLE "lager" DROP CONSTRAINT "lager_seq_check";
ALTER TABLE "lager" DROP COLUMN "seq_min";
ALTER TABLE "lager" DROP COLUMN "seq";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
