-- Rückweg zu 0135_tag_anlass (#626), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0135_tag_anlass.sql
-- Danach den Code auf den Stand vor 0135 zurückstellen. Gibt es noch Gruppen vom Typ «anlass», bricht der Rückweg ab und ändert nichts: Der alte Typ-Check kennt «anlass» nicht. Dann zuerst allen Personen die Gruppe entziehen und die Gruppe in der Verwaltung löschen. Die Verknüpfung zum Anlass geht verloren, sonst nichts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tag" WHERE "typ" = 'anlass') THEN
    RAISE EXCEPTION 'Es gibt noch Gruppen vom Typ anlass: zuerst löschen (Rückweg zu 0135 abgebrochen)';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "tag_anlass_eindeutig";--> statement-breakpoint
ALTER TABLE "tag" DROP CONSTRAINT "tag_anlass_check";--> statement-breakpoint
ALTER TABLE "tag" DROP CONSTRAINT "tag_typ_check";--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_typ_check" CHECK ("tag"."typ" in ('stufe', 'funktion', 'team', 'lager'));--> statement-breakpoint
ALTER TABLE "tag" DROP CONSTRAINT "tag_anlass_id_anlass_id_fk";--> statement-breakpoint
ALTER TABLE "tag" DROP COLUMN "anlass_id";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
