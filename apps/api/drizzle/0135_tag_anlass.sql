-- Neuer Gruppentyp «anlass» (#626): eine Gruppe, die zu einem Anlass der Abteilung gehört (zum Beispiel das OK). Der Typ vergibt keine Rechte.
-- anlass_id ist nur bei Typ «anlass» gesetzt und leer, wenn der Anlass gelöscht wird (SET NULL: die Gruppe und ihre Mitglieder bleiben). Höchstens eine Gruppe je Anlass.
-- Rückweg: drizzle/rueckweg/0135_tag_anlass.sql
ALTER TABLE "tag" ADD COLUMN "anlass_id" uuid;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_anlass_id_anlass_id_fk" FOREIGN KEY ("anlass_id") REFERENCES "public"."anlass"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" DROP CONSTRAINT "tag_typ_check";--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_typ_check" CHECK ("tag"."typ" in ('stufe', 'funktion', 'team', 'lager', 'anlass'));--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_anlass_check" CHECK ("tag"."typ" = 'anlass' or "tag"."anlass_id" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "tag_anlass_eindeutig" ON "tag" USING btree ("anlass_id") WHERE "tag"."anlass_id" is not null;
