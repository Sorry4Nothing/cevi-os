-- Zimmer und Zelte des Lagers (#385): zimmer (Name, Art, Plätze, Notiz) und zimmer_zuordnung (eine Zeile je Teilnehmende oder Mitglied und Zimmer). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0080_lager_zimmer.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0080_lager_zimmer.sql
--   Es gehen alle Zimmer und alle Zuordnungen verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "zimmer" (
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
	"art" text NOT NULL,
	"plaetze" integer NOT NULL,
	"notiz" text,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "zimmer_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "zimmer_art_check" CHECK ("zimmer"."art" in ('zimmer', 'zelt')),
	CONSTRAINT "zimmer_check" CHECK (char_length("zimmer"."name") between 1 and 100 and "zimmer"."plaetze" between 1 and 1000 and ("zimmer"."notiz" is null or char_length("zimmer"."notiz") between 1 and 500) and "zimmer"."reihenfolge" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "zimmer_zuordnung" (
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
	"zimmer_id" uuid NOT NULL,
	"teilnehmer_id" uuid,
	"person_id" uuid,
	CONSTRAINT "zimmer_zuordnung_ziel_check" CHECK (("zimmer_zuordnung"."teilnehmer_id" is null) <> ("zimmer_zuordnung"."person_id" is null))
);
--> statement-breakpoint
ALTER TABLE "zimmer" ADD CONSTRAINT "zimmer_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer" ADD CONSTRAINT "zimmer_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer" ADD CONSTRAINT "zimmer_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer" ADD CONSTRAINT "zimmer_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_zimmer_fk" FOREIGN KEY ("lager_id","zimmer_id") REFERENCES "public"."zimmer"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" ADD CONSTRAINT "zimmer_zuordnung_teilnehmer_fk" FOREIGN KEY ("lager_id","teilnehmer_id") REFERENCES "public"."teilnehmer"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zimmer_liste_idx" ON "zimmer" USING btree ("lager_id","reihenfolge","name","id");--> statement-breakpoint
CREATE INDEX "zimmer_zuordnung_zimmer_idx" ON "zimmer_zuordnung" USING btree ("zimmer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zimmer_zuordnung_teilnehmer_uq" ON "zimmer_zuordnung" USING btree ("lager_id","teilnehmer_id") WHERE "zimmer_zuordnung"."teilnehmer_id" is not null and "zimmer_zuordnung"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "zimmer_zuordnung_person_uq" ON "zimmer_zuordnung" USING btree ("lager_id","person_id") WHERE "zimmer_zuordnung"."person_id" is not null and "zimmer_zuordnung"."geloescht_am" is null;
