ALTER TABLE "programm" DROP CONSTRAINT "programm_geaendert_von_user_id_fk";
--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "treffpunkt";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "schluss_ort";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "schluss_zeit";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "mitnehmen";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "info_eltern";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "geaendert_von";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "geaendert_am";