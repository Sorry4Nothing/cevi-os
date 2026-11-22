-- Plattformrollen (#423): Rollen der Abteilung mit einstellbaren Rechten aus dem Katalog im Code (plattform.ts), dazu die Entwickler der Plattform.
-- Legt nur Tabellen an und je bestehende Abteilung die Vorgabe «Webmaster» mit allen Rechten ausser dem Wartungsmodus; keine bestehende Tabelle wird angefasst.
-- Rückweg (von Hand): siehe rueckweg/0100_plattformrollen.sql
CREATE TABLE "plattform_rolle" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"name" text NOT NULL,
	"schluessel" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plattform_rolle_schluessel_check" CHECK ("plattform_rolle"."schluessel" is null or "plattform_rolle"."schluessel" in ('webmaster')),
	CONSTRAINT "plattform_rolle_name_check" CHECK (char_length("plattform_rolle"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "plattform_rolle_recht" (
	"rolle_id" uuid NOT NULL,
	"recht" text NOT NULL,
	CONSTRAINT "plattform_rolle_recht_rolle_id_recht_pk" PRIMARY KEY("rolle_id","recht")
);
--> statement-breakpoint
CREATE TABLE "person_plattform_rolle" (
	"user_id" uuid NOT NULL,
	"rolle_id" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_plattform_rolle_user_id_rolle_id_pk" PRIMARY KEY("user_id","rolle_id")
);
--> statement-breakpoint
CREATE TABLE "plattform_entwickler" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plattform_rolle" ADD CONSTRAINT "plattform_rolle_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plattform_rolle_recht" ADD CONSTRAINT "plattform_rolle_recht_rolle_id_plattform_rolle_id_fk" FOREIGN KEY ("rolle_id") REFERENCES "public"."plattform_rolle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_plattform_rolle" ADD CONSTRAINT "person_plattform_rolle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_plattform_rolle" ADD CONSTRAINT "person_plattform_rolle_rolle_id_plattform_rolle_id_fk" FOREIGN KEY ("rolle_id") REFERENCES "public"."plattform_rolle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plattform_entwickler" ADD CONSTRAINT "plattform_entwickler_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plattform_rolle_name_pro_abteilung" ON "plattform_rolle" USING btree ("abteilung_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "plattform_rolle_schluessel_pro_abteilung" ON "plattform_rolle" USING btree ("abteilung_id","schluessel") WHERE "plattform_rolle"."schluessel" is not null;--> statement-breakpoint
CREATE INDEX "person_plattform_rolle_rolle_id_idx" ON "person_plattform_rolle" USING btree ("rolle_id");--> statement-breakpoint
-- Vorgabe «Webmaster» je Abteilung: alle Rechte des Katalogs ausser dem Wartungsmodus der Website (Entscheid vom 22.11.2026)
INSERT INTO "plattform_rolle" ("abteilung_id", "name", "schluessel") SELECT "id", 'Webmaster', 'webmaster' FROM "abteilung";--> statement-breakpoint
INSERT INTO "plattform_rolle_recht" ("rolle_id", "recht") SELECT r."id", v."recht" FROM "plattform_rolle" r CROSS JOIN (VALUES ('seiten.bearbeiten'), ('seiten.veroeffentlichen'), ('seiten.anlegen_loeschen'), ('medien.verwalten'), ('weiterleitungen.verwalten'), ('vorlagen.nutzen')) AS v("recht") WHERE r."schluessel" = 'webmaster';
