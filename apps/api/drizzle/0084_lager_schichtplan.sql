-- Dienste und Schichtplan (#388): dienst (Name, Beschreibung, Mindestbesetzung, Nachtwache, Tagesabschnitt) und schicht (eine Person oder ein Teilnehmender in einem Dienst an einem Lagertag). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0084_lager_schichtplan.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0084_lager_schichtplan.sql
--   Es gehen alle Dienste und Schichten verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "dienst" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" uuid,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" uuid,
	"geloescht_am" timestamp with time zone,
	"geloescht_von" uuid,
	"lager_seq" bigint NOT NULL,
	"name" text NOT NULL,
	"beschreibung" text,
	"mindestbesetzung" integer DEFAULT 1 NOT NULL,
	"nacht" boolean DEFAULT false NOT NULL,
	"tagesabschnitt_id" uuid NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dienst_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "dienst_lager_id_id_abschnitt_uq" UNIQUE("lager_id","id","tagesabschnitt_id"),
	CONSTRAINT "dienst_check" CHECK (char_length("dienst"."name") between 1 and 100 and ("dienst"."beschreibung" is null or char_length("dienst"."beschreibung") between 1 and 500) and "dienst"."mindestbesetzung" between 1 and 20 and "dienst"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "schicht" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" uuid,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" uuid,
	"geloescht_am" timestamp with time zone,
	"geloescht_von" uuid,
	"lager_seq" bigint NOT NULL,
	"lagertag_id" uuid NOT NULL,
	"tagesabschnitt_id" uuid NOT NULL,
	"dienst_id" uuid NOT NULL,
	"person_id" uuid,
	"teilnehmer_id" uuid,
	CONSTRAINT "schicht_check" CHECK (num_nonnulls("schicht"."person_id", "schicht"."teilnehmer_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "dienst" ADD CONSTRAINT "dienst_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dienst" ADD CONSTRAINT "dienst_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dienst" ADD CONSTRAINT "dienst_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dienst" ADD CONSTRAINT "dienst_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dienst" ADD CONSTRAINT "dienst_abschnitt_fk" FOREIGN KEY ("lager_id","tagesabschnitt_id") REFERENCES "public"."tagesabschnitt"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_lagertag_fk" FOREIGN KEY ("lager_id","lagertag_id") REFERENCES "public"."lagertag"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_dienst_fk" FOREIGN KEY ("lager_id","dienst_id","tagesabschnitt_id") REFERENCES "public"."dienst"("lager_id","id","tagesabschnitt_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_person_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schicht" ADD CONSTRAINT "schicht_teilnehmer_fk" FOREIGN KEY ("lager_id","teilnehmer_id") REFERENCES "public"."teilnehmer"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dienst_name_uq" ON "dienst" USING btree ("lager_id","tagesabschnitt_id",lower("name")) WHERE "dienst"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "dienst_liste_idx" ON "dienst" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE UNIQUE INDEX "schicht_person_uq" ON "schicht" USING btree ("lager_id","lagertag_id","tagesabschnitt_id","person_id") WHERE "schicht"."person_id" is not null and "schicht"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "schicht_teilnehmer_uq" ON "schicht" USING btree ("lager_id","lagertag_id","tagesabschnitt_id","teilnehmer_id") WHERE "schicht"."teilnehmer_id" is not null and "schicht"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "schicht_dienst_idx" ON "schicht" USING btree ("lager_id","dienst_id","lagertag_id");
