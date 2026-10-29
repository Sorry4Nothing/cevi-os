CREATE TABLE "teilnahme" (
	"programm_id" uuid NOT NULL,
	"kind_id" uuid NOT NULL,
	"status" text NOT NULL,
	"geaendert_von" uuid,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teilnahme_programm_id_kind_id_pk" PRIMARY KEY("programm_id","kind_id"),
	CONSTRAINT "teilnahme_status_check" CHECK ("teilnahme"."status" in ('ja', 'nein'))
);
--> statement-breakpoint
ALTER TABLE "teilnahme" ADD CONSTRAINT "teilnahme_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teilnahme" ADD CONSTRAINT "teilnahme_kind_id_kind_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."kind"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teilnahme" ADD CONSTRAINT "teilnahme_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;