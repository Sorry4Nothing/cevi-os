-- Stand je Antwort auf ein Formular der Website (#881): neu, in Bearbeitung, erledigt. Bestehende Antworten werden «neu»; nur die Verwaltung setzt den Stand.
-- Rückweg: drizzle/rueckweg/0176_formular_stand.sql
ALTER TABLE "formular_antwort" ADD COLUMN "stand" text DEFAULT 'neu' NOT NULL;--> statement-breakpoint
ALTER TABLE "formular_antwort" ADD CONSTRAINT "formular_antwort_stand_check" CHECK ("formular_antwort"."stand" in ('neu', 'in_bearbeitung', 'erledigt'));
