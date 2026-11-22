-- Private To-dos und Vorlagen im Lager (#376): todo_privat (nur für die Person selbst, ohne Feed) und vorlage (je Abteilung, Art aufgaben oder packliste, Inhalt als jsonb). Die Migration legt nur an.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0071_lager_todos_vorlagen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0071_lager_todos_vorlagen.sql
--   Es gehen alle privaten To-dos und alle Vorlagen verloren. Aufgaben und Packlisten-Punkte, die aus einer Vorlage entstanden sind, bleiben (sie behalten keinen Verweis auf die Vorlage).
CREATE TABLE "todo_privat" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lager_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"text" text NOT NULL,
	"erledigt" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_privat_text_check" CHECK (char_length("todo_privat"."text") between 1 and 500 and "todo_privat"."reihenfolge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vorlage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"art" text NOT NULL,
	"name" text NOT NULL,
	"inhalt" jsonb NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" uuid,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_von" uuid,
	CONSTRAINT "vorlage_name_uq" UNIQUE("abteilung_id","art","name"),
	CONSTRAINT "vorlage_art_check" CHECK ("vorlage"."art" in ('aufgaben', 'packliste')),
	CONSTRAINT "vorlage_inhalt_check" CHECK (char_length("vorlage"."name") between 1 and 100 and jsonb_typeof("vorlage"."inhalt") = 'object')
);
--> statement-breakpoint
ALTER TABLE "todo_privat" ADD CONSTRAINT "todo_privat_lager_id_lager_id_fk" FOREIGN KEY ("lager_id") REFERENCES "public"."lager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_privat" ADD CONSTRAINT "todo_privat_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorlage" ADD CONSTRAINT "vorlage_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorlage" ADD CONSTRAINT "vorlage_erstellt_von_user_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vorlage" ADD CONSTRAINT "vorlage_geaendert_von_user_id_fk" FOREIGN KEY ("geaendert_von") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_privat_liste_idx" ON "todo_privat" USING btree ("lager_id","person_id","reihenfolge","id");--> statement-breakpoint
CREATE INDEX "todo_privat_person_idx" ON "todo_privat" USING btree ("person_id");
