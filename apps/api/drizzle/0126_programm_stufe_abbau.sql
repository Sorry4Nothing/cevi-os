-- Termine (#449): Die Stufen eines Termins laufen nur noch über Tags (programm_tag). programm_stufe und die Sicht programm_stufe_wirksam entfallen.
-- Vorher wandern die ausdrücklichen Zuordnungen verlustfrei nach programm_tag, nur Stufen-Tags der eigenen Abteilung. Ein Programm ohne Zuordnung
-- (galt bisher für alle Stufen) bekommt keinen Tag: Es ist dann keiner Gruppe zugewiesen, bis eine Outlook-Kategorie es zuweist (#449).
-- Der Abgleich lässt die Tags eines Termins ohne zuordenbare Kategorie unberührt; erst eine zuordenbare Kategorie ersetzt sie.
-- Rückweg: drizzle/rueckweg/0126_programm_stufe_abbau.sql
INSERT INTO "programm_tag" ("programm_id", "tag_id")
SELECT ps."programm_id", ps."stufe_id"
FROM "programm_stufe" ps
JOIN "programm" p ON p."id" = ps."programm_id"
JOIN "tag" t ON t."id" = ps."stufe_id" AND t."typ" = 'stufe' AND t."abteilung_id" = p."abteilung_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP VIEW "programm_stufe_wirksam";--> statement-breakpoint
DROP TABLE "programm_stufe";
