-- Rückweg zu 0120_termin_kategorien (#432), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0120_termin_kategorien.sql
-- Danach den Code auf den Stand vor 0120 zurückstellen. Es gehen die Tag-Zuordnung der Termine, die Abweichungen der Kategorien und die Spalten «kategorien» und «ort» verloren;
-- der nächste Abgleich schriebe sie neu, sobald die Migration wieder läuft. Spätere Termin-Tabellen (ab 0121) zuerst zurückbauen, falls sie auf diese Tabellen zeigen.
DROP TABLE "kategorie_zuordnung";
DROP TABLE "programm_tag";
ALTER TABLE "programm" DROP COLUMN "ort";
ALTER TABLE "programm" DROP COLUMN "kategorien";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
