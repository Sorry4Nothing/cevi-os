-- Räume der Termine (#446): raum (Name, Ort, Beschreibung, Kapazität, zuständiges Team, aktiv). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg: drizzle/rueckweg/0125_raum.sql
CREATE TABLE "raum" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ort" text,
	"beschreibung" text,
	"kapazitaet" integer,
	"team_tag_id" uuid,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raum_name_check" CHECK (char_length("raum"."name") between 1 and 100),
	CONSTRAINT "raum_ort_check" CHECK (char_length("raum"."ort") between 1 and 200),
	CONSTRAINT "raum_beschreibung_check" CHECK (char_length("raum"."beschreibung") between 1 and 1000),
	CONSTRAINT "raum_kapazitaet_check" CHECK ("raum"."kapazitaet" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "raum" ADD CONSTRAINT "raum_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raum" ADD CONSTRAINT "raum_team_tag_id_tag_id_fk" FOREIGN KEY ("team_tag_id") REFERENCES "public"."tag"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raum_name_eindeutig" ON "raum" USING btree ("abteilung_id",lower("name"));--> statement-breakpoint
CREATE INDEX "raum_team_tag_idx" ON "raum" USING btree ("team_tag_id");
