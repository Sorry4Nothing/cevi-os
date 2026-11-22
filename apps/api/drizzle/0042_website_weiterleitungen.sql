-- Weiterleitungen alter Adressen auf interne Seiten (#356). Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Beide Pfade sind relativ zur Website: Stücke aus a-z, 0-9 und «-» mit Endungen, höchstens 7 Stücke, nie «//», «\», «:», «..», Query oder Anker; das schliesst einen offenen Redirect in der Datenbank aus.
-- Dass das Ziel nie selbst eine alte Adresse ist (keine Kette, keine Schleife), prüfen die Routen unter einer Sperre je Abteilung.
-- Rückweg: drizzle/rueckweg/0042_website_weiterleitungen.sql
CREATE TABLE "weiterleitung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"alter_pfad" text NOT NULL,
	"ziel_pfad" text NOT NULL,
	"status" integer DEFAULT 301 NOT NULL,
	"erstellt_von" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weiterleitung_alt_eindeutig" UNIQUE("abteilung_id","alter_pfad"),
	CONSTRAINT "weiterleitung_alt_check" CHECK (char_length("weiterleitung"."alter_pfad") <= 200 and "weiterleitung"."alter_pfad" ~ '^/[a-z0-9-]+([.][a-z0-9]+)*(/[a-z0-9-]+([.][a-z0-9]+)*){0,6}$'),
	CONSTRAINT "weiterleitung_ziel_check" CHECK (char_length("weiterleitung"."ziel_pfad") <= 200 and ("weiterleitung"."ziel_pfad" = '/' or "weiterleitung"."ziel_pfad" ~ '^/[a-z0-9-]+([.][a-z0-9]+)*(/[a-z0-9-]+([.][a-z0-9]+)*){0,6}$')),
	CONSTRAINT "weiterleitung_ungleich_check" CHECK ("weiterleitung"."alter_pfad" <> "weiterleitung"."ziel_pfad"),
	CONSTRAINT "weiterleitung_status_check" CHECK ("weiterleitung"."status" in (301, 302))
);
--> statement-breakpoint
ALTER TABLE "weiterleitung" ADD CONSTRAINT "weiterleitung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weiterleitung" ADD CONSTRAINT "weiterleitung_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
