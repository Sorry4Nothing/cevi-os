-- Rückweg zu 0073_lager_hoecks (#378), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0073_lager_hoecks.sql
-- Danach den Code auf den Stand vor 0073 zurückstellen (ohne Höcks).
-- Es gehen alle Höcks, Traktanden (mit Entscheiden), Anwesenheiten und Verantwortlichen verloren.
DROP TABLE "traktandum_verantwortlich";
DROP TABLE "traktandum";
DROP TABLE "hoeck_anwesenheit";
DROP TABLE "hoeck";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
