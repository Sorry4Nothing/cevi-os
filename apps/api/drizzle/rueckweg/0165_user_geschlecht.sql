-- Rückweg zu 0165_user_geschlecht (#817), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0165_user_geschlecht.sql
-- Danach den Code auf den Stand vor 0165 zurückstellen. Verloren gehen die Angaben zum Geschlecht; die Verwaltung nennt die Rollen wieder neutral.
ALTER TABLE "user" DROP CONSTRAINT "user_geschlecht_check";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "geschlecht";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
