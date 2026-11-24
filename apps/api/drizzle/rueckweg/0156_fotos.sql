-- Rückweg zu 0156_fotos (#690), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0156_fotos.sql
-- Danach den Code auf den Stand vor 0156 zurückstellen. Es gehen das gewählte Flickr-Konto und die Auswahl der Alben verloren (die Fotos selbst liegen bei Flickr). Seiten mit dem Baustein «fotoalben» vorher zurückziehen oder den Baustein entfernen: Der ältere Code kennt ihn nicht.
DROP TABLE "foto_album";--> statement-breakpoint
DROP TABLE "foto_einstellung";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
