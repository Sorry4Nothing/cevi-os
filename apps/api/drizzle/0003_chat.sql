CREATE TABLE "blockierung" (
	"user_id" uuid NOT NULL,
	"blockiert_id" uuid NOT NULL,
	CONSTRAINT "blockierung_user_id_blockiert_id_pk" PRIMARY KEY("user_id","blockiert_id")
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"typ" text NOT NULL,
	"stufe_id" uuid NOT NULL,
	"eltern_user_id" uuid,
	CONSTRAINT "chat_typ_check" CHECK ("chat"."typ" in ('stufe', 'direkt')),
	CONSTRAINT "chat_eltern_nur_direkt" CHECK (("chat"."typ" = 'stufe') = ("chat"."eltern_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "chat_status" (
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"gelesen_bis" timestamp with time zone NOT NULL,
	CONSTRAINT "chat_status_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meldung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"nachricht_id" uuid,
	"text_kopie" text,
	"autor_id" uuid,
	"gemeldet_von" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erledigt_von" uuid,
	"erledigt_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nachricht" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chat_id" uuid NOT NULL,
	"autor_id" uuid NOT NULL,
	"text" text NOT NULL,
	"programm_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"ausgeblendet_von" uuid,
	"ausgeblendet_am" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "blockierung" ADD CONSTRAINT "blockierung_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockierung" ADD CONSTRAINT "blockierung_blockiert_id_user_id_fk" FOREIGN KEY ("blockiert_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_eltern_user_id_user_id_fk" FOREIGN KEY ("eltern_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_status" ADD CONSTRAINT "chat_status_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_status" ADD CONSTRAINT "chat_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldung" ADD CONSTRAINT "meldung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldung" ADD CONSTRAINT "meldung_nachricht_id_nachricht_id_fk" FOREIGN KEY ("nachricht_id") REFERENCES "public"."nachricht"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldung" ADD CONSTRAINT "meldung_autor_id_user_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldung" ADD CONSTRAINT "meldung_gemeldet_von_user_id_fk" FOREIGN KEY ("gemeldet_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldung" ADD CONSTRAINT "meldung_erledigt_von_user_id_fk" FOREIGN KEY ("erledigt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nachricht" ADD CONSTRAINT "nachricht_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nachricht" ADD CONSTRAINT "nachricht_autor_id_user_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nachricht" ADD CONSTRAINT "nachricht_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nachricht" ADD CONSTRAINT "nachricht_ausgeblendet_von_user_id_fk" FOREIGN KEY ("ausgeblendet_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_gruppe_pro_stufe" ON "chat" USING btree ("stufe_id") WHERE "chat"."typ" = 'stufe';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_direkt_pro_eltern" ON "chat" USING btree ("stufe_id","eltern_user_id") WHERE "chat"."typ" = 'direkt';