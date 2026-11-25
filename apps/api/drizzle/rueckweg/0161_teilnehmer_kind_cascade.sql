-- Rückweg zu 0161_teilnehmer_kind_cascade (#779), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0161_teilnehmer_kind_cascade.sql
-- Zuerst den Code auf den Stand vor 0161 zurückstellen. Der Fremdschlüssel setzt beim Löschen eines Kindes wieder nur NULL; Namenskopien in Lagern bleiben dann bis sechs Monate nach Lagerende stehen. Die gesetzten kind_id bleiben (der alte Code liest sie nicht). Bereits gelöschte Teilnehmende kommen nicht zurück.
ALTER TABLE "teilnehmer" DROP CONSTRAINT "teilnehmer_kind_id_kind_id_fk";--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_kind_id_kind_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."kind"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP INDEX "teilnehmer_kind_idx";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
