-- Tags und Zuordnung zu Personen (#331). Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts; von Hand, nur solange nichts auf die Tabellen verweist):
--   DROP TABLE "person_tag"; DROP TABLE "tag"; DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"typ" text NOT NULL,
	"name" text NOT NULL,
	"kuerzel" text NOT NULL,
	CONSTRAINT "tag_typ_check" CHECK ("tag"."typ" in ('stufe', 'funktion', 'team', 'lager'))
);
--> statement-breakpoint
CREATE TABLE "person_tag" (
	"user_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"rolle" text,
	"prioritaet" integer,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_tag_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id"),
	CONSTRAINT "person_tag_prioritaet_check" CHECK ("person_tag"."prioritaet" >= 1)
);
--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tag" ADD CONSTRAINT "person_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tag" ADD CONSTRAINT "person_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_pro_abteilung" ON "tag" USING btree ("abteilung_id",lower("name"));--> statement-breakpoint
CREATE INDEX "person_tag_tag_id_idx" ON "person_tag" USING btree ("tag_id");
