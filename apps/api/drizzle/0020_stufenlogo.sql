CREATE TABLE "stufenlogo" (
	"stufe_id" uuid PRIMARY KEY NOT NULL,
	"inhalt" "bytea" NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stufenlogo_inhalt_klein" CHECK (octet_length("stufenlogo"."inhalt") <= 262144)
);
--> statement-breakpoint
ALTER TABLE "stufenlogo" ADD CONSTRAINT "stufenlogo_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;