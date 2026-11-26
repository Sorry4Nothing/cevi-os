-- Seite eines Lagers auf der Website (#838): optional, entsteht nur über «Seite anlegen» in der Verwaltung. Wird die Seite gelöscht, wird die Verknüpfung leer. Je Seite höchstens ein Lager. Bestehende Lager bleiben ohne Seite.
-- Rückweg: drizzle/rueckweg/0168_lager_seite.sql
ALTER TABLE "lager" ADD COLUMN "seite_id" uuid;--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_seite_id_seite_id_fk" FOREIGN KEY ("seite_id") REFERENCES "public"."seite"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lager_seite_eindeutig" ON "lager" USING btree ("seite_id");
