-- Geschlecht der Person (#817): freiwillig, bestimmt nur, wie die Verwaltung die Rolle dieser Person nennt («Stufenleiterin», «Stufenleiter», sonst «Stufenleitung»). w = weiblich, m = männlich, d = andere; null = keine Angabe (neutrale Form). Bestehende Konten bleiben ohne Angabe.
-- Rückweg: drizzle/rueckweg/0165_user_geschlecht.sql
ALTER TABLE "user" ADD COLUMN "geschlecht" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_geschlecht_check" CHECK ("user"."geschlecht" is null or "user"."geschlecht" in ('w', 'm', 'd'));
