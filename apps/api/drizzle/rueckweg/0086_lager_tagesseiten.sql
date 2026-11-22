-- Rückweg zu 0086_lager_tagesseiten (#391), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0086_lager_tagesseiten.sql
-- Danach den Code auf den Stand vor 0086 zurückstellen (ohne Tagesseiten und Wetter).
-- Es gehen die Tagesseiten samt Blöcken, der Wetter-Zwischenspeicher und der Ort der Lager (lager.breite, lager.laenge) verloren; die Einträge in lager_datei bleiben.
DROP TABLE "wetter_cache";
DROP TABLE "tagesseite_block";
DROP TABLE "tagesseite";
ALTER TABLE "lager" DROP CONSTRAINT "lager_ort_check";
ALTER TABLE "lager" DROP COLUMN "laenge";
ALTER TABLE "lager" DROP COLUMN "breite";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
