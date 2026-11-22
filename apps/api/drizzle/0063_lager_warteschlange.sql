-- Warteschlange für Offline-Änderungen des Lagers (#367): Ergebnis je clientOpId, damit eine Wiederholung nichts doppelt schreibt. Die Migration legt nur an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0063_lager_warteschlange.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0063_lager_warteschlange.sql
--   Es gehen die gespeicherten Ergebnisse verloren; eine wiederholte Operation würde danach noch einmal ausgeführt.
CREATE TABLE "lager_client_op" (
	"lager_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"client_op_id" uuid NOT NULL,
	"ergebnis" jsonb,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lager_client_op_lager_id_person_id_client_op_id_pk" PRIMARY KEY("lager_id","person_id","client_op_id")
);
--> statement-breakpoint
ALTER TABLE "lager_client_op" ADD CONSTRAINT "lager_client_op_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lager_client_op" ADD CONSTRAINT "lager_client_op_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lager_client_op_erstellt_am_idx" ON "lager_client_op" USING btree ("erstellt_am");
