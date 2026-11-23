-- Rückweg zu 0133_website_fehlerbild (#567), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0133_website_fehlerbild.sql
-- Danach den Code auf den Stand vor 0133 zurückstellen. Es geht nur die Wahl des Bildes verloren; das Medium bleibt in der Bibliothek.
ALTER TABLE "abteilung" DROP CONSTRAINT "abteilung_website_fehlerbild_medium_id_medium_id_fk";--> statement-breakpoint
ALTER TABLE "abteilung" DROP COLUMN "website_fehlerbild_medium_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
