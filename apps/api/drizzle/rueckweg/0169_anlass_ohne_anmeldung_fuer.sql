-- Rückweg zu 0169_anlass_ohne_anmeldung_fuer (#844), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0169_anlass_ohne_anmeldung_fuer.sql
-- Danach den Code auf den Stand vor 0169 zurückstellen. Die Anmeldungen bleiben. Der alte Wert lässt sich nur ableiten: «person», wenn der Anlass nur Anmeldungen ohne Kind hat, sonst «kind» (auch ohne Anmeldungen). Ein Anlass mit beiden Arten wird «kind»; seine Anmeldungen ohne Kind sieht die Person dann nicht mehr in ihrem Formular, die Verwaltung schon.
ALTER TABLE "anlass" ADD COLUMN "anmeldung_fuer" text;--> statement-breakpoint
UPDATE "anlass" a SET "anmeldung_fuer" = CASE
  WHEN EXISTS (SELECT 1 FROM "anlass_anmeldung" m WHERE m."anlass_id" = a."id" AND m."kind_id" IS NULL)
   AND NOT EXISTS (SELECT 1 FROM "anlass_anmeldung" m WHERE m."anlass_id" = a."id" AND m."kind_id" IS NOT NULL)
  THEN 'person' ELSE 'kind' END;--> statement-breakpoint
ALTER TABLE "anlass" ALTER COLUMN "anmeldung_fuer" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "anlass" ADD CONSTRAINT "anlass_anmeldung_fuer_check" CHECK ("anlass"."anmeldung_fuer" in ('kind', 'person'));--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
