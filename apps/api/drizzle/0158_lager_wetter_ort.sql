-- Das Wetter im Lager kommt aus dem Lagerort (#694): Der Server löst «ort» des Lagers beim Ortsdienst auf und hält das Ergebnis am Lager (gefundener Name, Schlüssel des gesuchten Textes, Ergebnis, letzter Versuch). Die Koordinaten «breite» und «laenge» setzt nur noch der Server.
-- Die Migration legt nur Spalten an. Bestehende Lager haben keinen Schlüssel und werden beim nächsten Lesen des Wetters aus ihrem Ort neu aufgelöst; früher von Hand gesetzte Koordinaten gelten nicht mehr.
-- Rückweg: drizzle/rueckweg/0158_lager_wetter_ort.sql
ALTER TABLE "lager" ADD COLUMN "wetter_ort_schluessel" text;--> statement-breakpoint
ALTER TABLE "lager" ADD COLUMN "wetter_ort_name" text;--> statement-breakpoint
ALTER TABLE "lager" ADD COLUMN "wetter_ort_ergebnis" text;--> statement-breakpoint
ALTER TABLE "lager" ADD COLUMN "wetter_ort_versuch_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lager" ADD CONSTRAINT "lager_wetter_ort_ergebnis_check" CHECK ("lager"."wetter_ort_ergebnis" is null or "lager"."wetter_ort_ergebnis" in ('gefunden', 'nicht_gefunden', 'mehrdeutig', 'fehler'));
