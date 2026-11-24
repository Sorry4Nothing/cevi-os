-- Rückweg zu 0132_website_freigabe (#560), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0132_website_freigabe.sql
-- Danach den Code auf den Stand vor 0132 zurückstellen. Es gehen die Freigaben für die Website verloren; mit dem alten Code zeigt die Website keine Personen mit Bild.
ALTER TABLE "user" DROP COLUMN "website_freigabe_am";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
