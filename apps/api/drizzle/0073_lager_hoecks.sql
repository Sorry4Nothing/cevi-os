-- Höcks, Traktanden und Anwesenheit des Lagers (#378): hoeck, hoeck_anwesenheit, traktandum und traktandum_verantwortlich. Die Migration legt nur an; sie ändert keine bestehende Tabelle.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0073_lager_hoecks.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0073_lager_hoecks.sql
--   Es gehen alle Höcks, Traktanden (mit Entscheiden), Anwesenheiten und Verantwortlichen verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen aus.
CREATE TABLE "hoeck" (
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
	"art" text NOT NULL,
	"datum" date NOT NULL,
	"zeit" text,
	"titel" text NOT NULL,
	"ort" text,
	"gaeste" text,
	"protokoll_id" uuid,
	CONSTRAINT "hoeck_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "hoeck_art_check" CHECK ("hoeck"."art" in ('lagerleitung', 'team')),
	CONSTRAINT "hoeck_text_check" CHECK (char_length("hoeck"."titel") between 1 and 200 and ("hoeck"."zeit" is null or "hoeck"."zeit" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and ("hoeck"."ort" is null or char_length("hoeck"."ort") between 1 and 200) and ("hoeck"."gaeste" is null or char_length("hoeck"."gaeste") between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "hoeck_anwesenheit" (
	"lager_id" uuid NOT NULL,
	"hoeck_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "hoeck_anwesenheit_hoeck_id_person_id_pk" PRIMARY KEY("hoeck_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "traktandum" (
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
	"hoeck_id" uuid,
	"titel" text NOT NULL,
	"text" text,
	"entscheid" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"aufgabe_id" uuid,
	"status" text DEFAULT 'offen' NOT NULL,
	CONSTRAINT "traktandum_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "traktandum_status_check" CHECK ("traktandum"."status" in ('offen', 'besprochen')),
	CONSTRAINT "traktandum_text_check" CHECK (char_length("traktandum"."titel") between 1 and 200 and ("traktandum"."text" is null or char_length("traktandum"."text") <= 5000) and ("traktandum"."entscheid" is null or char_length("traktandum"."entscheid") between 1 and 1000) and "traktandum"."reihenfolge" >= 0 and jsonb_typeof("traktandum"."links") = 'array' and jsonb_array_length("traktandum"."links") <= 10)
);
--> statement-breakpoint
CREATE TABLE "traktandum_verantwortlich" (
	"lager_id" uuid NOT NULL,
	"traktandum_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "traktandum_verantwortlich_traktandum_id_person_id_pk" PRIMARY KEY("traktandum_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "hoeck" ADD CONSTRAINT "hoeck_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hoeck" ADD CONSTRAINT "hoeck_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hoeck" ADD CONSTRAINT "hoeck_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hoeck" ADD CONSTRAINT "hoeck_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hoeck_anwesenheit" ADD CONSTRAINT "hoeck_anwesenheit_hoeck_fk" FOREIGN KEY ("lager_id","hoeck_id") REFERENCES "public"."hoeck"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hoeck_anwesenheit" ADD CONSTRAINT "hoeck_anwesenheit_mitglied_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_hoeck_fk" FOREIGN KEY ("lager_id","hoeck_id") REFERENCES "public"."hoeck"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum" ADD CONSTRAINT "traktandum_aufgabe_fk" FOREIGN KEY ("lager_id","aufgabe_id") REFERENCES "public"."aufgabe"("lager_id","id") ON DELETE set null ("aufgabe_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum_verantwortlich" ADD CONSTRAINT "traktandum_verantwortlich_traktandum_fk" FOREIGN KEY ("lager_id","traktandum_id") REFERENCES "public"."traktandum"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traktandum_verantwortlich" ADD CONSTRAINT "traktandum_verantwortlich_mitglied_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hoeck_liste_idx" ON "hoeck" USING btree ("lager_id","datum","id");--> statement-breakpoint
CREATE INDEX "hoeck_anwesenheit_person_idx" ON "hoeck_anwesenheit" USING btree ("lager_id","person_id");--> statement-breakpoint
CREATE INDEX "traktandum_liste_idx" ON "traktandum" USING btree ("lager_id","hoeck_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "traktandum_aufgabe_idx" ON "traktandum" USING btree ("lager_id","aufgabe_id") WHERE "traktandum"."aufgabe_id" is not null;--> statement-breakpoint
CREATE INDEX "traktandum_verantwortlich_person_idx" ON "traktandum_verantwortlich" USING btree ("lager_id","person_id");
