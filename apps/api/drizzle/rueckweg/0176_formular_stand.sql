-- Rückweg zu 0176_formular_stand (#881), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0176_formular_stand.sql
-- Danach den Code auf den Stand vor 0176 zurückstellen. Verloren geht nur der Stand der Antworten (neu, in Bearbeitung, erledigt); die Antworten selbst bleiben.
ALTER TABLE "formular_antwort" DROP CONSTRAINT "formular_antwort_stand_check";--> statement-breakpoint
ALTER TABLE "formular_antwort" DROP COLUMN "stand";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
