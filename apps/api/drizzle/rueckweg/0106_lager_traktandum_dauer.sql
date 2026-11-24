-- Rückweg zu 0106_lager_traktandum_dauer (#520), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0106_lager_traktandum_dauer.sql
-- Danach den Code auf den Stand vor 0106 zurückstellen.
-- Es gehen alle erfassten Dauern verloren.
ALTER TABLE "traktandum" DROP CONSTRAINT "traktandum_dauer_check";
ALTER TABLE "traktandum" DROP COLUMN "dauer_minuten";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
