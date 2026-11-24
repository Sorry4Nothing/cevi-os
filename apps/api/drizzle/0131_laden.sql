-- Lädeli (#566): Artikel der Abteilung (laden_artikel), Übergabearten (laden_einstellung), Bestellungen angemeldeter Personen (laden_bestellung) und ihre Positionen (laden_bestellposition). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg: drizzle/rueckweg/0131_laden.sql
CREATE TABLE "laden_artikel" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"name" text NOT NULL,
	"preis_rappen" integer NOT NULL,
	"medium_id" uuid,
	"varianten" text[] DEFAULT '{}'::text[] NOT NULL,
	"hinweis" text,
	"verfuegbar" boolean DEFAULT true NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laden_artikel_name_check" CHECK (char_length("laden_artikel"."name") between 1 and 100),
	CONSTRAINT "laden_artikel_preis_check" CHECK ("laden_artikel"."preis_rappen" between 0 and 1000000),
	CONSTRAINT "laden_artikel_varianten_check" CHECK (cardinality("laden_artikel"."varianten") <= 20),
	CONSTRAINT "laden_artikel_hinweis_check" CHECK ("laden_artikel"."hinweis" is null or char_length("laden_artikel"."hinweis") between 1 and 200),
	CONSTRAINT "laden_artikel_reihenfolge_check" CHECK ("laden_artikel"."reihenfolge" between 0 and 9999)
);
--> statement-breakpoint
CREATE TABLE "laden_einstellung" (
	"abteilung_id" uuid PRIMARY KEY NOT NULL,
	"uebergabearten" text[] NOT NULL,
	CONSTRAINT "laden_einstellung_uebergabe_check" CHECK (cardinality("laden_einstellung"."uebergabearten") between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "laden_bestellung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"uebergabe" text NOT NULL,
	"summe_rappen" integer NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"abgeschlossen_am" timestamp with time zone,
	CONSTRAINT "laden_bestellung_status_check" CHECK ("laden_bestellung"."status" in ('offen', 'bereit', 'uebergeben', 'storniert')),
	CONSTRAINT "laden_bestellung_uebergabe_check" CHECK (char_length("laden_bestellung"."uebergabe") between 1 and 80),
	CONSTRAINT "laden_bestellung_summe_check" CHECK ("laden_bestellung"."summe_rappen" >= 0),
	CONSTRAINT "laden_bestellung_abschluss_check" CHECK (("laden_bestellung"."status" in ('uebergeben', 'storniert')) = ("laden_bestellung"."abgeschlossen_am" is not null))
);
--> statement-breakpoint
CREATE TABLE "laden_bestellposition" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bestellung_id" uuid NOT NULL,
	"artikel_id" uuid,
	"name" text NOT NULL,
	"variante" text,
	"menge" integer NOT NULL,
	"einzelpreis_rappen" integer NOT NULL,
	CONSTRAINT "laden_bestellposition_menge_check" CHECK ("laden_bestellposition"."menge" between 1 and 10),
	CONSTRAINT "laden_bestellposition_preis_check" CHECK ("laden_bestellposition"."einzelpreis_rappen" >= 0)
);
--> statement-breakpoint
ALTER TABLE "laden_artikel" ADD CONSTRAINT "laden_artikel_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laden_artikel" ADD CONSTRAINT "laden_artikel_medium_id_medium_id_fk" FOREIGN KEY ("medium_id") REFERENCES "public"."medium"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD CONSTRAINT "laden_einstellung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laden_bestellung" ADD CONSTRAINT "laden_bestellung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laden_bestellung" ADD CONSTRAINT "laden_bestellung_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laden_bestellposition" ADD CONSTRAINT "laden_bestellposition_bestellung_id_laden_bestellung_id_fk" FOREIGN KEY ("bestellung_id") REFERENCES "public"."laden_bestellung"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laden_bestellposition" ADD CONSTRAINT "laden_bestellposition_artikel_id_laden_artikel_id_fk" FOREIGN KEY ("artikel_id") REFERENCES "public"."laden_artikel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laden_artikel_abteilung_idx" ON "laden_artikel" USING btree ("abteilung_id","reihenfolge");--> statement-breakpoint
CREATE INDEX "laden_bestellung_abteilung_idx" ON "laden_bestellung" USING btree ("abteilung_id","status","id");--> statement-breakpoint
CREATE INDEX "laden_bestellung_user_idx" ON "laden_bestellung" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "laden_bestellposition_bestellung_idx" ON "laden_bestellposition" USING btree ("bestellung_id");--> statement-breakpoint
CREATE INDEX "laden_bestellposition_artikel_idx" ON "laden_bestellposition" USING btree ("artikel_id");
