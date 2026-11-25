-- Schreibanbindung an den Outlook-Kalender (#835): Verbindung je Abteilung (Refresh-Token nur verschlüsselt), die von Cevi OS angelegten Kategorien der Postfachliste und die noch nicht in Outlook bestätigten Änderungen der Tags eines Termins.
-- Rückweg: drizzle/rueckweg/0167_outlook_schreiben.sql
CREATE TABLE "outlook_verbindung" (
	"abteilung_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"status" text DEFAULT 'aktiv' NOT NULL,
	"verbunden_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erneuert_am" timestamp with time zone,
	"kategorien_offen" boolean DEFAULT true NOT NULL,
	"akteur_id" text DEFAULT 'cli' NOT NULL,
	"versuche" integer DEFAULT 0 NOT NULL,
	"naechster_versuch" timestamp with time zone DEFAULT now() NOT NULL,
	"letzter_fehler" text,
	CONSTRAINT "outlook_verbindung_status_check" CHECK ("outlook_verbindung"."status" in ('aktiv', 'abgelaufen'))
);
--> statement-breakpoint
CREATE TABLE "outlook_kategorie" (
	"abteilung_id" uuid NOT NULL,
	"name_klein" text NOT NULL,
	"name" text NOT NULL,
	"outlook_id" text NOT NULL,
	CONSTRAINT "outlook_kategorie_abteilung_id_name_klein_pk" PRIMARY KEY("abteilung_id","name_klein")
);
--> statement-breakpoint
CREATE TABLE "outlook_aenderung" (
	"programm_id" uuid PRIMARY KEY NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"akteur_id" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geschrieben_am" timestamp with time zone,
	"versuche" integer DEFAULT 0 NOT NULL,
	"naechster_versuch" timestamp with time zone DEFAULT now() NOT NULL,
	"letzter_fehler" text
);
--> statement-breakpoint
ALTER TABLE "outlook_verbindung" ADD CONSTRAINT "outlook_verbindung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlook_kategorie" ADD CONSTRAINT "outlook_kategorie_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlook_aenderung" ADD CONSTRAINT "outlook_aenderung_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlook_aenderung" ADD CONSTRAINT "outlook_aenderung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outlook_aenderung_offen_idx" ON "outlook_aenderung" USING btree ("abteilung_id","naechster_versuch") WHERE "outlook_aenderung"."geschrieben_am" is null;
