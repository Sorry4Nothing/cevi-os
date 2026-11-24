-- Rückweg zu 0157_cevi_datenbank (#691), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0157_cevi_datenbank.sql
-- Danach den Code auf den Stand vor 0157 zurückstellen. Verloren gehen: die Einstellung der Cevi-Datenbank, die Quelle der Zusatzfelder und die gemerkten Nummern; die Anmeldungen und ihre Antworten bleiben.
ALTER TABLE "user" DROP COLUMN "cevi_db_id";--> statement-breakpoint
ALTER TABLE "kind" DROP COLUMN "cevi_db_id";--> statement-breakpoint
ALTER TABLE "anlass_feld" DROP CONSTRAINT "anlass_feld_cevi_quelle_check";--> statement-breakpoint
ALTER TABLE "anlass_feld" DROP COLUMN "cevi_quelle";--> statement-breakpoint
DROP TABLE "cevi_db_einstellung";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
