-- Geschlecht nur noch weiblich oder männlich (#849): Der Wert d (andere) entfällt. Bestehende Angaben d werden zu «keine Angabe» (null, neutrale Rollenform); die Markierung «von Hand» bleibt, die Cevi-Datenbank überschreibt diese Konten also nicht.
-- Rückweg: drizzle/rueckweg/0170_user_geschlecht_ohne_d.sql
UPDATE "user" SET "geschlecht" = NULL WHERE "geschlecht" = 'd';--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_geschlecht_check";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_geschlecht_check" CHECK ("user"."geschlecht" is null or "user"."geschlecht" in ('w', 'm'));
