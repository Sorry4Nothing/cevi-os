-- Stufenfelder im Editor pflegen (#355): programm_eckdaten bekommt die Treffzeit und die Quelle der Zeile.
-- «web» = vom Auslesen der alten Stufenwebseite geschrieben (Vorgabe, alle bestehenden Zeilen), «seite» = im Editor gepflegt; das Auslesen überschreibt und löscht nie eine Zeile mit «seite».
-- Die Migration legt nur Spalten an, bestehende Zeilen bleiben wie sie sind.
-- Rückweg: drizzle/rueckweg/0043_eckdaten_quelle.sql
ALTER TABLE "programm_eckdaten" ADD COLUMN "treff_zeit" text;--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD COLUMN "quelle" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_quelle_check" CHECK ("programm_eckdaten"."quelle" in ('web', 'seite'));
