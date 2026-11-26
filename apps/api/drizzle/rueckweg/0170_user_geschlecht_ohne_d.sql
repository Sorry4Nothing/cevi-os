-- Rückweg zu 0170_user_geschlecht_ohne_d (#849), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0170_user_geschlecht_ohne_d.sql
-- Danach den Code auf den Stand vor 0170 zurückstellen. Der CHECK lässt d wieder zu; die Angaben, die 0170 von d auf null gesetzt hat, bleiben null (welche es waren, ist nicht mehr bekannt).
ALTER TABLE "user" DROP CONSTRAINT "user_geschlecht_check";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_geschlecht_check" CHECK ("user"."geschlecht" is null or "user"."geschlecht" in ('w', 'm', 'd'));--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
