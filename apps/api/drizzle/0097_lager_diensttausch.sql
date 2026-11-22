-- Diensttausch im Lager (#389): diensttausch (Anfrage eines Mitglieds, eine eigene Schicht zu tauschen oder abzugeben; die Lagerleitung entscheidet, erst dann werden die Schichten umgebucht). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0097_lager_diensttausch.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0097_lager_diensttausch.sql
--   Es gehen alle Tauschanfragen verloren; bereits umgebuchte Schichten bleiben, wie sie sind. Einträge der Tabelle im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "diensttausch" (
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
	"von_person_id" uuid NOT NULL,
	"schicht_id" uuid NOT NULL,
	"mit_person_id" uuid,
	"mit_schicht_id" uuid,
	"notiz" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"entschieden_von" uuid,
	"entschieden_am" timestamp with time zone,
	CONSTRAINT "diensttausch_status_check" CHECK ("diensttausch"."status" in ('offen', 'angenommen', 'abgelehnt', 'zurueckgezogen') and ("diensttausch"."status" = 'offen') = ("diensttausch"."entschieden_am" is null)),
	CONSTRAINT "diensttausch_wunsch_check" CHECK (("diensttausch"."mit_schicht_id" is null or "diensttausch"."mit_person_id" is not null) and "diensttausch"."mit_person_id" is distinct from "diensttausch"."von_person_id" and "diensttausch"."mit_schicht_id" is distinct from "diensttausch"."schicht_id"),
	CONSTRAINT "diensttausch_notiz_check" CHECK ("diensttausch"."notiz" is null or char_length("diensttausch"."notiz") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_schicht_id_schicht_id_fk" FOREIGN KEY ("schicht_id") REFERENCES "public"."schicht"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_mit_schicht_id_schicht_id_fk" FOREIGN KEY ("mit_schicht_id") REFERENCES "public"."schicht"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_entschieden_von_user_id_fk" FOREIGN KEY ("entschieden_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_von_fk" FOREIGN KEY ("lager_id","von_person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diensttausch" ADD CONSTRAINT "diensttausch_mit_fk" FOREIGN KEY ("lager_id","mit_person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diensttausch_offen_uq" ON "diensttausch" USING btree ("lager_id","schicht_id") WHERE "diensttausch"."status" = 'offen' and "diensttausch"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "diensttausch_liste_idx" ON "diensttausch" USING btree ("lager_id","status","id");--> statement-breakpoint
CREATE INDEX "diensttausch_person_idx" ON "diensttausch" USING btree ("lager_id","von_person_id","id");
