-- Rückweg zu 0141_gruppenrollen_nachtragen (#643), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0141_gruppenrollen_nachtragen.sql
-- Entfernt die Zuordnung der Personen zu Rollen (person_tag.rolle_id) und alle Gruppenrollen, auch die, die Nutzer selbst angelegt haben (sie lassen sich nicht von den Systemrollen trennen, ohne Daten zu verlieren, die 0140 noch hält). Wer nur die Systemrollen zurückbauen will, löscht in gruppen_rolle gezielt nach schluessel. Die Freitext-Rolle bleibt.
UPDATE "person_tag" SET "rolle_id" = NULL WHERE "rolle_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "gruppen_rolle";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
