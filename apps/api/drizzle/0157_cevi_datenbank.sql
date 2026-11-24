-- Cevi-Datenbank als Quelle für die Anmeldung (#691): Die Anmeldung füllt freiwillige Angaben aus der Cevi-Datenbank vor (nur lesen). Die Migration legt nur an: eine Tabelle für die Einstellung je Abteilung, eine Spalte für die Quelle eines Zusatzfeldes und je eine Spalte für die gemerkte Nummer in der Cevi-Datenbank. Bestehende Zeilen bleiben unverändert (alle Spalten leer).
-- Rückweg: drizzle/rueckweg/0157_cevi_datenbank.sql
CREATE TABLE "cevi_db_einstellung" (
	"abteilung_id" uuid PRIMARY KEY NOT NULL,
	"gruppe_id" text,
	"letzter_abruf_am" timestamp with time zone,
	"letzter_status" text,
	"anzahl_personen" integer,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cevi_db_einstellung_gruppe_check" CHECK ("cevi_db_einstellung"."gruppe_id" is null or "cevi_db_einstellung"."gruppe_id" ~ '^[0-9]{1,20}$'),
	CONSTRAINT "cevi_db_einstellung_status_check" CHECK ("cevi_db_einstellung"."letzter_status" is null or "cevi_db_einstellung"."letzter_status" in ('ok', 'fehler'))
);
--> statement-breakpoint
ALTER TABLE "cevi_db_einstellung" ADD CONSTRAINT "cevi_db_einstellung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anlass_feld" ADD COLUMN "cevi_quelle" text;--> statement-breakpoint
ALTER TABLE "anlass_feld" ADD CONSTRAINT "anlass_feld_cevi_quelle_check" CHECK ("anlass_feld"."cevi_quelle" is null or ("anlass_feld"."typ" = 'text' and "anlass_feld"."cevi_quelle" in ('geburtsdatum', 'telefon', 'adresse', 'plz', 'ort', 'email')));--> statement-breakpoint
ALTER TABLE "kind" ADD COLUMN "cevi_db_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "cevi_db_id" text;
