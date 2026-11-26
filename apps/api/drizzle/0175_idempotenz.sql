-- Idempotenz-Schlüssel der Direktanlagen der Apps (#873): je Person, Methode mit Pfad und Schlüssel der Hash des Körpers und die erste Antwort 2xx. Neue, leere Tabelle; bestehende Daten ändern sich nicht. 0174 ist für den parallelen PR #868 frei gehalten.
-- Rückweg: drizzle/rueckweg/0175_idempotenz.sql
CREATE TABLE "idempotenz" (
	"person_id" uuid NOT NULL,
	"route" text NOT NULL,
	"schluessel" text NOT NULL,
	"hash" text NOT NULL,
	"status" smallint,
	"antwort" jsonb,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotenz_person_id_route_schluessel_pk" PRIMARY KEY("person_id","route","schluessel")
);
--> statement-breakpoint
ALTER TABLE "idempotenz" ADD CONSTRAINT "idempotenz_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotenz_erstellt_am_idx" ON "idempotenz" USING btree ("erstellt_am");
