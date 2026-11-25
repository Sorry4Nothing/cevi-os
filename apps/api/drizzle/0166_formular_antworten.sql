-- Antworten auf den Baustein «Formular» der Website (#819). Die Definition des Formulars bleibt im Dokument der Seite; die Tabelle nimmt nur die Antworten auf, je Antwort mit der Version der Seite, mit der sie entstand.
-- Mit dem Konto verschwindet nur die Zuordnung (ON DELETE SET NULL), die Antwort bleibt anonym. Fällt die Seite weg, fallen ihre Antworten mit (CASCADE).
-- Rückweg: drizzle/rueckweg/0166_formular_antworten.sql
CREATE TABLE "formular_antwort" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"seite_id" uuid NOT NULL,
	"formular_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid,
	"antworten" jsonb NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"loeschen_am" timestamp with time zone NOT NULL,
	CONSTRAINT "formular_antwort_antworten_check" CHECK (jsonb_typeof("formular_antwort"."antworten") = 'object' and octet_length("formular_antwort"."antworten"::text) <= 20000)
);
--> statement-breakpoint
ALTER TABLE "formular_antwort" ADD CONSTRAINT "formular_antwort_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formular_antwort" ADD CONSTRAINT "formular_antwort_seite_id_seite_id_fk" FOREIGN KEY ("seite_id") REFERENCES "public"."seite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formular_antwort" ADD CONSTRAINT "formular_antwort_version_id_seite_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."seite_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formular_antwort" ADD CONSTRAINT "formular_antwort_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "formular_antwort_formular_idx" ON "formular_antwort" USING btree ("formular_id","id");--> statement-breakpoint
CREATE INDEX "formular_antwort_abteilung_idx" ON "formular_antwort" USING btree ("abteilung_id");--> statement-breakpoint
CREATE INDEX "formular_antwort_seite_idx" ON "formular_antwort" USING btree ("seite_id");--> statement-breakpoint
CREATE INDEX "formular_antwort_user_idx" ON "formular_antwort" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "formular_antwort_loeschen_idx" ON "formular_antwort" USING btree ("loeschen_am");
