-- Fotos aus Flickr (#690): welches Flickr-Konto die Abteilung zeigt (foto_einstellung) und welche Alben auf der Website erscheinen (foto_album). Die Migration legt nur an, bestehende Tabellen bleiben unberührt. Zugangsdaten zu Flickr stehen nie in der Datenbank.
-- Rückweg: drizzle/rueckweg/0156_fotos.sql
CREATE TABLE "foto_einstellung" (
	"abteilung_id" uuid PRIMARY KEY NOT NULL,
	"flickr_konto" text,
	"flickr_link_zeigen" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foto_einstellung_konto_check" CHECK ("foto_einstellung"."flickr_konto" is null or "foto_einstellung"."flickr_konto" ~ '^[0-9]{1,20}@N[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "foto_album" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"flickr_album_id" text NOT NULL,
	"sichtbar" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"titel" text,
	"version" integer DEFAULT 1 NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foto_album_flickr_check" CHECK ("foto_album"."flickr_album_id" ~ '^[0-9]{1,20}$'),
	CONSTRAINT "foto_album_titel_check" CHECK ("foto_album"."titel" is null or char_length("foto_album"."titel") between 1 and 120),
	CONSTRAINT "foto_album_reihenfolge_check" CHECK ("foto_album"."reihenfolge" between 0 and 9999)
);
--> statement-breakpoint
ALTER TABLE "foto_einstellung" ADD CONSTRAINT "foto_einstellung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foto_album" ADD CONSTRAINT "foto_album_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "foto_album_flickr_idx" ON "foto_album" USING btree ("abteilung_id","flickr_album_id");--> statement-breakpoint
CREATE INDEX "foto_album_abteilung_idx" ON "foto_album" USING btree ("abteilung_id","reihenfolge");
--> statement-breakpoint
INSERT INTO "plattform_rolle_recht" ("rolle_id", "recht") SELECT "id", 'fotos.verwalten' FROM "plattform_rolle" WHERE "schluessel" = 'webmaster' ON CONFLICT DO NOTHING;
