-- Untergruppen in der Sichtbarkeit «Bestimmte Gruppen» (#844): je Tag die Rollen, die Seite oder Anlass sehen (teilnehmende, leitung, stufenleitung). Ohne Schlüssel sieht die ganze Gruppe es, wie bisher; bestehende Zeilen bleiben unverändert. Bausteine tragen dieselbe Angabe in ihrem JSON (sichtbarkeit.rollen).
-- Rückweg: drizzle/rueckweg/0172_sichtbarkeit_rollen.sql
ALTER TABLE "seite" ADD COLUMN "sichtbarkeit_rollen" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "seite" ADD CONSTRAINT "seite_sichtbarkeit_rollen_check" CHECK (jsonb_typeof("seite"."sichtbarkeit_rollen") = 'object');--> statement-breakpoint
ALTER TABLE "anlass" ADD COLUMN "sichtbarkeit_rollen" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anlass" ADD CONSTRAINT "anlass_sichtbarkeit_rollen_check" CHECK (jsonb_typeof("anlass"."sichtbarkeit_rollen") = 'object');
