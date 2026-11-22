-- Rückweg zu 0067_lager_ressorts (#371), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0067_lager_ressorts.sql
-- Danach den Code auf den Stand vor 0067 zurückstellen (ohne Ressorts).
-- Es gehen alle Ressorts, Links und Notizen verloren; lager_mitglied.ressort_id wird geleert.
ALTER TABLE "lager_mitglied" DROP CONSTRAINT "lager_mitglied_ressort_fk";
UPDATE "lager_mitglied" SET "ressort_id" = NULL WHERE "ressort_id" IS NOT NULL;
DROP TABLE "ressort_notiz";
DROP TABLE "ressort_link";
DROP TABLE "ressort";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
