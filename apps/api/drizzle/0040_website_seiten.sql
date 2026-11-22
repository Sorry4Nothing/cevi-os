-- Seiten der Website (#348): Navigationsbaum mit Sichtbarkeit und dem Entwurf als ein JSON-Dokument; seite_version hält die veröffentlichten Stände, unveränderlich.
-- Adresse, Elternseite, Titel, Reihenfolge und Sichtbarkeit wirken sofort (Spalten); nur der Inhalt (entwurf, seite_version.inhalt) ist versioniert.
-- Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts; von Hand, nur solange nichts auf die Tabellen verweist):
--   ALTER TABLE "seite" DROP CONSTRAINT "seite_veroeffentlichte_version_id_seite_version_id_fk"; DROP TABLE "seite_version"; DROP TABLE "seite"; DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
CREATE TABLE "seite" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"eltern_id" uuid,
	"adresse" text NOT NULL,
	"titel" text NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"sichtbarkeit" text NOT NULL,
	"sichtbarkeit_tags" uuid[] DEFAULT '{}' NOT NULL,
	"tag_id" uuid,
	"herkunft" text,
	"veroeffentlichte_version_id" uuid,
	"entwurf" jsonb,
	"entwurf_zaehler" integer DEFAULT 0 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seite_adresse_eindeutig" UNIQUE NULLS NOT DISTINCT("abteilung_id","eltern_id","adresse"),
	CONSTRAINT "seite_tag_eindeutig" UNIQUE("tag_id"),
	CONSTRAINT "seite_herkunft_eindeutig" UNIQUE("abteilung_id","herkunft"),
	CONSTRAINT "seite_adresse_check" CHECK ("seite"."adresse" ~ '^[a-z0-9-]{1,60}$'),
	CONSTRAINT "seite_titel_check" CHECK (char_length("seite"."titel") between 1 and 150),
	CONSTRAINT "seite_sichtbarkeit_check" CHECK ("seite"."sichtbarkeit" in ('oeffentlich', 'angemeldet', 'tags'))
);
--> statement-breakpoint
CREATE TABLE "seite_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seite_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"inhalt" jsonb NOT NULL,
	"autor_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seite_version_nr_eindeutig" UNIQUE("seite_id","nr"),
	CONSTRAINT "seite_version_nr_check" CHECK ("seite_version"."nr" >= 1)
);
--> statement-breakpoint
ALTER TABLE "seite" ADD CONSTRAINT "seite_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seite" ADD CONSTRAINT "seite_eltern_id_seite_id_fk" FOREIGN KEY ("eltern_id") REFERENCES "public"."seite"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seite" ADD CONSTRAINT "seite_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seite_version" ADD CONSTRAINT "seite_version_seite_id_seite_id_fk" FOREIGN KEY ("seite_id") REFERENCES "public"."seite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seite_version" ADD CONSTRAINT "seite_version_autor_id_user_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seite" ADD CONSTRAINT "seite_veroeffentlichte_version_id_seite_version_id_fk" FOREIGN KEY ("veroeffentlichte_version_id") REFERENCES "public"."seite_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seite_abteilung_idx" ON "seite" USING btree ("abteilung_id");--> statement-breakpoint
CREATE INDEX "seite_eltern_id_idx" ON "seite" USING btree ("eltern_id");--> statement-breakpoint
-- Eine Version bleibt, wie sie ist: Die API-Rolle legt sie an und liest sie, ändert sie nie (wie audit_log). Mit der Seite verschwinden ihre Versionen über den Fremdschlüssel
REVOKE UPDATE ON "seite_version" FROM cevi_os_api;
