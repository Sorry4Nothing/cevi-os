-- Rückweg zu 0128_website_logo (#550), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0128_website_logo.sql
-- Danach den Code auf den Stand vor 0128 zurückstellen. Es geht nur die Wahl des Logos verloren; das Medium bleibt in der Bibliothek.
ALTER TABLE "abteilung" DROP CONSTRAINT "abteilung_website_logo_medium_id_medium_id_fk";--> statement-breakpoint
ALTER TABLE "abteilung" DROP COLUMN "website_logo_medium_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
