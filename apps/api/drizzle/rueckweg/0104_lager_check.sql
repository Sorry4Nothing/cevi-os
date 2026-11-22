-- Rückweg zu 0104_lager_check (#377), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0104_lager_check.sql
-- Danach den Code auf den Stand vor 0104 zurückstellen (ohne eigene Check-Punkte).
-- Es gehen alle eigenen Check-Punkte verloren.
DROP TABLE "lager_check_punkt";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
