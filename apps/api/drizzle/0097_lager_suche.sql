-- Volltextsuche im Lager (#399): Erweiterung pg_trgm, die Funktion lager_suche_liste und je durchsuchter Tabelle zwei GIN-Indizes auf dem Suchtext (to_tsvector('german', …) für Wortstämme und Wortanfänge, gin_trgm_ops für Tippfehler). Keine Spalten, keine Zeilen: Der Suchtext wird nicht gespeichert, nur indiziert. Der Ausdruck jeder Quelle steht in src/lager/suche.ts (Quellen der Module); der Test «Suche benutzt den Index» prüft, dass beide übereinstimmen.
-- Voraussetzung: CREATE EXTENSION pg_trgm braucht das Recht CREATE auf der Datenbank. pg_trgm ist seit PostgreSQL 13 eine vertrauenswürdige Erweiterung (trusted): Der Besitzer der Datenbank (cevi_os_besitzer, die Migrationsrolle) darf sie ohne Superuser anlegen; das Image postgres:18 bringt sie mit (contrib). Ist sie schon da, ändert IF NOT EXISTS nichts. Siehe docs/betrieb.md.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0097_lager_suche.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0097_lager_suche.sql
--   Die Suche fällt aus (die Route liefert dann einen Fehler); es gehen keine Daten verloren. Die Erweiterung pg_trgm bleibt stehen (andere Teile könnten sie brauchen).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE FUNCTION "lager_suche_liste"(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ select array_to_string($1, ' ') $$;
--> statement-breakpoint
CREATE INDEX "ressort_suche_fts_idx" ON "ressort" USING gin (to_tsvector('german', coalesce(name, '') || ' ' || coalesce(kuerzel, '') || ' ' || coalesce(notiz, '')));
--> statement-breakpoint
CREATE INDEX "ressort_suche_trgm_idx" ON "ressort" USING gin ((coalesce(name, '') || ' ' || coalesce(kuerzel, '') || ' ' || coalesce(notiz, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "ressort_notiz_suche_fts_idx" ON "ressort_notiz" USING gin (to_tsvector('german', coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX "ressort_notiz_suche_trgm_idx" ON "ressort_notiz" USING gin ((coalesce(text, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "aufgabe_suche_fts_idx" ON "aufgabe" USING gin (to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(teil, '') || ' ' || coalesce(notiz, '')));
--> statement-breakpoint
CREATE INDEX "aufgabe_suche_trgm_idx" ON "aufgabe" USING gin ((coalesce(titel, '') || ' ' || coalesce(teil, '') || ' ' || coalesce(notiz, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "aufgabe_checkpunkt_suche_fts_idx" ON "aufgabe_checkpunkt" USING gin (to_tsvector('german', coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX "aufgabe_checkpunkt_suche_trgm_idx" ON "aufgabe_checkpunkt" USING gin ((coalesce(text, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "aufgabe_stichwort_suche_fts_idx" ON "aufgabe_stichwort" USING gin (to_tsvector('german', coalesce(stichwort, '')));
--> statement-breakpoint
CREATE INDEX "aufgabe_stichwort_suche_trgm_idx" ON "aufgabe_stichwort" USING gin ((coalesce(stichwort, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "hoeck_suche_fts_idx" ON "hoeck" USING gin (to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(ort, '')));
--> statement-breakpoint
CREATE INDEX "hoeck_suche_trgm_idx" ON "hoeck" USING gin ((coalesce(titel, '') || ' ' || coalesce(ort, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "traktandum_suche_fts_idx" ON "traktandum" USING gin (to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(text, '') || ' ' || coalesce(entscheid, '')));
--> statement-breakpoint
CREATE INDEX "traktandum_suche_trgm_idx" ON "traktandum" USING gin ((coalesce(titel, '') || ' ' || coalesce(text, '') || ' ' || coalesce(entscheid, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "protokoll_suche_fts_idx" ON "protokoll" USING gin (to_tsvector('german', coalesce(titel, '')));
--> statement-breakpoint
CREATE INDEX "protokoll_suche_trgm_idx" ON "protokoll" USING gin ((coalesce(titel, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "beschluss_suche_fts_idx" ON "beschluss" USING gin (to_tsvector('german', coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX "beschluss_suche_trgm_idx" ON "beschluss" USING gin ((coalesce(text, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "pinnwand_beitrag_suche_fts_idx" ON "pinnwand_beitrag" USING gin (to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX "pinnwand_beitrag_suche_trgm_idx" ON "pinnwand_beitrag" USING gin ((coalesce(titel, '') || ' ' || coalesce(text, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "eingang_suche_fts_idx" ON "eingang" USING gin (to_tsvector('german', coalesce(text, '') || ' ' || coalesce(antwort, '')));
--> statement-breakpoint
CREATE INDEX "eingang_suche_trgm_idx" ON "eingang" USING gin ((coalesce(text, '') || ' ' || coalesce(antwort, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "teilnehmer_suche_fts_idx" ON "teilnehmer" USING gin (to_tsvector('german', coalesce(vorname, '') || ' ' || coalesce(nachname, '')));
--> statement-breakpoint
CREATE INDEX "teilnehmer_suche_trgm_idx" ON "teilnehmer" USING gin ((coalesce(vorname, '') || ' ' || coalesce(nachname, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "zimmer_suche_fts_idx" ON "zimmer" USING gin (to_tsvector('german', coalesce(name, '')));
--> statement-breakpoint
CREATE INDEX "zimmer_suche_trgm_idx" ON "zimmer" USING gin ((coalesce(name, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "fahrt_suche_fts_idx" ON "fahrt" USING gin (to_tsvector('german', coalesce(name, '') || ' ' || coalesce(von, '') || ' ' || coalesce(nach, '') || ' ' || coalesce(treffpunkt, '')));
--> statement-breakpoint
CREATE INDEX "fahrt_suche_trgm_idx" ON "fahrt" USING gin ((coalesce(name, '') || ' ' || coalesce(von, '') || ' ' || coalesce(nach, '') || ' ' || coalesce(treffpunkt, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "gruppe_suche_fts_idx" ON "gruppe" USING gin (to_tsvector('german', coalesce(name, '')));
--> statement-breakpoint
CREATE INDEX "gruppe_suche_trgm_idx" ON "gruppe" USING gin ((coalesce(name, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "dienst_suche_fts_idx" ON "dienst" USING gin (to_tsvector('german', coalesce(name, '') || ' ' || coalesce(beschreibung, '')));
--> statement-breakpoint
CREATE INDEX "dienst_suche_trgm_idx" ON "dienst" USING gin ((coalesce(name, '') || ' ' || coalesce(beschreibung, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "einkauf_artikel_suche_fts_idx" ON "einkauf_artikel" USING gin (to_tsvector('german', coalesce(name, '')));
--> statement-breakpoint
CREATE INDEX "einkauf_artikel_suche_trgm_idx" ON "einkauf_artikel" USING gin ((coalesce(name, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "packliste_punkt_suche_fts_idx" ON "packliste_punkt" USING gin (to_tsvector('german', coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX "packliste_punkt_suche_trgm_idx" ON "packliste_punkt" USING gin ((coalesce(text, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "notfall_kontakt_suche_fts_idx" ON "notfall_kontakt" USING gin (to_tsvector('german', coalesce(funktion, '') || ' ' || coalesce(name, '')));
--> statement-breakpoint
CREATE INDEX "notfall_kontakt_suche_trgm_idx" ON "notfall_kontakt" USING gin ((coalesce(funktion, '') || ' ' || coalesce(name, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "info_abschnitt_suche_fts_idx" ON "info_abschnitt" USING gin (to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX "info_abschnitt_suche_trgm_idx" ON "info_abschnitt" USING gin ((coalesce(titel, '') || ' ' || coalesce(text, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "dokument_suche_fts_idx" ON "dokument" USING gin (to_tsvector('german', coalesce(titel, '') || ' ' || coalesce(lager_suche_liste(stichworte), '')));
--> statement-breakpoint
CREATE INDEX "dokument_suche_trgm_idx" ON "dokument" USING gin ((coalesce(titel, '') || ' ' || coalesce(lager_suche_liste(stichworte), '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "adressbuch_kontakt_suche_fts_idx" ON "adressbuch_kontakt" USING gin (to_tsvector('german', coalesce(name, '') || ' ' || coalesce(funktion, '') || ' ' || coalesce(gruppe, '')));
--> statement-breakpoint
CREATE INDEX "adressbuch_kontakt_suche_trgm_idx" ON "adressbuch_kontakt" USING gin ((coalesce(name, '') || ' ' || coalesce(funktion, '') || ' ' || coalesce(gruppe, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "meilenstein_suche_fts_idx" ON "meilenstein" USING gin (to_tsvector('german', coalesce(titel, '')));
--> statement-breakpoint
CREATE INDEX "meilenstein_suche_trgm_idx" ON "meilenstein" USING gin ((coalesce(titel, '')) gin_trgm_ops);
