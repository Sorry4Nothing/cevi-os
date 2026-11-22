-- Tagesseiten und Wetter im Lager (#391): tagesseite (eine Seite je Lagertag mit Tageschef und Notiz), tagesseite_block (Blöcke «wichtig», «idee» und «programmbild» mit Verknüpfung auf lager_datei), wetter_cache (Zwischenspeicher je Lager) und lager.breite und lager.laenge (Ort für das Wetter). Die Migration legt an; bestehende Lager haben keinen Ort und damit kein Wetter.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0086_lager_tagesseiten.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0086_lager_tagesseiten.sql
--   Es gehen die Tagesseiten samt Blöcken, der Wetter-Zwischenspeicher und der Ort der Lager verloren; die Einträge in lager_datei bleiben und laufen ohne Verweis nach 24 Stunden aus. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
ALTER TABLE "lager" ADD COLUMN "breite" double precision;--> statement-breakpoint
ALTER TABLE "lager" ADD COLUMN "laenge" double precision;--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_ort_check" CHECK (("lager"."breite" is null) = ("lager"."laenge" is null) and ("lager"."breite" is null or ("lager"."breite" between -90 and 90 and "lager"."laenge" between -180 and 180)));--> statement-breakpoint
CREATE TABLE "tagesseite" (
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
	"tageschef_person_id" uuid,
	"notiz" text,
	CONSTRAINT "tagesseite_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "tagesseite_notiz_check" CHECK ("tagesseite"."notiz" is null or char_length("tagesseite"."notiz") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "tagesseite_block" (
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
	"seite_id" uuid NOT NULL,
	"art" text NOT NULL,
	"text" text NOT NULL,
	"datei_id" uuid,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tagesseite_block_check" CHECK ("tagesseite_block"."art" in ('wichtig', 'idee', 'programmbild') and char_length("tagesseite_block"."text") between 1 and 1000 and ("tagesseite_block"."art" = 'programmbild') = ("tagesseite_block"."datei_id" is not null) and "tagesseite_block"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wetter_cache" (
	"lager_id" uuid PRIMARY KEY NOT NULL,
	"breite" double precision NOT NULL,
	"laenge" double precision NOT NULL,
	"abgerufen_am" timestamp with time zone,
	"versuch_am" timestamp with time zone NOT NULL,
	"tage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "wetter_cache_check" CHECK (jsonb_typeof("wetter_cache"."tage") = 'array' and jsonb_array_length("wetter_cache"."tage") <= 30)
);
--> statement-breakpoint
ALTER TABLE "tagesseite" ADD CONSTRAINT "tagesseite_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite" ADD CONSTRAINT "tagesseite_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite" ADD CONSTRAINT "tagesseite_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite" ADD CONSTRAINT "tagesseite_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite_block" ADD CONSTRAINT "tagesseite_block_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite_block" ADD CONSTRAINT "tagesseite_block_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite_block" ADD CONSTRAINT "tagesseite_block_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite_block" ADD CONSTRAINT "tagesseite_block_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wetter_cache" ADD CONSTRAINT "wetter_cache_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite" ADD CONSTRAINT "tagesseite_lagertag_fk" FOREIGN KEY ("lager_id","lagertag_id") REFERENCES "public"."lagertag"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite" ADD CONSTRAINT "tagesseite_tageschef_fk" FOREIGN KEY ("lager_id","tageschef_person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE set null ("tageschef_person_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite_block" ADD CONSTRAINT "tagesseite_block_datei_id_lager_datei_id_fk" FOREIGN KEY ("datei_id") REFERENCES "public"."lager_datei"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagesseite_block" ADD CONSTRAINT "tagesseite_block_seite_fk" FOREIGN KEY ("lager_id","seite_id") REFERENCES "public"."tagesseite"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tagesseite_lagertag_uq" ON "tagesseite" USING btree ("lagertag_id") WHERE "tagesseite"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "tagesseite_lagertag_idx" ON "tagesseite" USING btree ("lager_id","lagertag_id");--> statement-breakpoint
CREATE INDEX "tagesseite_block_liste_idx" ON "tagesseite_block" USING btree ("lager_id","seite_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "tagesseite_block_datei_idx" ON "tagesseite_block" USING btree ("datei_id");
