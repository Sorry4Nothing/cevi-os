-- Teilnehmende und Abzählen des Lagers (#384): teilnehmer (nur Name, Cevi-Name und Stufe) und abzaehlen (ein Haken je Teilnehmende oder Person). Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0079_lager_teilnehmer.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0079_lager_teilnehmer.sql
--   Es gehen alle Teilnehmenden und alle Haken verloren. Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
CREATE TABLE "teilnehmer" (
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
	"kind_id" uuid,
	"anmeldung_id" uuid,
	"vorname" text NOT NULL,
	"nachname" text NOT NULL,
	"cevi_name" text,
	"stufe" text,
	CONSTRAINT "teilnehmer_lager_id_id_uq" UNIQUE("lager_id","id"),
	CONSTRAINT "teilnehmer_text_check" CHECK (char_length("teilnehmer"."vorname") between 1 and 100 and char_length("teilnehmer"."nachname") between 1 and 100 and ("teilnehmer"."cevi_name" is null or char_length("teilnehmer"."cevi_name") between 1 and 50) and ("teilnehmer"."stufe" is null or char_length("teilnehmer"."stufe") between 1 and 50))
);
--> statement-breakpoint
CREATE TABLE "abzaehlen" (
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
	"teilnehmer_id" uuid,
	"person_id" uuid,
	"geprueft" boolean DEFAULT false NOT NULL,
	"geprueft_am" timestamp with time zone,
	CONSTRAINT "abzaehlen_ziel_check" CHECK (("abzaehlen"."teilnehmer_id" is null) <> ("abzaehlen"."person_id" is null) and "abzaehlen"."geprueft" = ("abzaehlen"."geprueft_am" is not null))
);
--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_kind_id_kind_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."kind"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abzaehlen" ADD CONSTRAINT "abzaehlen_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abzaehlen" ADD CONSTRAINT "abzaehlen_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abzaehlen" ADD CONSTRAINT "abzaehlen_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abzaehlen" ADD CONSTRAINT "abzaehlen_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abzaehlen" ADD CONSTRAINT "abzaehlen_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abzaehlen" ADD CONSTRAINT "abzaehlen_teilnehmer_fk" FOREIGN KEY ("lager_id","teilnehmer_id") REFERENCES "public"."teilnehmer"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teilnehmer_liste_idx" ON "teilnehmer" USING btree ("lager_id","nachname","vorname","id");--> statement-breakpoint
CREATE UNIQUE INDEX "abzaehlen_teilnehmer_uq" ON "abzaehlen" USING btree ("lager_id","teilnehmer_id") WHERE "abzaehlen"."teilnehmer_id" is not null and "abzaehlen"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "abzaehlen_person_uq" ON "abzaehlen" USING btree ("lager_id","person_id") WHERE "abzaehlen"."person_id" is not null and "abzaehlen"."geloescht_am" is null;
