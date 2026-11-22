-- Rückweg zu 0088_lager_infos (#393), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0088_lager_infos.sql
-- Danach den Code auf den Stand vor 0088 zurückstellen (ohne Packliste, Notfall und Infos).
-- Es gehen die Packliste samt Abweichungen und eigenen Punkten, die Notfall-Kontakte, die Info-Abschnitte samt Datei-Verknüpfungen und der Kartenlink (lager.karten_link) verloren; die Einträge in lager_datei bleiben.
DROP TABLE "info_abschnitt_datei";
DROP TABLE "info_abschnitt";
DROP TABLE "notfall_kontakt";
DROP TABLE "packliste_eigen";
DROP TABLE "packliste_abhaken";
DROP TABLE "packliste_punkt";
ALTER TABLE "lager" DROP CONSTRAINT "lager_karten_link_check";
ALTER TABLE "lager" DROP COLUMN "karten_link";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
