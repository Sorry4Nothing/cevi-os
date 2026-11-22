-- Einkaufsliste des Lagers (#392): einkauf_artikel (mit Zeilenversion und Feed wie die anderen Lager-Tabellen), einkauf_artikelstamm (Warengruppe, die die Lagerleitung für einen Artikel festgelegt hat) und einkauf_vorschlag (wie oft ein Artikel angelegt wurde). Die Migration fasst keine bestehenden Zeilen an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0087_lager_einkauf.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0087_lager_einkauf.sql
--   Es gehen alle Einkaufsartikel, der Artikelstamm und die Vorschläge verloren. Einträge der Tabelle im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "einkauf_artikel" (
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
	"name_norm" text NOT NULL,
	"menge" numeric(12, 3),
	"einheit" text,
	"warengruppe" text NOT NULL,
	"einkaeufer_person_id" uuid,
	"erledigt" boolean DEFAULT false NOT NULL,
	CONSTRAINT "einkauf_artikel_check" CHECK (char_length("einkauf_artikel"."name") between 1 and 100 and char_length("einkauf_artikel"."name_norm") between 1 and 200 and ("einkauf_artikel"."menge" is null or "einkauf_artikel"."menge" > 0) and ("einkauf_artikel"."einheit" is null or char_length("einkauf_artikel"."einheit") between 1 and 20) and "einkauf_artikel"."warengruppe" in ('obst_gemuese', 'brot', 'milch_kaese', 'fleisch_fisch', 'vorrat', 'getraenke', 'haushalt', 'diverses'))
);
--> statement-breakpoint
CREATE TABLE "einkauf_artikelstamm" (
	"lager_id" uuid NOT NULL,
	"name_norm" text NOT NULL,
	"warengruppe" text NOT NULL,
	CONSTRAINT "einkauf_artikelstamm_lager_id_name_norm_pk" PRIMARY KEY("lager_id","name_norm"),
	CONSTRAINT "einkauf_artikelstamm_check" CHECK (char_length("einkauf_artikelstamm"."name_norm") between 1 and 200 and "einkauf_artikelstamm"."warengruppe" in ('obst_gemuese', 'brot', 'milch_kaese', 'fleisch_fisch', 'vorrat', 'getraenke', 'haushalt', 'diverses'))
);
--> statement-breakpoint
CREATE TABLE "einkauf_vorschlag" (
	"lager_id" uuid NOT NULL,
	"name_norm" text NOT NULL,
	"name" text NOT NULL,
	"haeufigkeit" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "einkauf_vorschlag_lager_id_name_norm_pk" PRIMARY KEY("lager_id","name_norm"),
	CONSTRAINT "einkauf_vorschlag_check" CHECK (char_length("einkauf_vorschlag"."name") between 1 and 100 and char_length("einkauf_vorschlag"."name_norm") between 1 and 200 and "einkauf_vorschlag"."haeufigkeit" >= 1)
);
--> statement-breakpoint
ALTER TABLE "einkauf_artikel" ADD CONSTRAINT "einkauf_artikel_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einkauf_artikel" ADD CONSTRAINT "einkauf_artikel_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einkauf_artikel" ADD CONSTRAINT "einkauf_artikel_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einkauf_artikel" ADD CONSTRAINT "einkauf_artikel_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einkauf_artikel" ADD CONSTRAINT "einkauf_artikel_einkaeufer_fk" FOREIGN KEY ("lager_id","einkaeufer_person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE set null ("einkaeufer_person_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einkauf_artikelstamm" ADD CONSTRAINT "einkauf_artikelstamm_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einkauf_vorschlag" ADD CONSTRAINT "einkauf_vorschlag_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "einkauf_artikel_liste_idx" ON "einkauf_artikel" USING btree ("lager_id","id") WHERE "einkauf_artikel"."geloescht_am" is null;
