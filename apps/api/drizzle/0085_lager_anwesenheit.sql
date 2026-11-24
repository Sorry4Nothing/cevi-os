-- Anwesenheit im Lager (#390): anwesenheit (eine Zeile je Person oder Teilnehmende und Abschnitt eines Lagertags, nur A und F), anwesenheit_anfrage (Anfragen des Teams) und lager.anwesenheit_frist (bis wann das Team direkt einträgt). Lagertag, Abschnitt (#374) und Teilnehmende (#384) haben keinen Fremdschlüssel, bis diese Tabellen im Schema stehen. Die Migration legt an; bestehende Lager haben keine Frist.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0085_lager_anwesenheit.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0085_lager_anwesenheit.sql
--   Es gehen alle Anwesenheiten und Anfragen verloren sowie die Frist; Einträge dieser Tabellen im Änderungsfeed (lager_aenderung) bleiben stehen und laufen mit dem Aufräumen nach 30 Tagen aus.
ALTER TABLE "lager" ADD COLUMN "anwesenheit_frist" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "anwesenheit" (
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
	"person_id" uuid,
	"teilnehmer_id" uuid,
	"lagertag_id" uuid NOT NULL,
	"tagesabschnitt_id" uuid NOT NULL,
	"wert" text NOT NULL,
	CONSTRAINT "anwesenheit_wert_check" CHECK ("anwesenheit"."wert" in ('A', 'F', 'O')),
	CONSTRAINT "anwesenheit_anwesende_check" CHECK (num_nonnulls("anwesenheit"."person_id", "anwesenheit"."teilnehmer_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "anwesenheit_anfrage" (
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
	"person_id" uuid NOT NULL,
	"lagertag_id" uuid NOT NULL,
	"tagesabschnitt_id" uuid NOT NULL,
	"wert" text NOT NULL,
	"notiz" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"entschieden_von" uuid,
	"entschieden_am" timestamp with time zone,
	CONSTRAINT "anwesenheit_anfrage_wert_check" CHECK ("anwesenheit_anfrage"."wert" in ('A', 'F', 'O')),
	CONSTRAINT "anwesenheit_anfrage_status_check" CHECK ("anwesenheit_anfrage"."status" in ('offen', 'angenommen', 'abgelehnt') and ("anwesenheit_anfrage"."status" = 'offen') = ("anwesenheit_anfrage"."entschieden_am" is null)),
	CONSTRAINT "anwesenheit_anfrage_notiz_check" CHECK ("anwesenheit_anfrage"."notiz" is null or char_length("anwesenheit_anfrage"."notiz") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "anwesenheit" ADD CONSTRAINT "anwesenheit_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit" ADD CONSTRAINT "anwesenheit_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit" ADD CONSTRAINT "anwesenheit_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit" ADD CONSTRAINT "anwesenheit_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit" ADD CONSTRAINT "anwesenheit_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" ADD CONSTRAINT "anwesenheit_anfrage_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" ADD CONSTRAINT "anwesenheit_anfrage_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" ADD CONSTRAINT "anwesenheit_anfrage_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" ADD CONSTRAINT "anwesenheit_anfrage_geloescht_von_user_id_fk" FOREIGN KEY ("geloescht_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" ADD CONSTRAINT "anwesenheit_anfrage_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" ADD CONSTRAINT "anwesenheit_anfrage_entschieden_von_user_id_fk" FOREIGN KEY ("entschieden_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anwesenheit_person_uq" ON "anwesenheit" USING btree ("lager_id","person_id","lagertag_id","tagesabschnitt_id") WHERE "anwesenheit"."person_id" is not null and "anwesenheit"."geloescht_am" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "anwesenheit_teilnehmer_uq" ON "anwesenheit" USING btree ("lager_id","teilnehmer_id","lagertag_id","tagesabschnitt_id") WHERE "anwesenheit"."teilnehmer_id" is not null and "anwesenheit"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "anwesenheit_tag_idx" ON "anwesenheit" USING btree ("lager_id","lagertag_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "anwesenheit_anfrage_offen_uq" ON "anwesenheit_anfrage" USING btree ("lager_id","person_id","lagertag_id","tagesabschnitt_id") WHERE "anwesenheit_anfrage"."status" = 'offen' and "anwesenheit_anfrage"."geloescht_am" is null;--> statement-breakpoint
CREATE INDEX "anwesenheit_anfrage_liste_idx" ON "anwesenheit_anfrage" USING btree ("lager_id","status","id");--> statement-breakpoint
CREATE INDEX "anwesenheit_anfrage_person_idx" ON "anwesenheit_anfrage" USING btree ("lager_id","person_id","id");
