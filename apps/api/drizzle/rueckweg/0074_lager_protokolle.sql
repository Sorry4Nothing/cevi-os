-- Rückweg zu 0074_lager_protokolle (#379), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0074_lager_protokolle.sql
-- Danach den Code auf den Stand vor 0074 zurückstellen (ohne Protokolle und Beschlüsse).
-- Es gehen alle Protokoll-Einträge (Art, Titel, Datum, Verknüpfung) und alle Beschlüsse verloren; die Dateien am Ablageort und die Einträge in lager_datei bleiben. hoeck.protokoll_id wird auf NULL gesetzt, weil das Ziel fehlt.
DROP TABLE "beschluss";
DROP TABLE "protokoll";
UPDATE "hoeck" SET "protokoll_id" = NULL WHERE "protokoll_id" IS NOT NULL;
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
