-- Rückweg zu 0163_app_nachweis (#785), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0163_app_nachweis.sql
-- Vorher APP_NACHWEIS=aus setzen und die API neu starten. Danach den Code auf den Stand vor 0163 zurückstellen. Der alte Code erkennt die App nur am Header Origin, wie vor 0163. Verloren gehen die Spalte «client_art», die Herausforderungen und die gespeicherten Schlüssel der iOS-Geräte (die App richtet sie beim nächsten Einschalten neu ein); Sitzungen bleiben.
ALTER TABLE "session" DROP CONSTRAINT "session_client_art_check";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "client_art";--> statement-breakpoint
DROP TABLE "app_nachweis_geraet";--> statement-breakpoint
DROP TABLE "app_nachweis_challenge";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
