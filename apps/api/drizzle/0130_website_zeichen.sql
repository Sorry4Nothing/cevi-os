-- Zeichen der Abteilung für das Favicon der Website (#558): ein Verweis auf ein quadratisches Bild der Abteilung. Die Migration legt nur die Spalte an; ohne Wert gilt das Cevi-Zeichen der Plattform.
-- Rückweg: drizzle/rueckweg/0130_website_zeichen.sql
ALTER TABLE "abteilung" ADD COLUMN "website_zeichen_medium_id" uuid;--> statement-breakpoint
ALTER TABLE "abteilung" ADD CONSTRAINT "abteilung_website_zeichen_medium_id_medium_id_fk" FOREIGN KEY ("website_zeichen_medium_id") REFERENCES "public"."medium"("id") ON DELETE set null ON UPDATE no action;
