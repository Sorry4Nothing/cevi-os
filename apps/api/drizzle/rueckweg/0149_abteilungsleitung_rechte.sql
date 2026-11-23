-- Rückweg zu 0149_abteilungsleitung_rechte (#663), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0149_abteilungsleitung_rechte.sql
-- Danach den Code auf den Stand vor 0149 zurückstellen. Was der Entwickler der Abteilungsleitung weggenommen hat, geht verloren: Danach hat sie wieder alle Rechte, wie vor der Migration.
DROP TABLE "abteilungsleitung_recht";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
