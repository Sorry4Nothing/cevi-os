-- Änderungsprotokoll (#662): Das Protokoll zeigt, was geändert wurde, nicht jeden Klick. Die Migration (1) fügt vier Spalten an (Gruppe der Aktion, Name des Objekts, Satz und die Angaben zur Änderung), (2) ersetzt die Arten «anmeldung» und «zugriff» durch «sicherheit», (3) bereinigt den Bestand, (4) lässt Änderungen durch eine Person nicht mehr zusätzlich aus dem Audit-Log spiegeln (sie stehen als Zeile ihrer Anfrage, mit Satz und Feldern) und (5) legt einen Index am Audit-Log an, mit dem die Zeile einer Anfrage ihre Audit-Angaben findet.
-- Bereinigt wird nur das, was keine Änderung ist: Zugriffe, Anmelde-Erfolge, abgelehnte oder fehlgeschlagene Anfragen, Aufrufe von Vorschau- und Alltags-Routen, Systemzeilen ohne Wirkung. Fehlgeschlagene Anmeldungen und Begrenzungen (429) bleiben als Art «sicherheit». Zeilen der Art «audit» werden nie gelöscht. Das Audit-Log selbst bleibt unberührt.
-- Rückweg: drizzle/rueckweg/0148_aenderungsprotokoll.sql
ALTER TABLE "aktivitaet" ADD COLUMN "gruppe" text;--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD COLUMN "objekt_name" text;--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD COLUMN "beschreibung" text;--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD COLUMN "aenderung" jsonb;--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP CONSTRAINT "aktivitaet_art_check";--> statement-breakpoint
-- Fehlgeschlagene Anmeldungen und Begrenzungen: Sicherheitsereignisse statt Klicks
UPDATE "aktivitaet" SET "art" = 'sicherheit' WHERE "art" = 'anmeldung' AND "ergebnis" = 'fehler' AND "aktion" IN ('POST /api/auth/sign-in/username', 'POST /api/auth/two-factor/verify-totp', 'POST /api/auth/two-factor/verify-backup-code');--> statement-breakpoint
UPDATE "aktivitaet" SET "art" = 'sicherheit', "aktion" = '(begrenzt)' WHERE "art" = 'aktion' AND "status" = 429;--> statement-breakpoint
-- Was keine Änderung war
DELETE FROM "aktivitaet" WHERE "art" IN ('anmeldung', 'zugriff');--> statement-breakpoint
DELETE FROM "aktivitaet" WHERE "art" = 'aktion' AND ("ergebnis" = 'fehler' OR "status" IS NULL OR "status" NOT BETWEEN 200 AND 299);--> statement-breakpoint
-- Vorschau-, Prüf- und Alltags-Routen (die Parameter heissen im Schlüssel :p)
DELETE FROM "aktivitaet" WHERE "art" = 'aktion' AND regexp_replace("aktion", ':[A-Za-z0-9_]+', ':p', 'g') = ANY (ARRAY[
  'POST /api/auth/sign-in/username',
  'POST /api/auth/sign-out',
  'POST /api/auth/two-factor/verify-totp',
  'POST /api/auth/two-factor/verify-backup-code',
  'PATCH /api/v1/ich',
  'PUT /api/v1/ich/bild',
  'DELETE /api/v1/ich/bild',
  'POST /api/v1/ich/datenschutz',
  'PUT /api/v1/stufen/:p/anwesenheit/:p/kinder/:p',
  'PUT /api/v1/stufen/:p/anwesenheit/:p/leitende/:p',
  'PUT /api/v1/push-token',
  'PUT /api/v1/programme/:p/teilnahmen/:p',
  'PUT /api/v1/programme/:p/leitung',
  'POST /api/v1/chats/direkt',
  'POST /api/v1/chats/:p/nachrichten',
  'PUT /api/v1/chats/:p/gelesen',
  'POST /api/v1/admin/mitteilungen/vorschau',
  'POST /api/v1/admin/import/vorschau',
  'POST /api/v1/admin/rechte/gruppen/:p/rollen/vorschau',
  'POST /api/v1/lager/:p/benachrichtigungen/gelesen',
  'PUT /api/v1/ich/lager-benachrichtigungen',
  'POST /api/v1/lager/:p/aufgaben/schnell',
  'POST /api/v1/lager/:p/todos',
  'PATCH /api/v1/lager/:p/todos/:p',
  'DELETE /api/v1/lager/:p/todos/:p',
  'POST /api/v1/lager/:p/check/punkte',
  'PATCH /api/v1/lager/:p/check/punkte/:p',
  'DELETE /api/v1/lager/:p/check/punkte/:p',
  'PUT /api/v1/lager/:p/hoecks/:p/anwesende/:p',
  'DELETE /api/v1/lager/:p/hoecks/:p/anwesende/:p',
  'PUT /api/v1/lager/:p/erwaehnungen/:p/:p',
  'PUT /api/v1/lager/:p/pinnwand/gesehen',
  'PUT /api/v1/lager/:p/pinnwand/:p/gesehen',
  'PUT /api/v1/lager/:p/pinnwand/:p/umfrage/stimme',
  'DELETE /api/v1/lager/:p/pinnwand/:p/umfrage/stimme',
  'PUT /api/v1/lager/:p/reaktionen/:p/:p',
  'DELETE /api/v1/lager/:p/reaktionen/:p/:p',
  'POST /api/v1/lager/:p/eingang/status',
  'PUT /api/v1/lager/:p/abzaehlen',
  'POST /api/v1/lager/:p/schichtplan/vorschlag',
  'PUT /api/v1/lager/:p/anwesenheit/eigene',
  'PUT /api/v1/lager/:p/packliste/punkte/:p/zustand',
  'POST /api/v1/lager/:p/packliste/eigene',
  'PATCH /api/v1/lager/:p/packliste/eigene/:p',
  'DELETE /api/v1/lager/:p/packliste/eigene/:p',
  'POST /api/v1/termin-vorschlaege',
  'DELETE /api/v1/termin-vorschlaege/:p',
  'PUT /api/v1/anlaesse/:p/anmeldung',
  'DELETE /api/v1/anlaesse/:p/anmeldung',
  'POST /api/v1/raeume/:p/anfragen',
  'DELETE /api/v1/raeume/anfragen/:p',
  'POST /api/v1/redaktion/orte/vorschau',
  'POST /api/v1/laden/bestellungen',
  'DELETE /api/v1/laden/bestellungen/:p'
]);--> statement-breakpoint
-- Systemzeilen: nur Start, Lücken im Protokoll, Programm-Erinnerungen und Plattform-Mitteilungen per Push, Lager-Fristen; Fehler stehen im Betriebs-Log
DELETE FROM "aktivitaet" WHERE "art" = 'system' AND "aktion" NOT IN ('start', 'protokoll_luecke', 'push_versand:programm', 'push_versand:plattform') AND "aktion" NOT LIKE 'lager_fristen%';--> statement-breakpoint
DELETE FROM "aktivitaet" WHERE "art" = 'system' AND "ergebnis" = 'fehler' AND "aktion" <> 'protokoll_luecke';--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_art_check" CHECK ("aktivitaet"."art" in ('aktion', 'audit', 'system', 'sicherheit'));--> statement-breakpoint
ALTER TABLE "aktivitaet" DROP CONSTRAINT "aktivitaet_laenge_check";--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_laenge_check" CHECK (char_length("aktivitaet"."aktion") <= 200 and char_length("aktivitaet"."bereich") <= 60 and ("aktivitaet"."name" is null or char_length("aktivitaet"."name") <= 120) and ("aktivitaet"."fehler_code" is null or char_length("aktivitaet"."fehler_code") <= 60) and ("aktivitaet"."herkunft" is null or char_length("aktivitaet"."herkunft") <= 32) and ("aktivitaet"."geraet" is null or char_length("aktivitaet"."geraet") <= 40) and ("aktivitaet"."anfrage_id" is null or char_length("aktivitaet"."anfrage_id") <= 64) and ("aktivitaet"."gruppe" is null or char_length("aktivitaet"."gruppe") <= 30) and ("aktivitaet"."objekt_name" is null or char_length("aktivitaet"."objekt_name") <= 120) and ("aktivitaet"."beschreibung" is null or char_length("aktivitaet"."beschreibung") <= 300));--> statement-breakpoint
ALTER TABLE "aktivitaet" ADD CONSTRAINT "aktivitaet_aenderung_check" CHECK ("aktivitaet"."aenderung" is null or (jsonb_typeof("aktivitaet"."aenderung") = 'object' and char_length("aktivitaet"."aenderung"::text) <= 4000));--> statement-breakpoint
CREATE INDEX "audit_log_erstellt_am_idx" ON "audit_log" USING btree ("erstellt_am");--> statement-breakpoint
-- Eine Änderung durch eine Person steht jetzt als Zeile ihrer Anfrage (Satz, Felder, Name des Objekts, Rechte). Das Audit-Log spiegelt nur noch, was ohne Anfrage geschieht: Kommandozeile und System
CREATE OR REPLACE FUNCTION aktivitaet_aus_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.akteur_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  INSERT INTO aktivitaet (zeit, art, abteilung_id, akteur, aktion, bereich, objekt_typ, objekt_id, felder, ergebnis)
  VALUES (
    NEW.erstellt_am, 'audit', NEW.abteilung_id,
    CASE WHEN NEW.akteur_id = 'cli' THEN 'cli' ELSE 'system' END,
    left(NEW.aktion, 200), left(NEW.ziel_typ, 60), left(NEW.ziel_typ, 60), NEW.ziel_id,
    CASE WHEN jsonb_typeof(NEW.details) = 'object'
      THEN (SELECT array_agg(left(k, 60) ORDER BY k) FROM (SELECT jsonb_object_keys(NEW.details) AS k LIMIT 30) s)
    END,
    'erfolg'
  );
  RETURN NEW;
END
$$;
