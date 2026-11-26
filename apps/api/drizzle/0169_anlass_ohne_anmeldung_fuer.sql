-- Die Frage «Wer meldet sich an?» entfällt (#844): Wer sich für wen anmeldet, entscheiden die Zielgruppe des Anlasses (Sichtbarkeit) und die Verbindung zu den Kindern. Bestehende Anlässe und Anmeldungen (mit oder ohne kind_id) bleiben gültig.
-- Rückweg: drizzle/rueckweg/0169_anlass_ohne_anmeldung_fuer.sql
ALTER TABLE "anlass" DROP CONSTRAINT "anlass_anmeldung_fuer_check";--> statement-breakpoint
ALTER TABLE "anlass" DROP COLUMN "anmeldung_fuer";
