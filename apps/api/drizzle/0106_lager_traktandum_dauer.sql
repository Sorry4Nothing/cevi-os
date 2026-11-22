-- Dauer je Traktandum (#520): traktandum.dauer_minuten, optional, 1 bis 600 Minuten. Bestehende Traktanden bleiben ohne Dauer (NULL).
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0106_lager_traktandum_dauer.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0106_lager_traktandum_dauer.sql
--   Es gehen die erfassten Dauern verloren.
ALTER TABLE "traktandum" ADD COLUMN "dauer_minuten" integer;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_dauer_check" CHECK ("traktandum"."dauer_minuten" is null or "traktandum"."dauer_minuten" between 1 and 600);
