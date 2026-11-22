-- Anmeldungen zu Anlässen (#443): anlass_anmeldung speichert je Person oder Kind nur die Antworten auf die Zusatzfelder und den Status. Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg: drizzle/rueckweg/0124_anlass_anmeldung.sql
CREATE TABLE "anlass_anmeldung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"anlass_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind_id" uuid,
	"antworten" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anlass_anmeldung_eindeutig" UNIQUE NULLS NOT DISTINCT("anlass_id","user_id","kind_id"),
	CONSTRAINT "anlass_anmeldung_status_check" CHECK ("anlass_anmeldung"."status" in ('angemeldet', 'abgemeldet'))
);
--> statement-breakpoint
ALTER TABLE "anlass_anmeldung" ADD CONSTRAINT "anlass_anmeldung_anlass_id_anlass_id_fk" FOREIGN KEY ("anlass_id") REFERENCES "public"."anlass"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass_anmeldung" ADD CONSTRAINT "anlass_anmeldung_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass_anmeldung" ADD CONSTRAINT "anlass_anmeldung_kind_id_kind_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."kind"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anlass_anmeldung_kind_eindeutig" ON "anlass_anmeldung" USING btree ("anlass_id","kind_id") WHERE "anlass_anmeldung"."kind_id" is not null;--> statement-breakpoint
CREATE INDEX "anlass_anmeldung_user_idx" ON "anlass_anmeldung" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "anlass_anmeldung_kind_idx" ON "anlass_anmeldung" USING btree ("kind_id");
