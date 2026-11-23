-- Rechte je Gruppe (#643): Nachtragen zu 0140. Jede bestehende Gruppe bekommt ihre Systemrollen («Stufenleitung» und «Leitung» an einer Stufe, «Verantwortliche/r» an jeder anderen Gruppe), und jede bestehende Zuordnung mit dem passenden Freitext (Stufenrollen «leitung» und «stufenleitung», an anderen Gruppen «verantwortlich») bekommt die Rolle. Der Freitext bleibt unverändert und gilt für den alten Weg weiter.
-- Verhalten ändert sich nicht: Die Rechte der Systemrolle «Verantwortliche/r» an einem Team sind genau die, die der alte Weg dem Freitext «verantwortlich» gibt (Seite des Teams bearbeiten und veröffentlichen, Belegung der Räume sehen). Ein Test (migration-0141.test.ts) hält sie gegen rechtemodell/standard.ts.
-- Rückweg: drizzle/rueckweg/0141_gruppenrollen_nachtragen.sql
INSERT INTO "gruppen_rolle" ("abteilung_id", "tag_id", "name", "beschreibung", "verantwortlich", "reihenfolge", "schluessel")
SELECT t."abteilung_id", t."id", v."name", v."beschreibung", v."verantwortlich", v."reihenfolge", v."schluessel"
FROM "tag" t
JOIN (VALUES
  ('stufe', 'stufenleitung', 'Stufenleitung', 'Stufenleitung der Stufe', false, 1),
  ('stufe', 'leitung', 'Leitung', 'Leitung der Stufe', false, 2),
  ('funktion', 'verantwortlich', 'Verantwortliche/r', 'Verantwortlich für die Gruppe', true, 1),
  ('team', 'verantwortlich', 'Verantwortliche/r', 'Verantwortlich für die Gruppe', true, 1),
  ('lager', 'verantwortlich', 'Verantwortliche/r', 'Verantwortlich für die Gruppe', true, 1),
  ('anlass', 'verantwortlich', 'Verantwortliche/r', 'Verantwortlich für die Gruppe', true, 1)
) AS v("typ", "schluessel", "name", "beschreibung", "verantwortlich", "reihenfolge") ON v."typ" = t."typ"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "gruppen_rolle_recht" ("rolle_id", "recht", "geltung")
SELECT r."id", v."recht", v."geltung"
FROM "gruppen_rolle" r
JOIN "tag" t ON t."id" = r."tag_id"
CROSS JOIN (VALUES
  ('seiten.bearbeiten', 'eigene'),
  ('seiten.veroeffentlichen', 'eigene'),
  ('raum.belegung', 'alle')
) AS v("recht", "geltung")
WHERE t."typ" = 'team' AND r."schluessel" = 'verantwortlich'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "person_tag" pt SET "rolle_id" = r."id"
FROM "gruppen_rolle" r JOIN "tag" t ON t."id" = r."tag_id"
WHERE r."tag_id" = pt."tag_id" AND pt."rolle" IS NOT NULL AND pt."rolle_id" IS NULL AND r."schluessel" IS NOT NULL
  AND r."schluessel" = CASE WHEN t."typ" = 'stufe' THEN pt."rolle" ELSE lower(pt."rolle") END;
