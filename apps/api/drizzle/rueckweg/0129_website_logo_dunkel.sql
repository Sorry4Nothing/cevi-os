-- Rückweg zu 0129_website_logo_dunkel (#558), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0129_website_logo_dunkel.sql
-- Danach den Code auf den Stand vor 0129 zurückstellen. Es geht nur die Wahl des Logos für den dunklen Modus verloren; das Medium bleibt in der Bibliothek.
ALTER TABLE "abteilung" DROP CONSTRAINT "abteilung_website_logo_dunkel_medium_id_medium_id_fk";--> statement-breakpoint
ALTER TABLE "abteilung" DROP COLUMN "website_logo_dunkel_medium_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
