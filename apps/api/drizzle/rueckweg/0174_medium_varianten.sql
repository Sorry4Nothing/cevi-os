-- Rückweg zu 0174_medium_varianten (#868), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0174_medium_varianten.sql
-- Danach den Code auf den Stand vor 0174 zurückstellen. Die Dateien der Varianten («<speicher_schluessel>-w<breite>») bleiben im Speicher und werden nicht mehr ausgeliefert; wer Platz sparen will, löscht sie im Bucket. Bilder über 2048 px liefert der alte Code unverändert aus.
ALTER TABLE "medium" DROP COLUMN "varianten";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
