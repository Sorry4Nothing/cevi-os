CREATE TABLE "programm_eckdaten" (
	"stufe_id" uuid NOT NULL,
	"tag" date NOT NULL,
	"treffpunkt" text,
	"schluss_ort" text,
	"schluss_zeit" text,
	"mitnehmen" text,
	"abgerufen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programm_eckdaten_stufe_id_tag_pk" PRIMARY KEY("stufe_id","tag")
);
--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;