-- Rückweg zu 0107_lager_pinnwand_empfaenger_ziel (#520), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0107_lager_pinnwand_empfaenger_ziel.sql
-- Danach den Code auf den Stand vor 0107 zurückstellen.
-- Zeilen mit Ressort oder Gruppe gehen verloren; ein Beitrag, der nur sie als Empfänger hatte, gilt danach für alle Mitglieder.
DELETE FROM "pinnwand_empfaenger" WHERE "ressort_id" IS NOT NULL OR "gruppe_id" IS NOT NULL;
DROP INDEX "pinnwand_empfaenger_ressort_uq";
DROP INDEX "pinnwand_empfaenger_gruppe_uq";
ALTER TABLE "pinnwand_empfaenger" DROP CONSTRAINT "pinnwand_empfaenger_check";
ALTER TABLE "pinnwand_empfaenger" ADD CONSTRAINT "pinnwand_empfaenger_check" CHECK (("pinnwand_empfaenger"."rolle" is null) <> ("pinnwand_empfaenger"."person_id" is null) and ("pinnwand_empfaenger"."rolle" is null or "pinnwand_empfaenger"."rolle" in ('leitung', 'team', 'lesen')));
ALTER TABLE "pinnwand_empfaenger" DROP COLUMN "ressort_id";
ALTER TABLE "pinnwand_empfaenger" DROP COLUMN "gruppe_id";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
