-- Lädeli (#642): Annahmen, die im Code standen, werden Einstellungen der Abteilung. laden_einstellung bekommt Regeln (Bestellen offen, Schnell dazu, Preise für Besucher, grösste Menge, Positionen und offene Bestellungen je Person, Mindestbestellung) und Texte (Hinweis zur Bezahlung, Zahlungsart, Bestätigung, Hinweis zur Übergabe, Bedingungen, Text bei geschlossenem Lädeli). Alle Spalten haben die bisherigen Werte als Vorgabe (ein Text ohne Wert, null, gilt als Vorgabe aus dem Code); bestehende Zeilen und Bestellungen bleiben unverändert. Die Obergrenze der Menge je Position steigt von 10 auf 99, weil die Abteilung sie jetzt selbst festlegt.
-- Rückweg: drizzle/rueckweg/0145_laden_einstellungen.sql
ALTER TABLE "laden_einstellung" ADD COLUMN "bestellen_offen" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "schnell_dazu" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "preise_oeffentlich" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "max_menge" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "max_positionen" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "max_offene" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "mindest_rappen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "bezahlhinweis" text;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "zahlungsart" text;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "bestaetigung" text;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "uebergabehinweis" text;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "bedingungen" text;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD COLUMN "geschlossen_text" text;--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD CONSTRAINT "laden_einstellung_grenzen_check" CHECK ("laden_einstellung"."max_menge" between 1 and 99 and "laden_einstellung"."max_positionen" between 1 and 50 and "laden_einstellung"."max_offene" between 1 and 20 and "laden_einstellung"."mindest_rappen" between 0 and 1000000);--> statement-breakpoint
ALTER TABLE "laden_einstellung" ADD CONSTRAINT "laden_einstellung_texte_check" CHECK (("laden_einstellung"."bezahlhinweis" is null or char_length("laden_einstellung"."bezahlhinweis") <= 120) and ("laden_einstellung"."zahlungsart" is null or char_length("laden_einstellung"."zahlungsart") <= 60) and ("laden_einstellung"."bestaetigung" is null or char_length("laden_einstellung"."bestaetigung") <= 240) and ("laden_einstellung"."uebergabehinweis" is null or char_length("laden_einstellung"."uebergabehinweis") <= 200) and ("laden_einstellung"."bedingungen" is null or char_length("laden_einstellung"."bedingungen") <= 600) and ("laden_einstellung"."geschlossen_text" is null or char_length("laden_einstellung"."geschlossen_text") <= 200));--> statement-breakpoint
ALTER TABLE "laden_bestellposition" DROP CONSTRAINT "laden_bestellposition_menge_check";--> statement-breakpoint
ALTER TABLE "laden_bestellposition" ADD CONSTRAINT "laden_bestellposition_menge_check" CHECK ("laden_bestellposition"."menge" between 1 and 99);
