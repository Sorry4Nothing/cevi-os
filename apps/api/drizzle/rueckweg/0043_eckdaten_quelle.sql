-- Rückweg zu 0043_eckdaten_quelle (#355), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0043_eckdaten_quelle.sql
-- Danach den Code auf den Stand vor 0043 zurückstellen. Es gehen alle im Editor gepflegten Zeilen verloren (das Auslesen schreibt ihre Werte beim nächsten Lauf neu) und die Treffzeit.
DELETE FROM "programm_eckdaten" WHERE "quelle" = 'seite';
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_quelle_check";
ALTER TABLE "programm_eckdaten" DROP COLUMN "quelle";
ALTER TABLE "programm_eckdaten" DROP COLUMN "treff_zeit";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
