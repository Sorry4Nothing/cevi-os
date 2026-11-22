-- Rückweg zu 0090_lager_dokumente (#396), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0090_lager_dokumente.sql
-- Danach den Code auf den Stand vor 0090 zurückstellen (ohne Dokumente).
-- Es gehen alle Dokumente verloren (Titel, Stichworte, Freigabe); die Dateien am Ablageort und die Verknüpfungen in lager_datei bleiben.
DROP TABLE "dokument";
ALTER TABLE "lager_datei" DROP CONSTRAINT "lager_datei_lager_id_id_uq";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
