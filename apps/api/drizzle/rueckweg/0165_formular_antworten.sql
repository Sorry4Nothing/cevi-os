-- Rückweg zu 0165_formular_antworten (#819), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0165_formular_antworten.sql
-- Danach den Code auf den Stand vor 0164 zurückstellen. Verloren gehen alle Antworten auf Formulare der Website; wer sie braucht, exportiert sie vorher als CSV in der Verwaltung. Ein Baustein «formular» im Dokument einer Seite kennt der alte Code nicht: Vorher die Bausteine aus den Seiten entfernen und neu veröffentlichen, sonst lässt sich die Seite nicht mehr lesen.
DROP TABLE "formular_antwort";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
