-- Kind mit eigenem Konto (#644): Ein Kind kann ein eigenes Konto haben (Variante A: kind.user_id), die Stufe bleibt nur im Kind. Dazu der Vermerk «Eltern informiert» mit Datum, die Einsicht der Eltern je Kind, die Einstellungen je Abteilung (ohne Zeile: Konten für Kinder aus) und eine Sicht kind_zugang, die für jede Stelle der Sichtregeln sagt, welche Konten ein Kind sehen: die verknüpften Eltern (solange sie Einsicht haben) und das eigene Konto. Bestehende Daten bleiben unberührt: Alle Kinder haben danach kein Konto, alle Eltern behalten ihre Sicht.
-- Rückweg: drizzle/rueckweg/0144_kind_konto.sql
ALTER TABLE "kind" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "kind" ADD COLUMN "konto_seit" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kind" ADD COLUMN "eltern_informiert_am" date;--> statement-breakpoint
ALTER TABLE "kind" ADD COLUMN "eltern_einsicht" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kind" ADD CONSTRAINT "kind_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kind" ADD CONSTRAINT "kind_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
CREATE TABLE "kind_konto_einstellung" (
	"abteilung_id" uuid PRIMARY KEY NOT NULL,
	"erlaubt" boolean DEFAULT false NOT NULL,
	"chat" text DEFAULT 'aus' NOT NULL,
	"mindestalter" smallint,
	"eltern_einsicht_vorgabe" boolean DEFAULT true NOT NULL,
	CONSTRAINT "kind_konto_einstellung_chat_check" CHECK ("kind_konto_einstellung"."chat" in ('aus', 'lesen', 'schreiben')),
	CONSTRAINT "kind_konto_einstellung_mindestalter_check" CHECK ("kind_konto_einstellung"."mindestalter" is null or "kind_konto_einstellung"."mindestalter" between 6 and 18)
);--> statement-breakpoint
ALTER TABLE "kind_konto_einstellung" ADD CONSTRAINT "kind_konto_einstellung_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Wer ein Kind sieht: Eltern nur, solange das Kind kein Konto hat oder die Einsicht der Eltern gilt; das eigene Konto immer. «eigen» trennt die beiden, wo es zählt (Telefonnummern, Einzelchats)
CREATE VIEW "kind_zugang" AS
SELECT ke.kind_id, ke.user_id, ke.erstellt_am, false AS eigen
FROM kind_eltern ke
JOIN kind k ON k.id = ke.kind_id
WHERE k.user_id IS NULL OR k.eltern_einsicht
UNION ALL
SELECT k.id, k.user_id, coalesce(k.konto_seit, k.stufe_seit), true
FROM kind k
WHERE k.user_id IS NOT NULL;--> statement-breakpoint
GRANT SELECT ON "kind_zugang" TO cevi_os_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "kind_konto_einstellung" TO cevi_os_api;
