-- Eingang des Lagers (#383): Tabelle eingang. Die Migration legt nur an; bestehende Daten ändert sie nicht.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0078_lager_eingang.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0078_lager_eingang.sql
--   Es gehen alle Meldungen, Antworten und Zuordnungen des Eingangs verloren. Die Tabelle steht nicht im Änderungsfeed (lager_aenderung), es bleiben keine Einträge zurück.
CREATE TABLE "eingang" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lager_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"art" text NOT NULL,
	"text" text NOT NULL,
	"anonym" boolean NOT NULL,
	"person_id" uuid,
	"rueckfragecode_hash" text,
	"erstellt_tag" date DEFAULT current_date NOT NULL,
	"status" text DEFAULT 'neu' NOT NULL,
	"antwort" text,
	"beantwortet_tag" date,
	"ressort_id" uuid,
	"traktandum_id" uuid,
	CONSTRAINT "eingang_check" CHECK ("eingang"."art" in ('idee', 'wunsch', 'frage', 'feedback') and "eingang"."status" in ('neu', 'in_arbeit', 'erledigt') and char_length("eingang"."text") between 1 and 5000 and ("eingang"."antwort" is null or char_length("eingang"."antwort") between 1 and 5000) and ("eingang"."antwort" is null) = ("eingang"."beantwortet_tag" is null)),
	CONSTRAINT "eingang_anonym_check" CHECK (("eingang"."anonym" and "eingang"."person_id" is null and "eingang"."rueckfragecode_hash" is not null) or (not "eingang"."anonym" and "eingang"."person_id" is not null and "eingang"."rueckfragecode_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "eingang" ADD CONSTRAINT "eingang_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eingang" ADD CONSTRAINT "eingang_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eingang" ADD CONSTRAINT "eingang_ressort_fk" FOREIGN KEY ("lager_id","ressort_id") REFERENCES "public"."ressort"("lager_id","id") ON DELETE set null ("ressort_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eingang" ADD CONSTRAINT "eingang_traktandum_fk" FOREIGN KEY ("lager_id","traktandum_id") REFERENCES "public"."traktandum"("lager_id","id") ON DELETE set null ("traktandum_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eingang_liste_idx" ON "eingang" USING btree ("lager_id","erstellt_tag","id");--> statement-breakpoint
CREATE INDEX "eingang_person_idx" ON "eingang" USING btree ("lager_id","person_id") WHERE "eingang"."person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "eingang_code_uq" ON "eingang" USING btree ("rueckfragecode_hash") WHERE "eingang"."rueckfragecode_hash" is not null;
