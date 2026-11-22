-- Rückweg zu 0091_lager_adressbuch (#397), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0091_lager_adressbuch.sql
-- Danach den Code auf den Stand vor 0091 zurückstellen (ohne Adressbuch).
-- Es gehen alle Kontakte des Adressbuchs verloren.
DROP TABLE "adressbuch_kontakt";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
