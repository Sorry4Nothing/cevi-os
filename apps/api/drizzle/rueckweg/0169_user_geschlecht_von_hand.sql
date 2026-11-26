-- Rückweg zu 0169_user_geschlecht_von_hand (#843), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0169_user_geschlecht_von_hand.sql
-- Danach den Code auf den Stand vor 0169 zurückstellen. Verloren geht nur die Markierung «von Hand»; die Angaben zum Geschlecht bleiben.
ALTER TABLE "user" DROP COLUMN "geschlecht_von_hand";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
