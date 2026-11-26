-- Rückweg zu 0168_lager_seite (#838), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0168_lager_seite.sql
-- Danach den Code auf den Stand vor 0168 zurückstellen. Verloren geht nur die Verknüpfung zwischen Lager und Seite; die Seiten selbst bleiben auf der Website.
DROP INDEX "lager_seite_eindeutig";--> statement-breakpoint
ALTER TABLE "lager" DROP CONSTRAINT "lager_seite_id_seite_id_fk";--> statement-breakpoint
ALTER TABLE "lager" DROP COLUMN "seite_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
