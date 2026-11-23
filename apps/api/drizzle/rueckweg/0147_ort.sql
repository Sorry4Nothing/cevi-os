-- Rückweg zu 0147_ort (#646), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0147_ort.sql
-- Danach den Code auf den Stand vor 0147 zurückstellen. Die Orte und ihre Standorte gehen verloren; die Angaben der Stufen behalten ihren Text (Treffpunkt und Schlussort), nur die Kennung zum Ort und damit der Verweis auf Google Maps entfällt.
DROP INDEX "programm_eckdaten_schluss_ort_idx";--> statement-breakpoint
DROP INDEX "programm_eckdaten_treffpunkt_ort_idx";--> statement-breakpoint
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_schluss_ort_id_ort_id_fk";--> statement-breakpoint
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_treffpunkt_ort_id_ort_id_fk";--> statement-breakpoint
ALTER TABLE "programm_eckdaten" DROP COLUMN "schluss_ort_id";--> statement-breakpoint
ALTER TABLE "programm_eckdaten" DROP COLUMN "treffpunkt_ort_id";--> statement-breakpoint
DROP TABLE "ort";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
