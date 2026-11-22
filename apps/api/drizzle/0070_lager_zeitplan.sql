-- Zeitplan des Lagers (#374): meilenstein, lagertag und tagesabschnitt, dazu die relative Frist der Aufgabe (frist_meilenstein_id, frist_versatz_tage) und die Indizes für den Erinnerungslauf. Die Migration legt an und ergänzt zwei Spalten ohne Wert; bestehende Aufgaben behalten ihre absolute Frist. Die Fremdschlüssel von anwesenheit auf lagertag und tagesabschnitt folgen in 0095 (die Tabelle anwesenheit entsteht erst in 0085).
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0070_lager_zeitplan.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0070_lager_zeitplan.sql
--   Es gehen alle Meilensteine, Lagertage und Tagesabschnitte verloren, ebenso die relative Frist der Aufgaben (die berechnete Frist bleibt als absolutes Datum stehen). Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus. Nach 0095 zuerst deren Rückweg ausführen.
CREATE TABLE "meilenstein" (
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
	"titel" text NOT NULL,
	"datum" date NOT NULL,
	"art" text,
	CONSTRAINT "meilenstein_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "meilenstein_text_check" CHECK (char_length("meilenstein"."titel") between 1 and 200 and ("meilenstein"."art" is null or char_length("meilenstein"."art") between 1 and 50))
);
--> statement-breakpoint
CREATE TABLE "lagertag" (
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
	"datum" date NOT NULL,
	"label" text,
	CONSTRAINT "lagertag_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "lagertag_label_check" CHECK ("lagertag"."label" is null or char_length("lagertag"."label") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "tagesabschnitt" (
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
	"zeit" text,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tagesabschnitt_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "tagesabschnitt_check" CHECK (char_length("tagesabschnitt"."name") between 1 and 50 and ("tagesabschnitt"."zeit" is null or "tagesabschnitt"."zeit" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and "tagesabschnitt"."reihenfolge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "aufgabe" ADD COLUMN "frist_meilenstein_id" uuid;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD COLUMN "frist_versatz_tage" integer;--> statement-breakpoint
ALTER TABLE "meilenstein" ADD CONSTRAINT "meilenstein_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meilenstein" ADD CONSTRAINT "meilenstein_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meilenstein" ADD CONSTRAINT "meilenstein_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meilenstein" ADD CONSTRAINT "meilenstein_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lagertag" ADD CONSTRAINT "lagertag_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lagertag" ADD CONSTRAINT "lagertag_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lagertag" ADD CONSTRAINT "lagertag_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lagertag" ADD CONSTRAINT "lagertag_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesabschnitt" ADD CONSTRAINT "tagesabschnitt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesabschnitt" ADD CONSTRAINT "tagesabschnitt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesabschnitt" ADD CONSTRAINT "tagesabschnitt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesabschnitt" ADD CONSTRAINT "tagesabschnitt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_frist_meilenstein_fk" FOREIGN KEY ("lager_id","frist_meilenstein_id") REFERENCES "public"."meilenstein"("lager_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_relative_frist_check" CHECK (("aufgabe"."frist_meilenstein_id" is null or "aufgabe"."frist_versatz_tage" is not null) and ("aufgabe"."frist_versatz_tage" is null or ("aufgabe"."frist" is not null and "aufgabe"."frist_versatz_tage" between -3650 and 3650)));--> statement-breakpoint
CREATE INDEX "meilenstein_liste_idx" ON "meilenstein" USING btree ("lager_id","datum","id");--> statement-breakpoint
CREATE UNIQUE INDEX "lagertag_datum_uq" ON "lagertag" USING btree ("lager_id","datum") WHERE "lagertag"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tagesabschnitt_name_uq" ON "tagesabschnitt" USING btree ("lager_id",lower("name")) WHERE "tagesabschnitt"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "tagesabschnitt_liste_idx" ON "tagesabschnitt" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "aufgabe_erinnerung_idx" ON "aufgabe" USING btree ("frist") WHERE "aufgabe"."frist" is not null and "aufgabe"."status" <> 'erledigt' and "aufgabe"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "aufgabe_frist_meilenstein_idx" ON "aufgabe" USING btree ("lager_id","frist_meilenstein_id") WHERE "aufgabe"."frist_meilenstein_id" is not null;
