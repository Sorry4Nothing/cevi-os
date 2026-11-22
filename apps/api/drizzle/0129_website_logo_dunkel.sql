-- Zweite Fassung des Logos für den dunklen Modus der Website (#558): ein Verweis auf ein Medium (Bild) der Abteilung. Die Migration legt nur die Spalte an; ohne Wert zeigt der Kopf in Hell und Dunkel dasselbe Logo.
-- Rückweg: drizzle/rueckweg/0129_website_logo_dunkel.sql
ALTER TABLE "abteilung" ADD COLUMN "website_logo_dunkel_medium_id" uuid;--> statement-breakpoint
ALTER TABLE "abteilung" ADD CONSTRAINT "abteilung_website_logo_dunkel_medium_id_medium_id_fk" FOREIGN KEY ("website_logo_dunkel_medium_id") REFERENCES "public"."medium"("id") ON DELETE set null ON UPDATE no action;
