-- Rückweg zu 0144_kind_konto (#644), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0144_kind_konto.sql
-- Danach den Code auf den Stand vor 0144 zurückstellen. Verloren gehen die Verknüpfung der Kinder mit ihren Konten, der Vermerk «Eltern informiert», die Einsicht der Eltern je Kind und die Einstellungen der Abteilungen. Die Konten selbst bleiben als gewöhnliche Konten ohne Rolle bestehen und sehen mit dem alten Code nichts mehr; die Abteilungsleitung löscht sie bei Bedarf unter «Personen». Eltern, deren Einsicht ausgeschaltet war, sehen ihr Kind danach wieder.
DROP VIEW "kind_zugang";--> statement-breakpoint
DROP TABLE "kind_konto_einstellung";--> statement-breakpoint
ALTER TABLE "kind" DROP CONSTRAINT "kind_user_id_unique";--> statement-breakpoint
ALTER TABLE "kind" DROP CONSTRAINT "kind_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "kind" DROP COLUMN "eltern_einsicht";--> statement-breakpoint
ALTER TABLE "kind" DROP COLUMN "eltern_informiert_am";--> statement-breakpoint
ALTER TABLE "kind" DROP COLUMN "konto_seit";--> statement-breakpoint
ALTER TABLE "kind" DROP COLUMN "user_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
