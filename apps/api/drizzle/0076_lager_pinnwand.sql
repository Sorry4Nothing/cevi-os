-- Pinnwand des Lagers (#381): pinnwand_beitrag, pinnwand_empfaenger, pinnwand_datei. Die Migration legt nur an; bestehende Daten ändert sie nicht.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0076_lager_pinnwand.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0076_lager_pinnwand.sql
--   Es gehen alle Beiträge, ihre Empfänger und die Verweise auf Dateien verloren; die Einträge in lager_datei bleiben und entfallen nach 24 Stunden, wenn kein Datensatz sie mehr einbindet. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "pinnwand_beitrag" (
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
	"text" text DEFAULT '' NOT NULL,
	"wichtig" boolean DEFAULT false NOT NULL,
	"angeheftet" boolean DEFAULT false NOT NULL,
	"sichtbar_ab" timestamp with time zone,
	"sichtbar_bis" timestamp with time zone,
	CONSTRAINT "pinnwand_beitrag_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "pinnwand_beitrag_check" CHECK (char_length("pinnwand_beitrag"."titel") between 1 and 200 and char_length("pinnwand_beitrag"."text") <= 10000 and ("pinnwand_beitrag"."sichtbar_ab" is null or "pinnwand_beitrag"."sichtbar_bis" is null or "pinnwand_beitrag"."sichtbar_bis" > "pinnwand_beitrag"."sichtbar_ab"))
);
--> statement-breakpoint
CREATE TABLE "pinnwand_empfaenger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"beitrag_id" uuid NOT NULL,
	"rolle" text,
	"person_id" uuid,
	CONSTRAINT "pinnwand_empfaenger_check" CHECK (("pinnwand_empfaenger"."rolle" is null) <> ("pinnwand_empfaenger"."person_id" is null) and ("pinnwand_empfaenger"."rolle" is null or "pinnwand_empfaenger"."rolle" in ('leitung', 'team', 'lesen')))
);
--> statement-breakpoint
CREATE TABLE "pinnwand_datei" (
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
	"datei_id" uuid NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pinnwand_datei_check" CHECK ("pinnwand_datei"."reihenfolge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pinnwand_beitrag" ADD CONSTRAINT "pinnwand_beitrag_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_beitrag" ADD CONSTRAINT "pinnwand_beitrag_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_beitrag" ADD CONSTRAINT "pinnwand_beitrag_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_beitrag" ADD CONSTRAINT "pinnwand_beitrag_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_datei" ADD CONSTRAINT "pinnwand_datei_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_datei" ADD CONSTRAINT "pinnwand_datei_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_datei" ADD CONSTRAINT "pinnwand_datei_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_datei" ADD CONSTRAINT "pinnwand_datei_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_empfaenger" ADD CONSTRAINT "pinnwand_empfaenger_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_empfaenger" ADD CONSTRAINT "pinnwand_empfaenger_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_empfaenger" ADD CONSTRAINT "pinnwand_empfaenger_beitrag_fk" FOREIGN KEY ("lager_id","beitrag_id") REFERENCES "public"."pinnwand_beitrag"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_datei" ADD CONSTRAINT "pinnwand_datei_datei_id_lager_datei_id_fk" FOREIGN KEY ("datei_id") REFERENCES "public"."lager_datei"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_datei" ADD CONSTRAINT "pinnwand_datei_beitrag_fk" FOREIGN KEY ("lager_id","beitrag_id") REFERENCES "public"."pinnwand_beitrag"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pinnwand_beitrag_lager_idx" ON "pinnwand_beitrag" USING btree ("lager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pinnwand_empfaenger_rolle_uq" ON "pinnwand_empfaenger" USING btree ("beitrag_id","rolle") WHERE "pinnwand_empfaenger"."rolle" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pinnwand_empfaenger_person_uq" ON "pinnwand_empfaenger" USING btree ("beitrag_id","person_id") WHERE "pinnwand_empfaenger"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "pinnwand_datei_beitrag_idx" ON "pinnwand_datei" USING btree ("beitrag_id");--> statement-breakpoint
CREATE INDEX "pinnwand_datei_datei_idx" ON "pinnwand_datei" USING btree ("datei_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pinnwand_datei_uq" ON "pinnwand_datei" USING btree ("beitrag_id","datei_id") WHERE "pinnwand_datei"."geloescht_am" is null;
