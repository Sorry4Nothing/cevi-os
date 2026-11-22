-- Anlässe der Termine (#442): anlass (ein Termin mit Anmeldung, Frist, Sichtbarkeit und Anlassseite) und anlass_feld (Zusatzfelder der Anmeldung). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg: drizzle/rueckweg/0123_anlass.sql
CREATE TABLE "anlass" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"programm_id" uuid NOT NULL,
	"art" text DEFAULT 'anlass' NOT NULL,
	"anmeldung_offen" boolean DEFAULT false NOT NULL,
	"frist" timestamp with time zone,
	"anmeldung_fuer" text NOT NULL,
	"sichtbarkeit" text NOT NULL,
	"sichtbarkeit_tags" uuid[] DEFAULT '{}' NOT NULL,
	"seite_id" uuid,
	"erstellt_von" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anlass_programm_eindeutig" UNIQUE("programm_id"),
	CONSTRAINT "anlass_art_check" CHECK ("anlass"."art" in ('anlass', 'lager')),
	CONSTRAINT "anlass_anmeldung_fuer_check" CHECK ("anlass"."anmeldung_fuer" in ('kind', 'person')),
	CONSTRAINT "anlass_sichtbarkeit_check" CHECK ("anlass"."sichtbarkeit" in ('oeffentlich', 'angemeldet', 'tags'))
);
--> statement-breakpoint
CREATE TABLE "anlass_feld" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"anlass_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"beschriftung" text NOT NULL,
	"typ" text NOT NULL,
	"optionen" text[] DEFAULT '{}'::text[] NOT NULL,
	"pflicht" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "anlass_feld_schluessel_eindeutig" UNIQUE("anlass_id","schluessel"),
	CONSTRAINT "anlass_feld_typ_check" CHECK ("anlass_feld"."typ" in ('text', 'ja_nein', 'auswahl')),
	CONSTRAINT "anlass_feld_schluessel_check" CHECK ("anlass_feld"."schluessel" ~ '^[a-z0-9_]{1,40}$'),
	CONSTRAINT "anlass_feld_beschriftung_check" CHECK (char_length("anlass_feld"."beschriftung") between 1 and 100),
	CONSTRAINT "anlass_feld_optionen_check" CHECK (("anlass_feld"."typ" = 'auswahl' and cardinality("anlass_feld"."optionen") between 2 and 20) or ("anlass_feld"."typ" <> 'auswahl' and cardinality("anlass_feld"."optionen") = 0)),
	CONSTRAINT "anlass_feld_reihenfolge_check" CHECK ("anlass_feld"."reihenfolge" between 0 and 19)
);
--> statement-breakpoint
ALTER TABLE "anlass" ADD CONSTRAINT "anlass_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass" ADD CONSTRAINT "anlass_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass" ADD CONSTRAINT "anlass_seite_id_seite_id_fk" FOREIGN KEY ("seite_id") REFERENCES "public"."seite"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass" ADD CONSTRAINT "anlass_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass_feld" ADD CONSTRAINT "anlass_feld_anlass_id_anlass_id_fk" FOREIGN KEY ("anlass_id") REFERENCES "public"."anlass"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anlass_abteilung_idx" ON "anlass" USING btree ("abteilung_id");--> statement-breakpoint
CREATE INDEX "anlass_seite_idx" ON "anlass" USING btree ("seite_id");
