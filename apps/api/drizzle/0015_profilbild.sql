CREATE TABLE "profilbild" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"inhalt" "bytea" NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profilbild_inhalt_klein" CHECK (octet_length("profilbild"."inhalt") <= 262144)
);
--> statement-breakpoint
ALTER TABLE "profilbild" ADD CONSTRAINT "profilbild_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;