-- Raumanfragen und Buchungen der Termine (#447): raum_buchung (Anfrage, Entscheid, Zeitraum). Bestätigte Buchungen eines Raums dürfen sich nicht überschneiden: Exclusion-Constraint auf (raum_id, Zeitbereich) nur für Status «bestaetigt». Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Voraussetzung: CREATE EXTENSION btree_gist (für raum_id mit = im GiST-Index) braucht das Recht CREATE auf der Datenbank. btree_gist ist seit PostgreSQL 13 eine vertrauenswürdige Erweiterung (trusted), wie pg_trgm in 0098: Der Besitzer der Datenbank (cevi_os_besitzer, die Migrationsrolle) legt sie ohne Superuser an; das Image postgres:18 bringt sie mit (contrib). Siehe docs/betrieb.md.
-- Rückweg: drizzle/rueckweg/0127_raum_buchung.sql
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "raum_buchung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"raum_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"beginn" timestamp with time zone NOT NULL,
	"ende" timestamp with time zone NOT NULL,
	"zweck" text NOT NULL,
	"status" text DEFAULT 'angefragt' NOT NULL,
	"entschieden_von" uuid,
	"entschieden_am" timestamp with time zone,
	"begruendung" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raum_buchung_status_check" CHECK ("raum_buchung"."status" in ('angefragt', 'bestaetigt', 'abgelehnt', 'storniert')),
	CONSTRAINT "raum_buchung_zeit_check" CHECK ("raum_buchung"."ende" > "raum_buchung"."beginn" and "raum_buchung"."ende" - "raum_buchung"."beginn" <= interval '14 days'),
	CONSTRAINT "raum_buchung_zweck_check" CHECK (char_length("raum_buchung"."zweck") between 1 and 200),
	CONSTRAINT "raum_buchung_begruendung_check" CHECK (char_length("raum_buchung"."begruendung") between 1 and 500),
	CONSTRAINT "raum_buchung_entscheid_check" CHECK ("raum_buchung"."status" not in ('bestaetigt', 'abgelehnt') or "raum_buchung"."entschieden_am" is not null),
	CONSTRAINT "raum_buchung_keine_ueberschneidung" EXCLUDE USING gist ("raum_id" WITH =, tstzrange("beginn", "ende") WITH &&) WHERE ("status" = 'bestaetigt')
);
--> statement-breakpoint
ALTER TABLE "raum_buchung" ADD CONSTRAINT "raum_buchung_raum_id_raum_id_fk" FOREIGN KEY ("raum_id") REFERENCES "public"."raum"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raum_buchung" ADD CONSTRAINT "raum_buchung_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raum_buchung" ADD CONSTRAINT "raum_buchung_entschieden_von_user_id_fk" FOREIGN KEY ("entschieden_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raum_buchung_user_idx" ON "raum_buchung" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "raum_buchung_offen_idx" ON "raum_buchung" USING btree ("raum_id","id") WHERE "raum_buchung"."status" = 'angefragt';--> statement-breakpoint
CREATE INDEX "raum_buchung_ende_idx" ON "raum_buchung" USING btree ("ende");
