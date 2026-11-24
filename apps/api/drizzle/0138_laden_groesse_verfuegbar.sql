-- Lädeli (#629): Verfügbarkeit je Grösse. Die neue Spalte nennt die Grössen aus «varianten», die gerade nicht zu haben sind; leer heisst alle verfügbar. Bestehende Artikel bleiben vollständig verfügbar, nichts wird gelöscht oder umgeschrieben. Die Prüfung stellt sicher, dass nur vorhandene Grössen darin stehen.
-- Rückweg: drizzle/rueckweg/0138_laden_groesse_verfuegbar.sql
ALTER TABLE "laden_artikel" ADD COLUMN "nicht_verfuegbar" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_artikel" ADD CONSTRAINT "laden_artikel_nicht_verfuegbar_check" CHECK ("laden_artikel"."nicht_verfuegbar" <@ "laden_artikel"."varianten");
