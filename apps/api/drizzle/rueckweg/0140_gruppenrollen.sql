-- Rückweg zu 0140_gruppenrollen (#643), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0140_gruppenrollen.sql
-- Danach den Code auf den Stand vor 0140 zurückstellen. Alle Gruppenrollen, ihre Rechte und die Zuordnung der Personen zu ihnen gehen verloren (die Freitext-Rolle an person_tag bleibt, sie ist die Quelle der Systemrollen). Die Versionsnummer der Plattformrollen geht verloren. Vorher 0141 zurückfahren, falls angewendet.
DROP TRIGGER person_tag_rolle_abgleich ON "person_tag";--> statement-breakpoint
DROP FUNCTION person_tag_rolle_abgleich();--> statement-breakpoint
ALTER TABLE "plattform_rolle" DROP COLUMN "version";--> statement-breakpoint
DROP INDEX "person_tag_rolle_id_idx";--> statement-breakpoint
ALTER TABLE "person_tag" DROP CONSTRAINT "person_tag_rolle_id_gruppen_rolle_id_fk";--> statement-breakpoint
ALTER TABLE "person_tag" DROP COLUMN "rolle_id";--> statement-breakpoint
DROP TABLE "gruppen_rolle_recht";--> statement-breakpoint
DROP TABLE "gruppen_rolle";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
