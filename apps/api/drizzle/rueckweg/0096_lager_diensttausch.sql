-- Rückweg zu 0096_lager_diensttausch (#389), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0096_lager_diensttausch.sql
-- Danach den Code auf den Stand vor 0096 zurückstellen (ohne Diensttausch).
-- Es gehen alle Tauschanfragen verloren; bereits umgebuchte Schichten bleiben, wie sie sind.
DROP TABLE "diensttausch";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
