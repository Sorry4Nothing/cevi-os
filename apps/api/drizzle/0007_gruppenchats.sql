-- Datenmigration: Gruppenchat für jede Stufe, die es schon gibt. Neue Stufen legen ihn über legeGruppenchatAn an; ON CONFLICT DO NOTHING macht den Lauf wiederholbar
INSERT INTO "chat" ("abteilung_id", "typ", "stufe_id")
SELECT "abteilung_id", 'stufe', "id" FROM "stufe"
ON CONFLICT DO NOTHING;
