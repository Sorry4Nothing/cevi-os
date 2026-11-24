-- Rückweg zu 0148_aenderungsprotokoll (#662), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0148_aenderungsprotokoll.sql
-- Danach den Code auf den Stand vor 0148 zurückstellen. Die Sicherheitszeilen und die vier neuen Spalten gehen verloren; die bereinigten Zeilen (Zugriffe, abgelehnte Anfragen, Alltags-Routen) kommen nicht zurück. Das Audit-Log bleibt unberührt.
DELETE FROM "aktivitaet" WHERE "art" = 'sicherheit';--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP CONSTRAINT "aktivitaet_aenderung_check";--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP CONSTRAINT "aktivitaet_laenge_check";--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_laenge_check" CHECK (char_length("aktivitaet"."aktion") <= 200 and char_length("aktivitaet"."bereich") <= 60 and ("aktivitaet"."name" is null or char_length("aktivitaet"."name") <= 120) and ("aktivitaet"."fehler_code" is null or char_length("aktivitaet"."fehler_code") <= 60) and ("aktivitaet"."herkunft" is null or char_length("aktivitaet"."herkunft") <= 32) and ("aktivitaet"."geraet" is null or char_length("aktivitaet"."geraet") <= 40) and ("aktivitaet"."anfrage_id" is null or char_length("aktivitaet"."anfrage_id") <= 64));--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP CONSTRAINT "aktivitaet_art_check";--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_art_check" CHECK ("aktivitaet"."art" in ('aktion', 'anmeldung', 'audit', 'zugriff', 'system'));--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP COLUMN "aenderung";--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP COLUMN "beschreibung";--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP COLUMN "objekt_name";--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP COLUMN "gruppe";--> statement-breakpoint
DROP INDEX "audit_log_erstellt_am_idx";--> statement-breakpoint
-- Der Stand von 0139: Das Audit-Log spiegelt auch Änderungen durch Personen
CREATE OR REPLACE FUNCTION aktivitaet_aus_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  person uuid;
  anzeige text;
BEGIN
  IF NEW.akteur_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    person := NEW.akteur_id::uuid;
    SELECT left(u.name, 120) INTO anzeige FROM "user" u WHERE u.id = person;
  END IF;
  INSERT INTO aktivitaet (zeit, art, abteilung_id, user_id, akteur, name, aktion, bereich, objekt_typ, objekt_id, felder, ergebnis)
  VALUES (
    NEW.erstellt_am, 'audit', NEW.abteilung_id, person,
    CASE WHEN person IS NOT NULL THEN 'person' WHEN NEW.akteur_id = 'cli' THEN 'cli' ELSE 'system' END,
    anzeige, left(NEW.aktion, 200), left(NEW.ziel_typ, 60), left(NEW.ziel_typ, 60), NEW.ziel_id,
    CASE WHEN jsonb_typeof(NEW.details) = 'object'
      THEN (SELECT array_agg(left(k, 60) ORDER BY k) FROM (SELECT jsonb_object_keys(NEW.details) AS k LIMIT 30) s)
    END,
    'erfolg'
  );
  RETURN NEW;
END
$$;--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
