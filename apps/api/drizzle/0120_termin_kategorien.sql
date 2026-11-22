-- Termine (#432): Outlook-Kategorien als Tags. programm bekommt die rohen Kategorien und den Ort, programm_tag die Tags je Termin
-- (ohne Zeile ist ein Termin für niemanden sichtbar), kategorie_zuordnung die Abweichungen von «Kategorie heisst wie der Tag».
-- Bestehende Termine haben keine Kategorien, bis der nächste Abgleich (alle 5 Minuten) sie liest.
-- Rückweg: drizzle/rueckweg/0120_termin_kategorien.sql
ALTER TABLE "programm" ADD COLUMN "kategorien" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "programm" ADD COLUMN "ort" text;--> statement-breakpoint
CREATE TABLE "programm_tag" (
	"programm_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "programm_tag_programm_id_tag_id_pk" PRIMARY KEY("programm_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "kategorie_zuordnung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"kategorie" text NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programm_tag" ADD CONSTRAINT "programm_tag_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm_tag" ADD CONSTRAINT "programm_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kategorie_zuordnung" ADD CONSTRAINT "kategorie_zuordnung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kategorie_zuordnung" ADD CONSTRAINT "kategorie_zuordnung_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "programm_tag_tag_id_idx" ON "programm_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kategorie_zuordnung_kategorie_eindeutig" ON "kategorie_zuordnung" USING btree ("abteilung_id",lower("kategorie"));
