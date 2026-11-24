-- Freigabe einer Person für die öffentliche Website (#560): Zeitpunkt der Freigabe, leer = nicht freigegeben. Die Migration legt nur die Spalte an; niemand ist danach freigegeben.
-- Rückweg: drizzle/rueckweg/0132_website_freigabe.sql
ALTER TABLE "user" ADD COLUMN "website_freigabe_am" timestamp with time zone;
