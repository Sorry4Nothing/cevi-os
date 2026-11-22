-- Bereichsschalter (#424 Wartungsmodus, #425 Informationssperre): Wartung (nur lesbar) und Sperre je Abteilung und Bereich.
-- Legt nur eine Tabelle an; keine bestehende Tabelle wird angefasst.
-- Rückweg (von Hand): siehe rueckweg/0102_bereichsschalter.sql
CREATE TABLE "bereichsschalter" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"bereich" text NOT NULL,
	"art" text NOT NULL,
	"hinweis" text,
	"ende" timestamp with time zone,
	"website_offline" boolean DEFAULT false NOT NULL,
	"ausgeloest_von" text NOT NULL,
	"ausgeloest_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bereichsschalter_abteilung_bereich_art" UNIQUE("abteilung_id","bereich","art"),
	CONSTRAINT "bereichsschalter_bereich_check" CHECK ("bereichsschalter"."bereich" in ('website', 'lager', 'chat', 'programme', 'verwaltung', 'alles')),
	CONSTRAINT "bereichsschalter_art_check" CHECK ("bereichsschalter"."art" in ('wartung', 'sperre')),
	CONSTRAINT "bereichsschalter_hinweis_check" CHECK ("bereichsschalter"."hinweis" is null or char_length("bereichsschalter"."hinweis") between 1 and 500),
	CONSTRAINT "bereichsschalter_offline_check" CHECK (not "bereichsschalter"."website_offline" or "bereichsschalter"."art" = 'sperre')
);
--> statement-breakpoint
ALTER TABLE "bereichsschalter" ADD CONSTRAINT "bereichsschalter_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;
