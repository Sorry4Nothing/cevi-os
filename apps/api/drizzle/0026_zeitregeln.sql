CREATE TABLE "zeitregel" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"stufe_id" uuid,
	"wochentag" integer NOT NULL,
	"uhrzeit" text NOT NULL,
	"text" text NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zeitregel_wochentag_check" CHECK ("zeitregel"."wochentag" between 1 and 7),
	CONSTRAINT "zeitregel_uhrzeit_check" CHECK ("zeitregel"."uhrzeit" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "zeitregel_gesendet" (
	"regel_id" uuid NOT NULL,
	"programm_id" uuid NOT NULL,
	"gesendet_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zeitregel_gesendet_regel_id_programm_id_pk" PRIMARY KEY("regel_id","programm_id")
);
--> statement-breakpoint
ALTER TABLE "zeitregel" ADD CONSTRAINT "zeitregel_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeitregel" ADD CONSTRAINT "zeitregel_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeitregel_gesendet" ADD CONSTRAINT "zeitregel_gesendet_regel_id_zeitregel_id_fk" FOREIGN KEY ("regel_id") REFERENCES "public"."zeitregel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeitregel_gesendet" ADD CONSTRAINT "zeitregel_gesendet_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;