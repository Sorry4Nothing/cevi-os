-- Lager-Check (#377): lager_check_punkt (eigene Check-Punkte: Titel, erledigt, Reihenfolge). Die Prüfer des Checks rechnen bei Bedarf aus den Daten der anderen Module und speichern nichts. Die Migration legt an; sie fasst keine bestehenden Zeilen an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0104_lager_check.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0104_lager_check.sql
--   Es gehen alle eigenen Check-Punkte verloren. Einträge von lager_check_punkt im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "lager_check_punkt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" uuid,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" uuid,
	"lager_seq" bigint NOT NULL,
	"titel" text NOT NULL,
	"erledigt" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lager_check_punkt_check" CHECK (char_length("lager_check_punkt"."titel") between 1 and 200 and "lager_check_punkt"."reihenfolge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lager_check_punkt" ADD CONSTRAINT "lager_check_punkt_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_check_punkt" ADD CONSTRAINT "lager_check_punkt_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_check_punkt" ADD CONSTRAINT "lager_check_punkt_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lager_check_punkt_liste_idx" ON "lager_check_punkt" USING btree ("lager_id","reihenfolge","id");
