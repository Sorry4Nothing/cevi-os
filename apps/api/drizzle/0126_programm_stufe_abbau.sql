-- Termine (#449): Die Stufen eines Termins laufen nur noch über Tags (programm_tag). programm_stufe und die Sicht programm_stufe_wirksam entfallen.
-- Vorher wandert der heutige Stand verlustfrei nach programm_tag, nur Stufen-Tags der eigenen Abteilung: die zugeordneten Stufen, und bei einem Programm ohne
-- Zuordnung (galt für alle Stufen) alle Stufen der Abteilung, so wie die Sicht sie bisher lieferte. Danach liest nichts mehr aus der Tabelle.
-- Ein Termin aus dem Kalender behält sie, bis der nächste Abgleich (alle 5 Minuten) seine Tags aus den Outlook-Kategorien neu berechnet.
-- Rückweg: drizzle/rueckweg/0126_programm_stufe_abbau.sql
INSERT INTO "programm_tag" ("programm_id", "tag_id")
SELECT w."programm_id", w."stufe_id"
FROM "programm_stufe_wirksam" w
JOIN "programm" p ON p."id" = w."programm_id"
JOIN "tag" t ON t."id" = w."stufe_id" AND t."typ" = 'stufe' AND t."abteilung_id" = p."abteilung_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP VIEW "programm_stufe_wirksam";--> statement-breakpoint
DROP TABLE "programm_stufe";
