-- Aufgaben des Lagers (#372): aufgabe und aufgabe_unterstuetzung. Die Migration legt nur an; sie ändert keine bestehende Tabelle.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0068_lager_aufgaben.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0068_lager_aufgaben.sql
--   Es gehen alle Aufgaben und ihre Unterstützung verloren. Einträge der Tabelle im Änderungsfeed (lager_aenderung) und Benachrichtigungen (lager_benachrichtigung) bleiben stehen und laufen mit dem Aufräumen aus.
CREATE TABLE "aufgabe" (
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
	"ressort_id" uuid,
	"teil" text,
	"verantwortlich_person_id" uuid,
	"status" text DEFAULT 'offen' NOT NULL,
	"notiz" text,
	"frist" date,
	"stern" boolean DEFAULT false NOT NULL,
	"laufend" boolean DEFAULT false NOT NULL,
	"spaeter_ab" date,
	"wiederholung" text,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"quelle" text,
	"erledigt_am" timestamp with time zone,
	"frist_erinnert_am" timestamp with time zone,
	CONSTRAINT "aufgabe_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "aufgabe_status_check" CHECK ("aufgabe"."status" in ('offen', 'laeuft', 'wartet', 'erledigt', 'naechster_hoeck')),
	CONSTRAINT "aufgabe_wiederholung_check" CHECK ("aufgabe"."wiederholung" is null or "aufgabe"."wiederholung" in ('w1', 'w2', 'm1')),
	CONSTRAINT "aufgabe_erledigt_check" CHECK (("aufgabe"."status" = 'erledigt') = ("aufgabe"."erledigt_am" is not null)),
	CONSTRAINT "aufgabe_text_check" CHECK (char_length("aufgabe"."titel") between 1 and 200 and ("aufgabe"."teil" is null or char_length("aufgabe"."teil") between 1 and 100) and ("aufgabe"."notiz" is null or char_length("aufgabe"."notiz") <= 5000) and ("aufgabe"."quelle" is null or char_length("aufgabe"."quelle") between 1 and 100) and "aufgabe"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "aufgabe_unterstuetzung" (
	"lager_id" uuid NOT NULL,
	"aufgabe_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "aufgabe_unterstuetzung_aufgabe_id_person_id_pk" PRIMARY KEY("aufgabe_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_ressort_fk" FOREIGN KEY ("lager_id","ressort_id") REFERENCES "public"."ressort"("lager_id","id") ON DELETE set null ("ressort_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe" ADD CONSTRAINT "aufgabe_verantwortlich_fk" FOREIGN KEY ("lager_id","verantwortlich_person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE set null ("verantwortlich_person_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_unterstuetzung" ADD CONSTRAINT "aufgabe_unterstuetzung_aufgabe_fk" FOREIGN KEY ("lager_id","aufgabe_id") REFERENCES "public"."aufgabe"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aufgabe_unterstuetzung" ADD CONSTRAINT "aufgabe_unterstuetzung_mitglied_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aufgabe_liste_idx" ON "aufgabe" USING btree ("lager_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "aufgabe_person_idx" ON "aufgabe" USING btree ("lager_id","verantwortlich_person_id");--> statement-breakpoint
CREATE INDEX "aufgabe_status_idx" ON "aufgabe" USING btree ("lager_id","status");--> statement-breakpoint
CREATE INDEX "aufgabe_ressort_idx" ON "aufgabe" USING btree ("lager_id","ressort_id");--> statement-breakpoint
CREATE INDEX "aufgabe_frist_idx" ON "aufgabe" USING btree ("lager_id","frist") WHERE "aufgabe"."frist" is not null;--> statement-breakpoint
CREATE INDEX "aufgabe_unterstuetzung_person_idx" ON "aufgabe_unterstuetzung" USING btree ("lager_id","person_id");
