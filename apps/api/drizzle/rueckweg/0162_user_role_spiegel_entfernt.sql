-- Rückweg zu 0162_user_role_spiegel_entfernt (#784), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0162_user_role_spiegel_entfernt.sql
-- Vor oder nach dem Zurückstellen des Codes auf den Stand vor 0162: Der Code vor 0162 schreibt role = 'admin' für die Abteilungsleitung und prüft es bei den Aktionen am Konto eines Kindes. Darum bekommt hier jedes Mitglied von abteilungsleitung_person role = 'admin' zurück (der Stand von 0159 bis 0161), und die Prüfung fällt weg. Wer seit 0162 die Abteilungsleitung bekommen oder verloren hat, steht richtig, denn die Tabelle gilt.
ALTER TABLE "user" DROP CONSTRAINT "user_role_nur_user";--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE "id" IN (SELECT "user_id" FROM "abteilungsleitung_person");--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
