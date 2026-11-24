-- Statische Auslieferung der Website (#351): Die Seite merkt sich, welcher Stand zuletzt als Datei ausgeliefert wurde.
-- ausgabe_hash ist der SHA-256 der erzeugten HTML-Datei (hex); ist er unverändert, schreibt der Abgleich die Datei nicht neu. ausgabe_am ist der Zeitpunkt des letzten Schreibens.
-- Beide Spalten sind leer, solange die Seite nicht öffentlich veröffentlicht ist; die Migration fasst keine bestehenden Werte an.
-- Rückweg: drizzle/rueckweg/0041_website_ausgabe.sql
ALTER TABLE "seite" ADD COLUMN "ausgabe_hash" text;--> statement-breakpoint
ALTER TABLE "seite" ADD COLUMN "ausgabe_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seite" ADD CONSTRAINT "seite_ausgabe_hash_check" CHECK ("seite"."ausgabe_hash" is null or "seite"."ausgabe_hash" ~ '^[0-9a-f]{64}$');
