-- Rückweg zu 0175_idempotenz (#873), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0175_idempotenz.sql
-- Danach den Code auf den Stand vor 0175 zurückstellen. Verloren gehen nur die gespeicherten Antworten der letzten 24 Stunden: Eine Wiederholung mit einem Idempotency-Key legt danach wieder an, wie vor 0175.
DROP TABLE "idempotenz";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
