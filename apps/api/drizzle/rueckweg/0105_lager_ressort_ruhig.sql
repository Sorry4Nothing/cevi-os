-- Rückweg zu 0105_lager_ressort_ruhig (#520), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0105_lager_ressort_ruhig.sql
-- Danach den Code auf den Stand vor 0105 zurückstellen.
-- Es geht nur die Kennzeichnung «ruhig» der Ressorts verloren.
ALTER TABLE "ressort" DROP COLUMN "ruhig";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
