-- Ort und Beschreibung kommen nicht aus dem Kalender, sondern von der Webseite der Stufen (#326)
ALTER TABLE "programm" DROP COLUMN "google_ort";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "google_beschreibung";
