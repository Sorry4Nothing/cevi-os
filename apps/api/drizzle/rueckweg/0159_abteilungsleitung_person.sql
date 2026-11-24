-- Rückweg zu 0159_abteilungsleitung_person (#720), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0159_abteilungsleitung_person.sql
-- Zuerst den Code auf den Stand vor 0159 zurückstellen. Wer seit 0159 neu zur Abteilungsleitung wurde, bekommt hier role = 'admin' zurück (der Code vor 0159 liest nur role); wer die Abteilungsleitung seither verloren hat, behält sie nicht, weil der Code sie dann auch in role zurückgenommen hat.
UPDATE "user" SET "role" = 'admin' WHERE "id" IN (SELECT "user_id" FROM "abteilungsleitung_person");--> statement-breakpoint
DROP TABLE "abteilungsleitung_person";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
