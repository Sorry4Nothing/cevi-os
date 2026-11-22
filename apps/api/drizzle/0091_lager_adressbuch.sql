-- Adressbuch des Lagers (#397): adressbuch_kontakt (Name, Funktion, Gruppe, Telefon, E-Mail, Notiz, behalten). Personendaten Dritter. Die Migration legt an; sie fasst keine bestehenden Zeilen an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0091_lager_adressbuch.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0091_lager_adressbuch.sql
--   Es gehen alle Kontakte des Adressbuchs verloren. Einträge von adressbuch_kontakt im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "adressbuch_kontakt" (
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
	"funktion" text,
	"gruppe" text,
	"telefon" text,
	"email" text,
	"notiz" text,
	"behalten" boolean DEFAULT false NOT NULL,
	CONSTRAINT "adressbuch_kontakt_check" CHECK (char_length("adressbuch_kontakt"."name") between 1 and 100 and ("adressbuch_kontakt"."funktion" is null or char_length("adressbuch_kontakt"."funktion") between 1 and 100) and ("adressbuch_kontakt"."gruppe" is null or char_length("adressbuch_kontakt"."gruppe") between 1 and 100) and ("adressbuch_kontakt"."telefon" is null or "adressbuch_kontakt"."telefon" ~ '^\+?[0-9][0-9 ()/.-]{4,28}[0-9]$') and ("adressbuch_kontakt"."email" is null or (char_length("adressbuch_kontakt"."email") <= 254 and "adressbuch_kontakt"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+$')) and ("adressbuch_kontakt"."notiz" is null or char_length("adressbuch_kontakt"."notiz") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "adressbuch_kontakt" ADD CONSTRAINT "adressbuch_kontakt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adressbuch_kontakt" ADD CONSTRAINT "adressbuch_kontakt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adressbuch_kontakt" ADD CONSTRAINT "adressbuch_kontakt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adressbuch_kontakt" ADD CONSTRAINT "adressbuch_kontakt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adressbuch_kontakt_liste_idx" ON "adressbuch_kontakt" USING btree ("lager_id",lower("name"),"id");
