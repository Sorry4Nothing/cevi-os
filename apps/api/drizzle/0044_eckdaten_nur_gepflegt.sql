-- Das Auslesen der alten Stufenwebseiten entfällt (#361): Es gibt nur noch gepflegte Zeilen in programm_eckdaten.
-- Zeilen, die das Auslesen schrieb (quelle «web»), gelten ab jetzt als gepflegt: Die Stufenleitung sieht sie im Editor, kann sie ändern und löschen, und sie altern von selbst aus (vergangene Daten räumt jede Speicherung weg). Ihre Programme (ID «web:<Stufe>:<Tag>») bleiben.
-- Rückweg: drizzle/rueckweg/0044_eckdaten_nur_gepflegt.sql
UPDATE "programm_eckdaten" SET "quelle" = 'seite' WHERE "quelle" = 'web';--> statement-breakpoint
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_quelle_check";--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_quelle_check" CHECK ("programm_eckdaten"."quelle" = 'seite');--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ALTER COLUMN "quelle" SET DEFAULT 'seite';
