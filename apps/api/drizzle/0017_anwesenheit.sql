CREATE TABLE "anwesenheit_kind" (
	"programm_id" uuid NOT NULL,
	"kind_id" uuid NOT NULL,
	"da" boolean NOT NULL,
	"erfasst_von" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anwesenheit_kind_programm_id_kind_id_pk" PRIMARY KEY("programm_id","kind_id")
);
--> statement-breakpoint
CREATE TABLE "anwesenheit_leitung" (
	"programm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"da" boolean NOT NULL,
	"erfasst_von" uuid,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anwesenheit_leitung_programm_id_user_id_pk" PRIMARY KEY("programm_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "anwesenheit_kind" ADD CONSTRAINT "anwesenheit_kind_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_kind" ADD CONSTRAINT "anwesenheit_kind_kind_id_kind_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."kind"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_kind" ADD CONSTRAINT "anwesenheit_kind_erfasst_von_user_id_fk" FOREIGN KEY ("erfasst_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_leitung" ADD CONSTRAINT "anwesenheit_leitung_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_leitung" ADD CONSTRAINT "anwesenheit_leitung_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_leitung" ADD CONSTRAINT "anwesenheit_leitung_erfasst_von_user_id_fk" FOREIGN KEY ("erfasst_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;