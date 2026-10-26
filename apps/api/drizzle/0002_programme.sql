CREATE TABLE "programm" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"google_event_id" text NOT NULL,
	"google_serie" text,
	"titel" text NOT NULL,
	"ganztaegig" boolean NOT NULL,
	"beginn" timestamp with time zone,
	"ende" timestamp with time zone,
	"tag_von" date,
	"tag_bis" date,
	"google_ort" text,
	"google_beschreibung" text,
	"status" text DEFAULT 'aktiv' NOT NULL,
	"sichtbarkeit" text DEFAULT 'intern' NOT NULL,
	"treffpunkt" text,
	"schluss_ort" text,
	"schluss_zeit" time,
	"mitnehmen" text,
	"info_eltern" text,
	"geaendert_von" uuid,
	"geaendert_am" timestamp with time zone,
	CONSTRAINT "programm_abteilung_google_event_eindeutig" UNIQUE("abteilung_id","google_event_id"),
	CONSTRAINT "programm_status_check" CHECK ("programm"."status" in ('aktiv', 'abgesagt', 'pruefen')),
	CONSTRAINT "programm_sichtbarkeit_check" CHECK ("programm"."sichtbarkeit" in ('intern', 'leitende', 'eltern')),
	CONSTRAINT "programm_zeiten_passen_zu_ganztaegig" CHECK (("programm"."ganztaegig" and "programm"."tag_von" is not null and "programm"."tag_bis" is not null and "programm"."beginn" is null and "programm"."ende" is null) or (not "programm"."ganztaegig" and "programm"."beginn" is not null and "programm"."ende" is not null and "programm"."tag_von" is null and "programm"."tag_bis" is null))
);
--> statement-breakpoint
CREATE TABLE "programm_stufe" (
	"programm_id" uuid NOT NULL,
	"stufe_id" uuid NOT NULL,
	CONSTRAINT "programm_stufe_programm_id_stufe_id_pk" PRIMARY KEY("programm_id","stufe_id")
);
--> statement-breakpoint
ALTER TABLE "programm" ADD CONSTRAINT "programm_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm" ADD CONSTRAINT "programm_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm_stufe" ADD CONSTRAINT "programm_stufe_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm_stufe" ADD CONSTRAINT "programm_stufe_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;