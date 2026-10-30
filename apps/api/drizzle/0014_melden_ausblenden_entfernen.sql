-- Melden und Ausblenden entfallen. Bisher ausgeblendete Nachrichten werden gelöscht, statt für alle wieder sichtbar zu werden; die Meldungen samt Textkopie gehen mit der Tabelle
DELETE FROM "nachricht" WHERE "ausgeblendet_am" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "meldung" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "meldung" CASCADE;--> statement-breakpoint
ALTER TABLE "nachricht" DROP CONSTRAINT "nachricht_ausgeblendet_von_user_id_fk";
--> statement-breakpoint
ALTER TABLE "nachricht" DROP COLUMN "ausgeblendet_von";--> statement-breakpoint
ALTER TABLE "nachricht" DROP COLUMN "ausgeblendet_am";