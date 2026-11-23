-- Rückweg zu 0139_aktivitaet (#637), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0139_aktivitaet.sql
-- Danach den Code auf den Stand vor 0139 zurückstellen. Das Aktivitätsprotokoll geht verloren (das Audit-Log bleibt unberührt, es ist die Quelle der Zeilen «audit»).
DROP TRIGGER aktivitaet_aus_audit ON "audit_log";--> statement-breakpoint
DROP FUNCTION aktivitaet_aus_audit();--> statement-breakpoint
DROP FUNCTION aktivitaet_aufraeumen(integer, integer);--> statement-breakpoint
DROP TABLE "aktivitaet";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
