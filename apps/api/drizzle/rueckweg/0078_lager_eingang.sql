-- Rückweg zu 0078_lager_eingang (#383), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0078_lager_eingang.sql
-- Danach den Code auf den Stand vor 0078 zurückstellen (ohne Eingang).
-- Es gehen alle Meldungen, Antworten und Zuordnungen des Eingangs verloren.
DROP TABLE "eingang";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
