-- Logo der Abteilung für den Kopf der Website (#550): ein Verweis auf ein Medium (Bild) der Abteilung. Die Migration legt nur die Spalte an, bestehende Zeilen bleiben ohne Logo.
-- Rückweg: drizzle/rueckweg/0128_website_logo.sql
ALTER TABLE "abteilung" ADD COLUMN "website_logo_medium_id" uuid;--> statement-breakpoint
ALTER TABLE "abteilung" ADD CONSTRAINT "abteilung_website_logo_medium_id_medium_id_fk" FOREIGN KEY ("website_logo_medium_id") REFERENCES "public"."medium"("id") ON DELETE set null ON UPDATE no action;
