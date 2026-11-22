-- Rückweg zu 0080_lager_zimmer (#385), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0080_lager_zimmer.sql
-- Danach den Code auf den Stand vor 0080 zurückstellen (ohne Zimmer und Zelte).
-- Es gehen alle Zimmer und alle Zuordnungen verloren.
DROP TABLE "zimmer_zuordnung";
DROP TABLE "zimmer";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
