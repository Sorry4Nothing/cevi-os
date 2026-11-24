-- Rückweg zu 0160_sitzung_zweiter_faktor (#721), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0160_sitzung_zweiter_faktor.sql
-- Danach den Code auf den Stand vor 0160 zurückstellen. Der alte Code kennt die Markierung nicht und prüft den zweiten Faktor nur am Konto. Darum beendet der Rückweg zuerst jede Sitzung eines Kontos mit zweitem Faktor, die nicht geprüft ist (eine App-Sitzung ohne Code): Sonst öffnete sie mit dem alten Code die Verwaltung. Betroffene melden sich neu an. Danach geht nur die Spalte verloren.
DELETE FROM "session" WHERE "zweiter_faktor_geprueft" IS FALSE AND "user_id" IN (SELECT "id" FROM "user" WHERE "two_factor_enabled" IS TRUE);--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "zweiter_faktor_geprueft";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
