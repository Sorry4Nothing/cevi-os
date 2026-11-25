-- Rückweg zu 0164_programm_sichtbarkeit_entfernt (#807), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0164_programm_sichtbarkeit_entfernt.sql
-- Danach den Code auf den Stand vor 0164 zurückstellen. Die Spalte kommt zurück, jede Zeile bekommt «eltern» (der Vorgabewert seit 0030). Die frühere Sichtbarkeit («intern», «leitende») geht verloren: Sie liess sich nicht aus den Tags herleiten. Das Recht «programm.intern_sehen» gibt im alten Code wieder etwas, wenn eine Rolle es noch trägt.
ALTER TABLE "programm" ADD COLUMN "sichtbarkeit" text DEFAULT 'eltern' NOT NULL;--> statement-breakpoint
ALTER TABLE "programm" ADD CONSTRAINT "programm_sichtbarkeit_check" CHECK ("programm"."sichtbarkeit" in ('intern', 'leitende', 'eltern'));--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
