-- Rückweg zu 0066_lager_dateien (#370), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0066_lager_dateien.sql
-- Danach den Code auf den Stand vor 0066 zurückstellen (ohne Dateien im Lager).
-- Es gehen alle Verknüpfungen und die eingestellten Hosts verloren; die Dateien am Ablageort bleiben unberührt.
DROP TABLE "lager_datei";
ALTER TABLE "abteilung" DROP COLUMN "datei_hosts";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
