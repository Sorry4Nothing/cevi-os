-- «Gesehen» an Pinnwand-Beiträgen (#520): pinnwand_gesehen hält je Beitrag und Person einmal fest, dass die Person den Beitrag geöffnet hat (Person und Zeitpunkt, kein Inhalt). Die Zeile geht mit dem Beitrag (CASCADE, auch beim endgültigen Löschen des Lagers) und mit dem Konto. Die Migration legt an; sie fasst keine bestehenden Zeilen an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0108_lager_pinnwand_gesehen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0108_lager_pinnwand_gesehen.sql
--   Es gehen alle «gesehen»-Einträge verloren.
CREATE TABLE "pinnwand_gesehen" (
	"lager_id" uuid NOT NULL,
	"beitrag_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"gesehen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pinnwand_gesehen_beitrag_id_person_id_pk" PRIMARY KEY("beitrag_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "pinnwand_gesehen" ADD CONSTRAINT "pinnwand_gesehen_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinnwand_gesehen" ADD CONSTRAINT "pinnwand_gesehen_beitrag_fk" FOREIGN KEY ("lager_id","beitrag_id") REFERENCES "public"."pinnwand_beitrag"("lager_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pinnwand_gesehen_person_idx" ON "pinnwand_gesehen" USING btree ("person_id");
