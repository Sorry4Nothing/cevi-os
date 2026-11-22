-- Lager und Mitglieder (#364). Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0060_lager.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0060_lager.sql
--   Es gehen alle Lager und Mitgliedschaften verloren. Spätere Lager-Tabellen (ab 0061) zuerst zurückbauen: Sie hängen mit ON DELETE CASCADE am Lager, DROP TABLE "lager" scheitert sonst.
CREATE TABLE "lager" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"anlass_id" uuid,
	"titel" text NOT NULL,
	"von" date NOT NULL,
	"bis" date NOT NULL,
	"vorbereitung_ab" date,
	"ort" text,
	"adresse" text,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"uebung" boolean DEFAULT false NOT NULL,
	"farbe" text,
	"logo_medium_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lager_status_check" CHECK ("lager"."status" in ('entwurf', 'aktiv', 'abgeschlossen', 'archiviert')),
	CONSTRAINT "lager_zeitraum_check" CHECK ("lager"."bis" >= "lager"."von" and ("lager"."vorbereitung_ab" is null or "lager"."vorbereitung_ab" <= "lager"."von")),
	CONSTRAINT "lager_farbe_check" CHECK ("lager"."farbe" is null or "lager"."farbe" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "lager_mitglied" (
	"lager_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rolle" text NOT NULL,
	"ressort_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lager_mitglied_lager_id_person_id_pk" PRIMARY KEY("lager_id","person_id"),
	CONSTRAINT "lager_mitglied_rolle_check" CHECK ("lager_mitglied"."rolle" in ('lagerleitung', 'leitung', 'team', 'lesen'))
);
--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_logo_medium_id_medium_id_fk" FOREIGN KEY ("logo_medium_id") REFERENCES "public"."medium"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_mitglied" ADD CONSTRAINT "lager_mitglied_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_mitglied" ADD CONSTRAINT "lager_mitglied_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lager_abteilung_id_idx" ON "lager" USING btree ("abteilung_id","von");--> statement-breakpoint
CREATE INDEX "lager_mitglied_person_id_idx" ON "lager_mitglied" USING btree ("person_id");
