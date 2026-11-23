-- Orte-Bibliothek (#646): Treffpunkte und Schlussorte, die oft vorkommen, je Abteilung einmal angelegt und in den Samstagsangaben der Stufen per Auswahl gewählt. Der Standort steht in höchstens einer Form (Adresse, Koordinaten oder ein geprüfter Link von Google Maps); die Prüfung macht der Server, die Checks sichern nur Länge, Bereich und «höchstens eine Form».
-- programm_eckdaten bekommt je Treffpunkt und Schlussort die Kennung des Orts; der Text daneben bleibt als Schnappschuss des Namens. Wird ein Ort gelöscht, bleibt die Angabe mit ihrem Text stehen (SET NULL). Bestehende Zeilen bleiben unberührt (Kennung leer).
-- Rückweg: drizzle/rueckweg/0147_ort.sql
CREATE TABLE "ort" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"name" text NOT NULL,
	"beschreibung" text,
	"karte_adresse" text,
	"breite" double precision,
	"laenge" double precision,
	"karte_url" text,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"zuletzt_verwendet_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ort_laenge_check" CHECK (char_length("ort"."name") between 1 and 100 and ("ort"."beschreibung" is null or char_length("ort"."beschreibung") <= 200) and ("ort"."karte_adresse" is null or char_length("ort"."karte_adresse") <= 200) and ("ort"."karte_url" is null or char_length("ort"."karte_url") <= 500)),
	CONSTRAINT "ort_koordinaten_check" CHECK (("ort"."breite" is null) = ("ort"."laenge" is null) and ("ort"."breite" is null or ("ort"."breite" between -90 and 90 and "ort"."laenge" between -180 and 180))),
	CONSTRAINT "ort_eine_form_check" CHECK ((case when "ort"."karte_adresse" is null then 0 else 1 end) + (case when "ort"."breite" is null then 0 else 1 end) + (case when "ort"."karte_url" is null then 0 else 1 end) <= 1)
);
--> statement-breakpoint
ALTER TABLE "ort" ADD CONSTRAINT "ort_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ort_name_pro_abteilung" ON "ort" USING btree ("abteilung_id",lower("name"));--> statement-breakpoint
CREATE INDEX "ort_abteilung_idx" ON "ort" USING btree ("abteilung_id","reihenfolge");--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD COLUMN "treffpunkt_ort_id" uuid;--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD COLUMN "schluss_ort_id" uuid;--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_treffpunkt_ort_id_ort_id_fk" FOREIGN KEY ("treffpunkt_ort_id") REFERENCES "public"."ort"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_schluss_ort_id_ort_id_fk" FOREIGN KEY ("schluss_ort_id") REFERENCES "public"."ort"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "programm_eckdaten_treffpunkt_ort_idx" ON "programm_eckdaten" USING btree ("treffpunkt_ort_id") WHERE "programm_eckdaten"."treffpunkt_ort_id" is not null;--> statement-breakpoint
CREATE INDEX "programm_eckdaten_schluss_ort_idx" ON "programm_eckdaten" USING btree ("schluss_ort_id") WHERE "programm_eckdaten"."schluss_ort_id" is not null;
