-- Termine (#439): Terminvorschläge. Eine berechtigte Person schlägt einen Termin vor, die Abteilungsleitung entscheidet (#440).
-- Cevi OS schreibt nie nach Outlook; «freigegeben» heisst: in Outlook von Hand einzutragen. Zurückziehen löscht die Zeile.
-- Rückweg: drizzle/rueckweg/0122_termin_vorschlag.sql
CREATE TABLE "termin_vorschlag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"vorgeschlagen_von" uuid,
	"titel" text NOT NULL,
	"ganztaegig" boolean NOT NULL,
	"beginn" timestamp with time zone,
	"ende" timestamp with time zone,
	"tag_von" date,
	"tag_bis" date,
	"ort" text,
	"beschreibung" text,
	"bemerkung" text,
	"tag_ids" uuid[] NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"entschieden_von" uuid,
	"entschieden_am" timestamp with time zone,
	"begruendung" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "termin_vorschlag_status_check" CHECK ("termin_vorschlag"."status" in ('offen', 'freigegeben', 'abgelehnt', 'in_outlook_eingetragen')),
	CONSTRAINT "termin_vorschlag_zeiten_passen_zu_ganztaegig" CHECK (("termin_vorschlag"."ganztaegig" and "termin_vorschlag"."tag_von" is not null and "termin_vorschlag"."tag_bis" is not null and "termin_vorschlag"."beginn" is null and "termin_vorschlag"."ende" is null and "termin_vorschlag"."tag_bis" >= "termin_vorschlag"."tag_von") or (not "termin_vorschlag"."ganztaegig" and "termin_vorschlag"."beginn" is not null and "termin_vorschlag"."ende" is not null and "termin_vorschlag"."tag_von" is null and "termin_vorschlag"."tag_bis" is null and "termin_vorschlag"."ende" > "termin_vorschlag"."beginn")),
	CONSTRAINT "termin_vorschlag_tags_check" CHECK (cardinality("termin_vorschlag"."tag_ids") between 1 and 20),
	CONSTRAINT "termin_vorschlag_laengen_check" CHECK (char_length("termin_vorschlag"."titel") between 1 and 120 and char_length("termin_vorschlag"."ort") <= 120 and char_length("termin_vorschlag"."beschreibung") <= 2000 and char_length("termin_vorschlag"."bemerkung") <= 1000 and char_length("termin_vorschlag"."begruendung") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "termin_vorschlag" ADD CONSTRAINT "termin_vorschlag_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termin_vorschlag" ADD CONSTRAINT "termin_vorschlag_vorgeschlagen_von_user_id_fk" FOREIGN KEY ("vorgeschlagen_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termin_vorschlag" ADD CONSTRAINT "termin_vorschlag_entschieden_von_user_id_fk" FOREIGN KEY ("entschieden_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "termin_vorschlag_person_idx" ON "termin_vorschlag" USING btree ("vorgeschlagen_von","id");--> statement-breakpoint
CREATE INDEX "termin_vorschlag_abteilung_idx" ON "termin_vorschlag" USING btree ("abteilung_id","status");
