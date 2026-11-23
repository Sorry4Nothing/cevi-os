-- Bild für die Fehlerseiten der Website (#567): ein Verweis auf ein öffentliches Bild der Abteilung. Die Migration legt nur die Spalte an; ohne Wert gilt das Titelbild der Startseite.
-- Rückweg: drizzle/rueckweg/0133_website_fehlerbild.sql
ALTER TABLE "abteilung" ADD COLUMN "website_fehlerbild_medium_id" uuid;--> statement-breakpoint
ALTER TABLE "abteilung" ADD CONSTRAINT "abteilung_website_fehlerbild_medium_id_medium_id_fk" FOREIGN KEY ("website_fehlerbild_medium_id") REFERENCES "public"."medium"("id") ON DELETE set null ON UPDATE no action;
