-- Die Rechte der Abteilungsleitung sind einstellbar (#663): eine Zeile je Abteilung mit den Rechten, die ihr der Entwickler wegnimmt. Standard sind alle vergebbaren Rechte des Katalogs; ohne Zeile oder mit leerer Liste ändert sich für niemanden etwas. Die Abteilungsleitung bleibt technisch die Rolle «admin» im Konto (user.role).
-- Die Migration legt nur an: eine Tabelle und eine leere Zeile je bestehende Abteilung (Vorbelegung = heutiges Verhalten).
-- Rückweg: drizzle/rueckweg/0149_abteilungsleitung_rechte.sql
CREATE TABLE "abteilungsleitung_recht" (
	"abteilung_id" uuid PRIMARY KEY NOT NULL,
	"ohne" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abteilungsleitung_recht_ohne_check" CHECK (cardinality("abteilungsleitung_recht"."ohne") <= 200)
);
--> statement-breakpoint
ALTER TABLE "abteilungsleitung_recht" ADD CONSTRAINT "abteilungsleitung_recht_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "abteilungsleitung_recht" ("abteilung_id") SELECT "id" FROM "abteilung";
