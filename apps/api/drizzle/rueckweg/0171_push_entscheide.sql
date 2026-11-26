-- Rückweg zu 0171_push_entscheide (#847), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0171_push_entscheide.sql
-- Danach den Code auf den Stand vor 0171 zurückstellen. Verloren gehen nur die beiden Schalter; Pushes zu Entscheiden gehen danach wieder an alle.
ALTER TABLE "user" DROP COLUMN "push_raum_entscheid";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "push_termin_entscheid";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
