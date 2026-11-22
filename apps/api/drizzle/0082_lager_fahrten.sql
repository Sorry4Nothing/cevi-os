-- Fahrten des Lagers (#386): fahrt (Hin- und Rückfahrt, Auto oder ÖV-Gruppe, mit Kartenpunkt) und fahrt_mitfahrer (eine Zeile je Person oder Teilnehmenden). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0082_lager_fahrten.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0082_lager_fahrten.sql
--   Es gehen alle Fahrten und Mitfahrten verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "fahrt" (
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
	"richtung" text NOT NULL,
	"art" text NOT NULL,
	"name" text,
	"fahrer_person_id" uuid,
	"plaetze" integer,
	"datum" date,
	"zeit" text,
	"von" text,
	"nach" text,
	"treffpunkt" text,
	"link" text,
	"ziel_bezeichnung" text,
	"ziel_adresse" text,
	"ziel_lat" double precision,
	"ziel_lon" double precision,
	"ziel_link" text,
	CONSTRAINT "fahrt_lager_id_id_richtung_uq" UNIQUE("lager_id","id","richtung"),
	CONSTRAINT "fahrt_richtung_art_check" CHECK ("fahrt"."richtung" in ('hin', 'rueck') and "fahrt"."art" in ('auto', 'oev')),
	CONSTRAINT "fahrt_art_check" CHECK (("fahrt"."art" = 'auto' and "fahrt"."plaetze" is not null and "fahrt"."plaetze" between 1 and 99 and "fahrt"."link" is null) or ("fahrt"."art" = 'oev' and "fahrt"."plaetze" is null and "fahrt"."fahrer_person_id" is null)),
	CONSTRAINT "fahrt_text_check" CHECK (("fahrt"."name" is null or char_length("fahrt"."name") between 1 and 100) and ("fahrt"."von" is null or char_length("fahrt"."von") between 1 and 200) and ("fahrt"."nach" is null or char_length("fahrt"."nach") between 1 and 200) and ("fahrt"."treffpunkt" is null or char_length("fahrt"."treffpunkt") between 1 and 200) and ("fahrt"."zeit" is null or "fahrt"."zeit" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
	CONSTRAINT "fahrt_link_check" CHECK (("fahrt"."link" is null or ("fahrt"."link" ~ '^https://[^[:space:]]+$' and strpos("fahrt"."link", chr(92)) = 0 and char_length("fahrt"."link") <= 2048)) and ("fahrt"."ziel_link" is null or ("fahrt"."ziel_link" ~ '^https://[^[:space:]]+$' and strpos("fahrt"."ziel_link", chr(92)) = 0 and char_length("fahrt"."ziel_link") <= 2048))),
	CONSTRAINT "fahrt_ziel_check" CHECK (("fahrt"."ziel_bezeichnung" is null or char_length("fahrt"."ziel_bezeichnung") between 1 and 100) and ("fahrt"."ziel_adresse" is null or char_length("fahrt"."ziel_adresse") between 1 and 200) and (("fahrt"."ziel_lat" is null) = ("fahrt"."ziel_lon" is null)) and ("fahrt"."ziel_lat" is null or ("fahrt"."ziel_lat" between -90 and 90 and "fahrt"."ziel_lon" between -180 and 180)) and (("fahrt"."ziel_bezeichnung" is null and "fahrt"."ziel_adresse" is null and "fahrt"."ziel_lat" is null and "fahrt"."ziel_link" is null) or ("fahrt"."ziel_bezeichnung" is not null and ("fahrt"."ziel_adresse" is not null or "fahrt"."ziel_lat" is not null or "fahrt"."ziel_link" is not null))))
);
--> statement-breakpoint
CREATE TABLE "fahrt_mitfahrer" (
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
	"fahrt_id" uuid NOT NULL,
	"richtung" text NOT NULL,
	"person_id" uuid,
	"teilnehmer_id" uuid,
	CONSTRAINT "fahrt_mitfahrer_check" CHECK ("fahrt_mitfahrer"."richtung" in ('hin', 'rueck') and num_nonnulls("fahrt_mitfahrer"."person_id", "fahrt_mitfahrer"."teilnehmer_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "fahrt" ADD CONSTRAINT "fahrt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt" ADD CONSTRAINT "fahrt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt" ADD CONSTRAINT "fahrt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt" ADD CONSTRAINT "fahrt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt" ADD CONSTRAINT "fahrt_fahrer_fk" FOREIGN KEY ("lager_id","fahrer_person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE set null ("fahrer_person_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_fahrt_fk" FOREIGN KEY ("lager_id","fahrt_id","richtung") REFERENCES "public"."fahrt"("lager_id","id","richtung") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_person_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" ADD CONSTRAINT "fahrt_mitfahrer_teilnehmer_fk" FOREIGN KEY ("lager_id","teilnehmer_id") REFERENCES "public"."teilnehmer"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fahrt_fahrer_uq" ON "fahrt" USING btree ("lager_id","richtung","fahrer_person_id") WHERE "fahrt"."fahrer_person_id" is not null and "fahrt"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "fahrt_liste_idx" ON "fahrt" USING btree ("lager_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fahrt_mitfahrer_person_uq" ON "fahrt_mitfahrer" USING btree ("lager_id","richtung","person_id") WHERE "fahrt_mitfahrer"."person_id" is not null and "fahrt_mitfahrer"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fahrt_mitfahrer_teilnehmer_uq" ON "fahrt_mitfahrer" USING btree ("lager_id","richtung","teilnehmer_id") WHERE "fahrt_mitfahrer"."teilnehmer_id" is not null and "fahrt_mitfahrer"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "fahrt_mitfahrer_fahrt_idx" ON "fahrt_mitfahrer" USING btree ("lager_id","fahrt_id");
