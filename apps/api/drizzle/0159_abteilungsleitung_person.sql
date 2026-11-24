-- Die Abteilungsleitung ist eine Zuordnung in einer eigenen Tabelle, nicht mehr der Wert «admin» in user.role (#720, Teil 2 von Epic #714). Die Migration legt die Tabelle an und kopiert die bisherigen Konten mit role = 'admin' hinein; user.role bleibt unberührt, alter und neuer Code laufen daneben.
-- Auf dem Server gilt: erst diese Migration, dann der neue Code. Der neue Code liest allein die Tabelle und schreibt user.role weiter als Spiegel; ein späteres Release entfernt den Spiegel und setzt role zurück.
-- Rückweg: drizzle/rueckweg/0159_abteilungsleitung_person.sql
CREATE TABLE "abteilungsleitung_person" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "abteilungsleitung_person" ADD CONSTRAINT "abteilungsleitung_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "abteilungsleitung_person" ("user_id") SELECT "id" FROM "user" WHERE "role" = 'admin';
