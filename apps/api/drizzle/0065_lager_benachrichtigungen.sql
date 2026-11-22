-- Benachrichtigungen des Lagers (#369). Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0065_lager_benachrichtigungen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0065_lager_benachrichtigungen.sql
--   Es gehen alle Benachrichtigungen und die Schalter der Personen verloren.
CREATE TABLE "lager_benachrichtigung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"art" text NOT NULL,
	"objekt_typ" text NOT NULL,
	"objekt_id" uuid NOT NULL,
	"gelesen_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lager_benachrichtigung_einstellung" (
	"person_id" uuid NOT NULL,
	"art" text NOT NULL,
	"aktiv" boolean NOT NULL,
	CONSTRAINT "lager_benachrichtigung_einstellung_person_id_art_pk" PRIMARY KEY("person_id","art")
);
--> statement-breakpoint
ALTER TABLE "lager_benachrichtigung" ADD CONSTRAINT "lager_benachrichtigung_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_benachrichtigung" ADD CONSTRAINT "lager_benachrichtigung_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_benachrichtigung_einstellung" ADD CONSTRAINT "lager_benachrichtigung_einstellung_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lager_benachrichtigung_liste_idx" ON "lager_benachrichtigung" USING btree ("person_id","lager_id","id");--> statement-breakpoint
CREATE INDEX "lager_benachrichtigung_objekt_idx" ON "lager_benachrichtigung" USING btree ("person_id","objekt_id");
