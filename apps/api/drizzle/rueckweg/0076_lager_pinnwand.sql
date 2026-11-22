-- Rückweg zu 0076_lager_pinnwand (#381), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0076_lager_pinnwand.sql
-- Danach den Code auf den Stand vor 0076 zurückstellen (ohne Pinnwand).
-- Es gehen alle Beiträge, ihre Empfänger und die Verweise auf Dateien verloren; die Einträge in lager_datei bleiben.
DROP TABLE "pinnwand_datei";
DROP TABLE "pinnwand_empfaenger";
DROP TABLE "pinnwand_beitrag";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
