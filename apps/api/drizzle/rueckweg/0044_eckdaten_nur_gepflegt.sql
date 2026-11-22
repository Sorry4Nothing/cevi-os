-- Rückweg zu 0044_eckdaten_nur_gepflegt (#361), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0044_eckdaten_nur_gepflegt.sql
-- Danach den Code auf den Stand vor 0044 zurückstellen (Auslesen wieder da). Die Zeilen, die vorher «web» waren, bleiben «seite»; das Auslesen lässt sie in Ruhe und schreibt die Werte nicht neu, bis jemand sie löscht.
ALTER TABLE "programm_eckdaten" ALTER COLUMN "quelle" SET DEFAULT 'web';
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_quelle_check";
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_quelle_check" CHECK ("programm_eckdaten"."quelle" in ('web', 'seite'));
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
