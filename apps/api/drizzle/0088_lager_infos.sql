-- Packliste, Notfall und Infos im Lager (#393): packliste_punkt (Vorlage der Lagerleitung), packliste_abhaken (Abweichungen je Person, keine Kopie), packliste_eigen (eigene Punkte einer Person), notfall_kontakt, info_abschnitt und info_abschnitt_datei (Verknüpfungen auf lager_datei) sowie lager.karten_link. Die Migration legt an; bestehende Lager haben keinen Kartenlink.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0088_lager_infos.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0088_lager_infos.sql
--   Es gehen die Packliste samt Abweichungen und eigenen Punkten, die Notfall-Kontakte, die Info-Abschnitte samt Datei-Verknüpfungen und der Kartenlink verloren; die Einträge in lager_datei bleiben und laufen ohne Verweis nach 24 Stunden aus. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
ALTER TABLE "lager" ADD COLUMN "karten_link" text;--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_karten_link_check" CHECK ("lager"."karten_link" is null or ("lager"."karten_link" ~ '^https://[^[:space:]]+$' and strpos("lager"."karten_link", chr(92)) = 0 and char_length("lager"."karten_link") <= 2048));--> statement-breakpoint
CREATE TABLE "packliste_punkt" (
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
	"abschnitt" text NOT NULL,
	"text" text NOT NULL,
	"nur_lagerleitung" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "packliste_punkt_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "packliste_punkt_text_check" CHECK (char_length("packliste_punkt"."abschnitt") between 1 and 100 and char_length("packliste_punkt"."text") between 1 and 300 and "packliste_punkt"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "packliste_abhaken" (
	"lager_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"punkt_id" uuid NOT NULL,
	"zustand" text NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packliste_abhaken_person_id_punkt_id_pk" PRIMARY KEY("person_id","punkt_id"),
	CONSTRAINT "packliste_abhaken_zustand_check" CHECK ("packliste_abhaken"."zustand" in ('abgehakt', 'entfernt'))
);
--> statement-breakpoint
CREATE TABLE "packliste_eigen" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"abschnitt" text NOT NULL,
	"text" text NOT NULL,
	"abgehakt" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packliste_eigen_text_check" CHECK (char_length("packliste_eigen"."abschnitt") between 1 and 100 and char_length("packliste_eigen"."text") between 1 and 300 and "packliste_eigen"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notfall_kontakt" (
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
	"funktion" text NOT NULL,
	"person_id" uuid,
	"name" text,
	"telefon" text,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notfall_kontakt_check" CHECK (char_length("notfall_kontakt"."funktion") between 1 and 100 and num_nonnulls("notfall_kontakt"."person_id", "notfall_kontakt"."name") = 1 and ("notfall_kontakt"."name" is null or (char_length("notfall_kontakt"."name") between 1 and 100 and "notfall_kontakt"."telefon" is not null)) and ("notfall_kontakt"."telefon" is null or "notfall_kontakt"."telefon" ~ '^\+?[0-9][0-9 ()/.-]{4,28}[0-9]$') and "notfall_kontakt"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "info_abschnitt" (
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
	"text" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nur_lagerleitung" boolean DEFAULT false NOT NULL,
	"notfall" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "info_abschnitt_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "info_abschnitt_check" CHECK (char_length("info_abschnitt"."titel") between 1 and 200 and ("info_abschnitt"."text" is null or char_length("info_abschnitt"."text") <= 20000) and jsonb_typeof("info_abschnitt"."links") = 'array' and jsonb_array_length("info_abschnitt"."links") <= 20 and "info_abschnitt"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "info_abschnitt_datei" (
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
	"abschnitt_id" uuid NOT NULL,
	"datei_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packliste_punkt" ADD CONSTRAINT "packliste_punkt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_punkt" ADD CONSTRAINT "packliste_punkt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_punkt" ADD CONSTRAINT "packliste_punkt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_punkt" ADD CONSTRAINT "packliste_punkt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_abhaken" ADD CONSTRAINT "packliste_abhaken_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_abhaken" ADD CONSTRAINT "packliste_abhaken_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_abhaken" ADD CONSTRAINT "packliste_abhaken_punkt_fk" FOREIGN KEY ("lager_id","punkt_id") REFERENCES "public"."packliste_punkt"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_eigen" ADD CONSTRAINT "packliste_eigen_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packliste_eigen" ADD CONSTRAINT "packliste_eigen_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notfall_kontakt" ADD CONSTRAINT "notfall_kontakt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notfall_kontakt" ADD CONSTRAINT "notfall_kontakt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notfall_kontakt" ADD CONSTRAINT "notfall_kontakt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notfall_kontakt" ADD CONSTRAINT "notfall_kontakt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notfall_kontakt" ADD CONSTRAINT "notfall_kontakt_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt" ADD CONSTRAINT "info_abschnitt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt" ADD CONSTRAINT "info_abschnitt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt" ADD CONSTRAINT "info_abschnitt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt" ADD CONSTRAINT "info_abschnitt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" ADD CONSTRAINT "info_abschnitt_datei_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" ADD CONSTRAINT "info_abschnitt_datei_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" ADD CONSTRAINT "info_abschnitt_datei_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" ADD CONSTRAINT "info_abschnitt_datei_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" ADD CONSTRAINT "info_abschnitt_datei_datei_id_lager_datei_id_fk" FOREIGN KEY ("datei_id") REFERENCES "public"."lager_datei"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" ADD CONSTRAINT "info_abschnitt_datei_abschnitt_fk" FOREIGN KEY ("lager_id","abschnitt_id") REFERENCES "public"."info_abschnitt"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packliste_punkt_liste_idx" ON "packliste_punkt" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "packliste_abhaken_punkt_idx" ON "packliste_abhaken" USING btree ("lager_id","punkt_id");--> statement-breakpoint
CREATE INDEX "packliste_eigen_liste_idx" ON "packliste_eigen" USING btree ("lager_id","person_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "packliste_eigen_person_idx" ON "packliste_eigen" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "notfall_kontakt_liste_idx" ON "notfall_kontakt" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "notfall_kontakt_person_idx" ON "notfall_kontakt" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "info_abschnitt_liste_idx" ON "info_abschnitt" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "info_abschnitt_datei_liste_idx" ON "info_abschnitt_datei" USING btree ("lager_id","abschnitt_id","id");--> statement-breakpoint
CREATE INDEX "info_abschnitt_datei_datei_idx" ON "info_abschnitt_datei" USING btree ("datei_id");--> statement-breakpoint
CREATE UNIQUE INDEX "info_abschnitt_datei_uq" ON "info_abschnitt_datei" USING btree ("abschnitt_id","datei_id") WHERE "info_abschnitt_datei"."geloescht_am" is null;
