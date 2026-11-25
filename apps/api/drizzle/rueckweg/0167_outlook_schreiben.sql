-- Rückweg zu 0167_outlook_schreiben (#835), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0167_outlook_schreiben.sql
-- Danach den Code auf den Stand vor 0167 zurückstellen und OUTLOOK_GRAPH auf false setzen. Verloren geht die Verbindung zu Outlook (das Token): Neu verbinden mit «npm run kalender:outlook-verbinden». Die Kategorien in Outlook bleiben, wie sie sind. Zusätzlich die Zustimmung der App im Konto widerrufen (docs/betrieb.md).
DROP TABLE "outlook_aenderung";--> statement-breakpoint
DROP TABLE "outlook_kategorie";--> statement-breakpoint
DROP TABLE "outlook_verbindung";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
