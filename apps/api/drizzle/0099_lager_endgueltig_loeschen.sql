-- Löschen ist endgültig (#427, Entscheid vom 22.11.2026: «gelöscht ist gelöscht»): Die Spalten geloescht_am und geloescht_von entfallen aus allen Lager-Tabellen mit Feed, die Teilindizes auf «nicht gelöscht» werden normale Indizes. Bisher weich gelöschte Zeilen werden hier endgültig gelöscht (kein Papierkorb, keine Wiederherstellung); der Sync-Kern löscht ab jetzt mit DELETE und meldet «geloescht» im Änderungsfeed.
-- Abhängige Zeilen: Was per ON DELETE CASCADE an einer gelöschten Zeile hing, geht mit. Zeilen, die eine gelöschte Datei (lager_datei) einbinden (Dokument, Verknüpfung in Pinnwand und Infos, Protokoll, Programmbild einer Tagesseite), waren schon unsichtbar und gehen mit, ebenso Beschlüsse und Protokolle eines gelöschten Höcks. Der Verweis eines Beschlusses auf ein gelöschtes Protokoll wird leer (ON DELETE SET NULL, vorher NO ACTION); Aufgaben, die an einem gelöschten Meilenstein hingen, behalten ihre Frist als festes Datum. Erwähnungen und Reaktionen, deren Inhalt weg ist, werden entfernt. Die Einträge im Feed (lager_aenderung) bleiben stehen und laufen nach 30 Tagen aus.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0099_lager_endgueltig_loeschen.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0099_lager_endgueltig_loeschen.sql
--   Der Rückweg stellt nur die Spalten, die Teilindizes und den Fremdschlüssel wieder her. Die gelöschten Zeilen kommen nicht zurück, und die Spalten bleiben leer. Danach den Code auf den Stand vor 0099 zurückstellen.
ALTER TABLE "beschluss" DROP CONSTRAINT "beschluss_protokoll_fk";
--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_protokoll_fk" FOREIGN KEY ("lager_id","protokoll_id") REFERENCES "public"."protokoll"("lager_id","id") ON DELETE set null ("protokoll_id") ON UPDATE no action;
--> statement-breakpoint
DELETE FROM "beschluss" WHERE "geloescht_am" IS NOT NULL OR "hoeck_id" IN (SELECT "id" FROM "hoeck" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "protokoll" WHERE "geloescht_am" IS NOT NULL OR "hoeck_id" IN (SELECT "id" FROM "hoeck" WHERE "geloescht_am" IS NOT NULL) OR "datei_id" IN (SELECT "id" FROM "lager_datei" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "dokument" WHERE "geloescht_am" IS NOT NULL OR "datei_id" IN (SELECT "id" FROM "lager_datei" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "pinnwand_datei" WHERE "geloescht_am" IS NOT NULL OR "datei_id" IN (SELECT "id" FROM "lager_datei" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "info_abschnitt_datei" WHERE "geloescht_am" IS NOT NULL OR "datei_id" IN (SELECT "id" FROM "lager_datei" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "tagesseite_block" WHERE "geloescht_am" IS NOT NULL OR "datei_id" IN (SELECT "id" FROM "lager_datei" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
UPDATE "aufgabe" SET "frist_meilenstein_id" = NULL, "frist_versatz_tage" = NULL WHERE "frist_meilenstein_id" IN (SELECT "id" FROM "meilenstein" WHERE "geloescht_am" IS NOT NULL);
--> statement-breakpoint
DELETE FROM "lager_datei" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "ressort" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "ressort_link" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "ressort_notiz" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "aufgabe" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "aufgabe_checkpunkt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "aufgabe_link" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "meilenstein" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "lagertag" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "tagesabschnitt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "hoeck" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "traktandum" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "pinnwand_beitrag" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "pinnwand_datei" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "umfrage" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "umfrage_option" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "umfrage_stimme" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "reaktion" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "teilnehmer" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "abzaehlen" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "zimmer" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "zimmer_zuordnung" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "fahrt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "fahrt_mitfahrer" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "gruppe" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "gruppe_zuordnung" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "dienst" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "schicht" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "anwesenheit" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "anwesenheit_anfrage" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "tagesseite" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "tagesseite_block" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "einkauf_artikel" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "packliste_punkt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "notfall_kontakt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "info_abschnitt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "info_abschnitt_datei" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "dokument" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "adressbuch_kontakt" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "protokoll" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "beschluss" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "diensttausch" WHERE "geloescht_am" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "erwaehnung" WHERE "quelle_typ" = 'aufgabe' AND NOT EXISTS (SELECT 1 FROM "aufgabe" q WHERE q."id" = "erwaehnung"."quelle_id");
--> statement-breakpoint
DELETE FROM "erwaehnung" WHERE "quelle_typ" = 'traktandum' AND NOT EXISTS (SELECT 1 FROM "traktandum" q WHERE q."id" = "erwaehnung"."quelle_id");
--> statement-breakpoint
DELETE FROM "erwaehnung" WHERE "quelle_typ" = 'pinnwand' AND NOT EXISTS (SELECT 1 FROM "pinnwand_beitrag" q WHERE q."id" = "erwaehnung"."quelle_id");
--> statement-breakpoint
DELETE FROM "erwaehnung" WHERE "quelle_typ" = 'beschluss' AND NOT EXISTS (SELECT 1 FROM "beschluss" q WHERE q."id" = "erwaehnung"."quelle_id");
--> statement-breakpoint
DELETE FROM "reaktion" WHERE "ziel_typ" = 'pinnwand_beitrag' AND NOT EXISTS (SELECT 1 FROM "pinnwand_beitrag" q WHERE q."id" = "reaktion"."ziel_id");
--> statement-breakpoint
DROP INDEX "ressort_kuerzel_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "ressort_kuerzel_uq" ON "ressort" USING btree ("lager_id",lower("kuerzel"));
--> statement-breakpoint
DROP INDEX "lagertag_datum_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "lagertag_datum_uq" ON "lagertag" USING btree ("lager_id","datum");
--> statement-breakpoint
DROP INDEX "tagesabschnitt_name_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "tagesabschnitt_name_uq" ON "tagesabschnitt" USING btree ("lager_id",lower("name"));
--> statement-breakpoint
DROP INDEX "aufgabe_erinnerung_idx";
--> statement-breakpoint
CREATE INDEX "aufgabe_erinnerung_idx" ON "aufgabe" USING btree ("frist") WHERE "aufgabe"."frist" is not null and "aufgabe"."status" <> 'erledigt';
--> statement-breakpoint
DROP INDEX "pinnwand_datei_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "pinnwand_datei_uq" ON "pinnwand_datei" USING btree ("beitrag_id","datei_id");
--> statement-breakpoint
DROP INDEX "umfrage_beitrag_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "umfrage_beitrag_uq" ON "umfrage" USING btree ("beitrag_id");
--> statement-breakpoint
DROP INDEX "umfrage_stimme_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "umfrage_stimme_uq" ON "umfrage_stimme" USING btree ("option_id","person_id");
--> statement-breakpoint
DROP INDEX "reaktion_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "reaktion_uq" ON "reaktion" USING btree ("ziel_typ","ziel_id","person_id");
--> statement-breakpoint
DROP INDEX "abzaehlen_teilnehmer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "abzaehlen_teilnehmer_uq" ON "abzaehlen" USING btree ("lager_id","teilnehmer_id") WHERE "abzaehlen"."teilnehmer_id" is not null;
--> statement-breakpoint
DROP INDEX "abzaehlen_person_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "abzaehlen_person_uq" ON "abzaehlen" USING btree ("lager_id","person_id") WHERE "abzaehlen"."person_id" is not null;
--> statement-breakpoint
DROP INDEX "zimmer_zuordnung_teilnehmer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "zimmer_zuordnung_teilnehmer_uq" ON "zimmer_zuordnung" USING btree ("lager_id","teilnehmer_id") WHERE "zimmer_zuordnung"."teilnehmer_id" is not null;
--> statement-breakpoint
DROP INDEX "zimmer_zuordnung_person_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "zimmer_zuordnung_person_uq" ON "zimmer_zuordnung" USING btree ("lager_id","person_id") WHERE "zimmer_zuordnung"."person_id" is not null;
--> statement-breakpoint
DROP INDEX "fahrt_fahrer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "fahrt_fahrer_uq" ON "fahrt" USING btree ("lager_id","richtung","fahrer_person_id") WHERE "fahrt"."fahrer_person_id" is not null;
--> statement-breakpoint
DROP INDEX "fahrt_mitfahrer_person_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "fahrt_mitfahrer_person_uq" ON "fahrt_mitfahrer" USING btree ("lager_id","richtung","person_id") WHERE "fahrt_mitfahrer"."person_id" is not null;
--> statement-breakpoint
DROP INDEX "fahrt_mitfahrer_teilnehmer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "fahrt_mitfahrer_teilnehmer_uq" ON "fahrt_mitfahrer" USING btree ("lager_id","richtung","teilnehmer_id") WHERE "fahrt_mitfahrer"."teilnehmer_id" is not null;
--> statement-breakpoint
DROP INDEX "gruppe_zuordnung_teilnehmer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "gruppe_zuordnung_teilnehmer_uq" ON "gruppe_zuordnung" USING btree ("lager_id","teilnehmer_id") WHERE "gruppe_zuordnung"."teilnehmer_id" is not null;
--> statement-breakpoint
DROP INDEX "gruppe_zuordnung_person_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "gruppe_zuordnung_person_uq" ON "gruppe_zuordnung" USING btree ("lager_id","person_id") WHERE "gruppe_zuordnung"."person_id" is not null;
--> statement-breakpoint
DROP INDEX "dienst_name_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "dienst_name_uq" ON "dienst" USING btree ("lager_id","tagesabschnitt_id",lower("name"));
--> statement-breakpoint
DROP INDEX "schicht_person_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "schicht_person_uq" ON "schicht" USING btree ("lager_id","lagertag_id","tagesabschnitt_id","person_id") WHERE "schicht"."person_id" is not null;
--> statement-breakpoint
DROP INDEX "schicht_teilnehmer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "schicht_teilnehmer_uq" ON "schicht" USING btree ("lager_id","lagertag_id","tagesabschnitt_id","teilnehmer_id") WHERE "schicht"."teilnehmer_id" is not null;
--> statement-breakpoint
DROP INDEX "anwesenheit_person_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "anwesenheit_person_uq" ON "anwesenheit" USING btree ("lager_id","person_id","lagertag_id","tagesabschnitt_id") WHERE "anwesenheit"."person_id" is not null;
--> statement-breakpoint
DROP INDEX "anwesenheit_teilnehmer_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "anwesenheit_teilnehmer_uq" ON "anwesenheit" USING btree ("lager_id","teilnehmer_id","lagertag_id","tagesabschnitt_id") WHERE "anwesenheit"."teilnehmer_id" is not null;
--> statement-breakpoint
DROP INDEX "anwesenheit_anfrage_offen_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "anwesenheit_anfrage_offen_uq" ON "anwesenheit_anfrage" USING btree ("lager_id","person_id","lagertag_id","tagesabschnitt_id") WHERE "anwesenheit_anfrage"."status" = 'offen';
--> statement-breakpoint
DROP INDEX "tagesseite_lagertag_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "tagesseite_lagertag_uq" ON "tagesseite" USING btree ("lagertag_id");
--> statement-breakpoint
DROP INDEX "einkauf_artikel_liste_idx";
--> statement-breakpoint
CREATE INDEX "einkauf_artikel_liste_idx" ON "einkauf_artikel" USING btree ("lager_id","id");
--> statement-breakpoint
DROP INDEX "info_abschnitt_datei_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "info_abschnitt_datei_uq" ON "info_abschnitt_datei" USING btree ("abschnitt_id","datei_id");
--> statement-breakpoint
DROP INDEX "diensttausch_offen_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "diensttausch_offen_uq" ON "diensttausch" USING btree ("lager_id","schicht_id") WHERE "diensttausch"."status" = 'offen';
--> statement-breakpoint
ALTER TABLE "lager_datei" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "ressort" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "ressort_link" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "ressort_notiz" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "aufgabe" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "aufgabe_checkpunkt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "aufgabe_link" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "meilenstein" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "lagertag" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "tagesabschnitt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "hoeck" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "traktandum" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "pinnwand_beitrag" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "pinnwand_datei" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "umfrage" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "umfrage_option" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "umfrage_stimme" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "reaktion" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "teilnehmer" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "abzaehlen" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "zimmer" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "zimmer_zuordnung" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "fahrt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "fahrt_mitfahrer" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "gruppe" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "gruppe_zuordnung" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "dienst" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "schicht" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "anwesenheit" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "anwesenheit_anfrage" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "tagesseite" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "tagesseite_block" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "einkauf_artikel" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "packliste_punkt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "notfall_kontakt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "info_abschnitt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "info_abschnitt_datei" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "dokument" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "adressbuch_kontakt" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "protokoll" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "beschluss" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
--> statement-breakpoint
ALTER TABLE "diensttausch" DROP COLUMN "geloescht_am", DROP COLUMN "geloescht_von";
