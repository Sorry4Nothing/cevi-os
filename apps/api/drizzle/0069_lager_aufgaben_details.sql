-- Aufgaben-Details des Lagers (#373): aufgabe_checkpunkt, aufgabe_link und aufgabe_stichwort. Die Migration legt nur an; sie ändert keine bestehende Tabelle.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0069_lager_aufgaben_details.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0069_lager_aufgaben_details.sql
--   Es gehen alle Checkpunkte, Links und Stichworte der Aufgaben verloren. Einträge der Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen aus.
CREATE TABLE "aufgabe_checkpunkt" (
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
	"aufgabe_id" uuid NOT NULL,
	"text" text NOT NULL,
	"erledigt" boolean DEFAULT false NOT NULL,
	"person_id" uuid,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "aufgabe_checkpunkt_check" CHECK (char_length("aufgabe_checkpunkt"."text") between 1 and 500 and "aufgabe_checkpunkt"."reihenfolge" >= 0 and ("aufgabe_checkpunkt"."erledigt" or "aufgabe_checkpunkt"."person_id" is null))
);
--> statement-breakpoint
CREATE TABLE "aufgabe_link" (
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
	"aufgabe_id" uuid NOT NULL,
	"titel" text NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "aufgabe_link_check" CHECK (char_length("aufgabe_link"."titel") between 1 and 200 and char_length("aufgabe_link"."url") <= 2000 and "aufgabe_link"."url" ~ '^https://[^[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "aufgabe_stichwort" (
	"lager_id" uuid NOT NULL,
	"aufgabe_id" uuid NOT NULL,
	"stichwort" text NOT NULL,
	CONSTRAINT "aufgabe_stichwort_check" CHECK (char_length("aufgabe_stichwort"."stichwort") between 1 and 40 and "aufgabe_stichwort"."stichwort" = btrim("aufgabe_stichwort"."stichwort"))
);
--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" ADD CONSTRAINT "aufgabe_checkpunkt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" ADD CONSTRAINT "aufgabe_checkpunkt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" ADD CONSTRAINT "aufgabe_checkpunkt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" ADD CONSTRAINT "aufgabe_checkpunkt_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" ADD CONSTRAINT "aufgabe_checkpunkt_aufgabe_fk" FOREIGN KEY ("lager_id","aufgabe_id") REFERENCES "public"."aufgabe"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" ADD CONSTRAINT "aufgabe_checkpunkt_person_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE set null ("person_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_link" ADD CONSTRAINT "aufgabe_link_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_link" ADD CONSTRAINT "aufgabe_link_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_link" ADD CONSTRAINT "aufgabe_link_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_link" ADD CONSTRAINT "aufgabe_link_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_link" ADD CONSTRAINT "aufgabe_link_aufgabe_fk" FOREIGN KEY ("lager_id","aufgabe_id") REFERENCES "public"."aufgabe"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_stichwort" ADD CONSTRAINT "aufgabe_stichwort_aufgabe_fk" FOREIGN KEY ("lager_id","aufgabe_id") REFERENCES "public"."aufgabe"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aufgabe_checkpunkt_liste_idx" ON "aufgabe_checkpunkt" USING btree ("lager_id","aufgabe_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "aufgabe_link_liste_idx" ON "aufgabe_link" USING btree ("lager_id","aufgabe_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "aufgabe_stichwort_uq" ON "aufgabe_stichwort" USING btree ("aufgabe_id",lower("stichwort"));--> statement-breakpoint
CREATE INDEX "aufgabe_stichwort_suche_idx" ON "aufgabe_stichwort" USING btree ("lager_id",lower("stichwort"));
