-- Umfragen und Reaktionen des Lagers (#382): umfrage, umfrage_option, umfrage_stimme, reaktion. Die Migration legt nur an; bestehende Daten ändert sie nicht.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0077_lager_umfragen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0077_lager_umfragen.sql
--   Es gehen alle Umfragen, Stimmen und Reaktionen verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "umfrage" (
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
	"beitrag_id" uuid NOT NULL,
	"mehrfach" boolean DEFAULT false NOT NULL,
	"schliesst_am" timestamp with time zone,
	"geschlossen" boolean DEFAULT false NOT NULL,
	"namen_fuer_team" boolean DEFAULT false NOT NULL,
	CONSTRAINT "umfrage_lager_id_id_uq" UNIQUE("lager_id","id")
);
--> statement-breakpoint
CREATE TABLE "umfrage_option" (
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
	"umfrage_id" uuid NOT NULL,
	"text" text NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "umfrage_option_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "umfrage_option_check" CHECK (char_length("umfrage_option"."text") between 1 and 200 and "umfrage_option"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "umfrage_stimme" (
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
	"umfrage_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaktion" (
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
	"ziel_typ" text NOT NULL,
	"ziel_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "reaktion_check" CHECK ("reaktion"."ziel_typ" in ('pinnwand_beitrag') and "reaktion"."emoji" in ('daumen', 'herz', 'lachen', 'staunen', 'danke'))
);
--> statement-breakpoint
ALTER TABLE "umfrage" ADD CONSTRAINT "umfrage_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage" ADD CONSTRAINT "umfrage_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage" ADD CONSTRAINT "umfrage_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage" ADD CONSTRAINT "umfrage_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_option" ADD CONSTRAINT "umfrage_option_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_option" ADD CONSTRAINT "umfrage_option_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_option" ADD CONSTRAINT "umfrage_option_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_option" ADD CONSTRAINT "umfrage_option_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reaktion" ADD CONSTRAINT "reaktion_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reaktion" ADD CONSTRAINT "reaktion_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reaktion" ADD CONSTRAINT "reaktion_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reaktion" ADD CONSTRAINT "reaktion_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reaktion" ADD CONSTRAINT "reaktion_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage" ADD CONSTRAINT "umfrage_beitrag_fk" FOREIGN KEY ("lager_id","beitrag_id") REFERENCES "public"."pinnwand_beitrag"("lager_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_option" ADD CONSTRAINT "umfrage_option_umfrage_fk" FOREIGN KEY ("lager_id","umfrage_id") REFERENCES "public"."umfrage"("lager_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_umfrage_fk" FOREIGN KEY ("lager_id","umfrage_id") REFERENCES "public"."umfrage"("lager_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" ADD CONSTRAINT "umfrage_stimme_option_fk" FOREIGN KEY ("lager_id","option_id") REFERENCES "public"."umfrage_option"("lager_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "umfrage_beitrag_uq" ON "umfrage" USING btree ("beitrag_id") WHERE "umfrage"."geloescht_am" is null;
--> statement-breakpoint
CREATE INDEX "umfrage_option_umfrage_idx" ON "umfrage_option" USING btree ("umfrage_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "umfrage_stimme_uq" ON "umfrage_stimme" USING btree ("option_id","person_id") WHERE "umfrage_stimme"."geloescht_am" is null;
--> statement-breakpoint
CREATE INDEX "umfrage_stimme_umfrage_idx" ON "umfrage_stimme" USING btree ("umfrage_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reaktion_uq" ON "reaktion" USING btree ("ziel_typ","ziel_id","person_id") WHERE "reaktion"."geloescht_am" is null;
--> statement-breakpoint
CREATE INDEX "reaktion_ziel_idx" ON "reaktion" USING btree ("ziel_typ","ziel_id");
