CREATE TABLE "leitung_anmeldung" (
	"programm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "leitung_anmeldung_programm_id_user_id_pk" PRIMARY KEY("programm_id","user_id"),
	CONSTRAINT "leitung_anmeldung_status_check" CHECK ("leitung_anmeldung"."status" in ('ja', 'nein'))
);
--> statement-breakpoint
ALTER TABLE "leitung_anmeldung" ADD CONSTRAINT "leitung_anmeldung_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leitung_anmeldung" ADD CONSTRAINT "leitung_anmeldung_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;