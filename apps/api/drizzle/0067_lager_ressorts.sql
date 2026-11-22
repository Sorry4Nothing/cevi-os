-- Ressorts des Lagers (#371): ressort, ressort_link, ressort_notiz und der Fremdschlüssel von lager_mitglied.ressort_id. Die Migration legt an; bestehende Zeilen von lager_mitglied haben ressort_id leer und bleiben gültig.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0067_lager_ressorts.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0067_lager_ressorts.sql
--   Es gehen alle Ressorts, Links und Notizen verloren; lager_mitglied.ressort_id wird geleert. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "ressort" (
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
	"kuerzel" text NOT NULL,
	"name" text NOT NULL,
	"leitung_person_id" uuid,
	"stv_person_id" uuid,
	"notiz" text,
	"parent_id" uuid,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ressort_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "ressort_eltern_check" CHECK ("ressort"."parent_id" is distinct from "ressort"."id"),
	CONSTRAINT "ressort_text_check" CHECK (char_length("ressort"."kuerzel") between 1 and 20 and char_length("ressort"."name") between 1 and 100 and ("ressort"."notiz" is null or char_length("ressort"."notiz") <= 5000) and "ressort"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ressort_link" (
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
	"ressort_id" uuid NOT NULL,
	"titel" text NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "ressort_link_check" CHECK (char_length("ressort_link"."titel") between 1 and 200 and char_length("ressort_link"."url") <= 2000 and "ressort_link"."url" ~ '^https://[^[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "ressort_notiz" (
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
	"ressort_id" uuid NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "ressort_notiz_check" CHECK (char_length("ressort_notiz"."text") between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_leitung_person_id_user_id_fk" FOREIGN KEY ("leitung_person_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_stv_person_id_user_id_fk" FOREIGN KEY ("stv_person_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort" ADD CONSTRAINT "ressort_parent_fk" FOREIGN KEY ("lager_id","parent_id") REFERENCES "public"."ressort"("lager_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_link" ADD CONSTRAINT "ressort_link_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_link" ADD CONSTRAINT "ressort_link_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_link" ADD CONSTRAINT "ressort_link_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_link" ADD CONSTRAINT "ressort_link_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_link" ADD CONSTRAINT "ressort_link_ressort_fk" FOREIGN KEY ("lager_id","ressort_id") REFERENCES "public"."ressort"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_notiz" ADD CONSTRAINT "ressort_notiz_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_notiz" ADD CONSTRAINT "ressort_notiz_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_notiz" ADD CONSTRAINT "ressort_notiz_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_notiz" ADD CONSTRAINT "ressort_notiz_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ressort_notiz" ADD CONSTRAINT "ressort_notiz_ressort_fk" FOREIGN KEY ("lager_id","ressort_id") REFERENCES "public"."ressort"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_mitglied" ADD CONSTRAINT "lager_mitglied_ressort_fk" FOREIGN KEY ("lager_id","ressort_id") REFERENCES "public"."ressort"("lager_id","id") ON DELETE set null ("ressort_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ressort_liste_idx" ON "ressort" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "ressort_parent_idx" ON "ressort" USING btree ("lager_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ressort_kuerzel_uq" ON "ressort" USING btree ("lager_id",lower("kuerzel")) WHERE "ressort"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "ressort_link_liste_idx" ON "ressort_link" USING btree ("lager_id","ressort_id","id");--> statement-breakpoint
CREATE INDEX "ressort_notiz_liste_idx" ON "ressort_notiz" USING btree ("lager_id","ressort_id","id");
