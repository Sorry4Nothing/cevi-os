-- Rückweg zu 0085_lager_anwesenheit (#390), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0085_lager_anwesenheit.sql
-- Danach den Code auf den Stand vor 0085 zurückstellen (ohne Anwesenheit).
-- Es gehen alle Anwesenheiten und Anfragen verloren sowie die Frist (lager.anwesenheit_frist).
DROP TABLE "anwesenheit_anfrage";
DROP TABLE "anwesenheit";
ALTER TABLE "lager" DROP COLUMN "anwesenheit_frist";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
