-- Geschlecht aus der Cevi-Datenbank (#843): Die Markierung hält fest, dass jemand die Angabe im Blatt der Person gesetzt oder geändert hat; dann übernimmt Cevi OS sie nie mehr aus der Cevi-Datenbank. Jede schon gesetzte Angabe stammt von Hand (bis jetzt gab es keine andere Quelle).
-- Rückweg: drizzle/rueckweg/0169_user_geschlecht_von_hand.sql
ALTER TABLE "user" ADD COLUMN "geschlecht_von_hand" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user" SET "geschlecht_von_hand" = true WHERE "geschlecht" IS NOT NULL;
