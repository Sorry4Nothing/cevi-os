ALTER TABLE "rolle" ADD COLUMN "prioritaet" integer;--> statement-breakpoint
ALTER TABLE "rolle" ADD CONSTRAINT "rolle_prioritaet_check" CHECK ("rolle"."prioritaet" >= 1);
