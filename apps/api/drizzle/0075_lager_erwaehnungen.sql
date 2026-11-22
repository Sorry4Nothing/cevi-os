-- Erwähnungen im Lager (#380): eine Zeile je erwähnter Person und Inhalt (Aufgabe, Traktandum, Pinnwand-Beitrag, Beschluss). Kein Text, kein Inhalt: Sie merkt sich, wer erwähnt wurde, ob die Person sie erledigt hat und welche Aufgabe daraus entstand. Die Migration legt an und fasst keine bestehende Tabelle an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0075_lager_erwaehnungen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0075_lager_erwaehnungen.sql
--   Es gehen alle Erwähnungen verloren (ob erledigt, welche Aufgabe daraus entstand); die Aufgaben bleiben, ihre Spalte quelle behält den Wert «erwaehnung:<id>» ohne Ziel. Benachrichtigungen der Art «erwaehnung» bleiben in der Glocke stehen.
CREATE TABLE "erwaehnung" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"quelle_typ" text NOT NULL,
	"quelle_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"erledigt_am" timestamp with time zone,
	"aufgabe_id" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erwaehnung_quelle_person_uq" UNIQUE("lager_id","quelle_typ","quelle_id","person_id"),
	CONSTRAINT "erwaehnung_quelle_check" CHECK ("erwaehnung"."quelle_typ" in ('aufgabe', 'traktandum', 'pinnwand', 'beschluss'))
);
--> statement-breakpoint
ALTER TABLE "erwaehnung" ADD CONSTRAINT "erwaehnung_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erwaehnung" ADD CONSTRAINT "erwaehnung_mitglied_fk" FOREIGN KEY ("lager_id","person_id") REFERENCES "public"."lager_mitglied"("lager_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erwaehnung" ADD CONSTRAINT "erwaehnung_aufgabe_fk" FOREIGN KEY ("lager_id","aufgabe_id") REFERENCES "public"."aufgabe"("lager_id","id") ON DELETE set null ("aufgabe_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erwaehnung_person_idx" ON "erwaehnung" USING btree ("lager_id","person_id","id");--> statement-breakpoint
CREATE INDEX "erwaehnung_quelle_idx" ON "erwaehnung" USING btree ("quelle_id");
