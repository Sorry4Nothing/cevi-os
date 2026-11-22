-- Programmgruppen und «nicht dabei» (#387): gruppe, gruppe_zuordnung (eine Person oder ein Teilnehmender in höchstens einer Gruppe) und teilnehmer.abgewaehlt. Die Migration legt nur an, bestehende Zeilen bleiben unberührt (abgewaehlt gilt für alle als false).
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0083_lager_gruppen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0083_lager_gruppen.sql
--   Es gehen alle Gruppen, ihre Zuordnungen und die Abwahl der Teilnehmenden verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "gruppe" (
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
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gruppe_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "gruppe_check" CHECK (char_length("gruppe"."name") between 1 and 100 and "gruppe"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gruppe_zuordnung" (
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
	"gruppe_id" uuid NOT NULL,
	"teilnehmer_id" uuid,
	"person_id" uuid,
	"rolle" text DEFAULT 'mitglied' NOT NULL,
	CONSTRAINT "gruppe_zuordnung_check" CHECK (("gruppe_zuordnung"."teilnehmer_id" is null) <> ("gruppe_zuordnung"."person_id" is null) and "gruppe_zuordnung"."rolle" in ('leitung', 'mitglied') and ("gruppe_zuordnung"."teilnehmer_id" is null or "gruppe_zuordnung"."rolle" = 'mitglied'))
);
--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD COLUMN "abgewaehlt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gruppe" ADD CONSTRAINT "gruppe_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe" ADD CONSTRAINT "gruppe_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe" ADD CONSTRAINT "gruppe_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe" ADD CONSTRAINT "gruppe_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_gruppe_fk" FOREIGN KEY ("lager_id","gruppe_id") REFERENCES "public"."gruppe"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" ADD CONSTRAINT "gruppe_zuordnung_teilnehmer_fk" FOREIGN KEY ("lager_id","teilnehmer_id") REFERENCES "public"."teilnehmer"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gruppe_liste_idx" ON "gruppe" USING btree ("lager_id","reihenfolge","name","id");--> statement-breakpoint
CREATE INDEX "gruppe_zuordnung_gruppe_idx" ON "gruppe_zuordnung" USING btree ("gruppe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gruppe_zuordnung_teilnehmer_uq" ON "gruppe_zuordnung" USING btree ("lager_id","teilnehmer_id") WHERE "gruppe_zuordnung"."teilnehmer_id" is not null and "gruppe_zuordnung"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "gruppe_zuordnung_person_uq" ON "gruppe_zuordnung" USING btree ("lager_id","person_id") WHERE "gruppe_zuordnung"."person_id" is not null and "gruppe_zuordnung"."geloescht_am" is null;
