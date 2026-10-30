-- Datenmigration: Gruppenchat für Stufen, die die Verwaltung (#19) vor #92 ohne Chat angelegt hat. Neue Stufen legen ihn selbst an; ON CONFLICT DO NOTHING macht den Lauf wiederholbar
INSERT INTO "chat" ("abteilung_id", "typ", "stufe_id")
SELECT "abteilung_id", 'stufe', "id" FROM "stufe"
ON CONFLICT DO NOTHING;
