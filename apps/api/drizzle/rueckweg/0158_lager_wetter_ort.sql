-- Rückweg zu 0158_lager_wetter_ort (#694), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0158_lager_wetter_ort.sql
-- Danach den Code auf den Stand vor 0158 zurückstellen. Es gehen nur die vier Spalten der Ortssuche verloren; die Koordinaten «breite» und «laenge» der Lager bleiben stehen (mit der alten Route lassen sie sich wieder von Hand setzen).
ALTER TABLE "lager" DROP CONSTRAINT "lager_wetter_ort_ergebnis_check";--> statement-breakpoint
ALTER TABLE "lager" DROP COLUMN "wetter_ort_versuch_am";--> statement-breakpoint
ALTER TABLE "lager" DROP COLUMN "wetter_ort_ergebnis";--> statement-breakpoint
ALTER TABLE "lager" DROP COLUMN "wetter_ort_name";--> statement-breakpoint
ALTER TABLE "lager" DROP COLUMN "wetter_ort_schluessel";
