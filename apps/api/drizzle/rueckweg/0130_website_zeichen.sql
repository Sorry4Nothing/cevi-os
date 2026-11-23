-- Rückweg zu 0130_website_zeichen (#558), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0130_website_zeichen.sql
-- Danach den Code auf den Stand vor 0130 zurückstellen. Es geht nur die Wahl des Zeichens verloren; das Medium bleibt in der Bibliothek.
ALTER TABLE "abteilung" DROP CONSTRAINT "abteilung_website_zeichen_medium_id_medium_id_fk";--> statement-breakpoint
ALTER TABLE "abteilung" DROP COLUMN "website_zeichen_medium_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
