-- Rückweg zu 0041_website_ausgabe (#351), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0041_website_ausgabe.sql
-- Danach den Code auf den Stand vor 0041 zurückstellen. Es geht nur der Merker verloren, welcher Stand zuletzt ausgeliefert wurde; die erzeugten Dateien bleiben liegen.
ALTER TABLE "seite" DROP CONSTRAINT "seite_ausgabe_hash_check";
ALTER TABLE "seite" DROP COLUMN "ausgabe_am";
ALTER TABLE "seite" DROP COLUMN "ausgabe_hash";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
