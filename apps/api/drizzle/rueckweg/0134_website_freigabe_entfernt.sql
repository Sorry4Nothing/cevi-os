-- Rückweg zu 0134_website_freigabe_entfernt (#610), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0134_website_freigabe_entfernt.sql
-- Danach den Code auf den Stand vor 0134 zurückstellen. Die Spalte kommt leer zurück (niemand ist freigegeben): Die Werte von vorher gehen verloren, denn die Migration vorwärts verwirft sie. Mit dem alten Code zeigt die Website danach keine Personen mit Bild, bis sie neu freigegeben sind.
ALTER TABLE "user" ADD COLUMN "website_freigabe_am" timestamp with time zone;--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
