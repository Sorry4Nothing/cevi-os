-- Aktivitätsprotokoll (#637): Tabelle aktivitaet, nur anfügen. Die API-Rolle liest und fügt an, ändert und löscht nie; die Löschung nach der Frist macht aktivitaet_aufraeumen() mit den Rechten des Besitzers (Untergrenzen im Code der Funktion, damit auch eine übernommene API-Rolle das Protokoll nicht leeren kann). Jede Zeile von audit_log erscheint zusätzlich als Zeile der Art «audit» (Trigger), damit die bestehenden Aktionen ohne Änderung der rund 130 Aufrufstellen im Protokoll stehen. Die Migration legt nur an, bestehende Tabellen bleiben unberührt.
-- Rückweg: drizzle/rueckweg/0139_aktivitaet.sql
CREATE TABLE "aktivitaet" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"zeit" timestamp with time zone DEFAULT now() NOT NULL,
	"art" text NOT NULL,
	"abteilung_id" uuid,
	"user_id" uuid,
	"akteur" text DEFAULT 'anonym' NOT NULL,
	"name" text,
	"rollen" text[] DEFAULT '{}'::text[] NOT NULL,
	"methode" text,
	"aktion" text NOT NULL,
	"bereich" text NOT NULL,
	"objekt_typ" text,
	"objekt_id" uuid,
	"felder" text[],
	"status" integer,
	"ergebnis" text NOT NULL,
	"fehler_code" text,
	"dauer_ms" integer,
	"herkunft" text,
	"geraet" text,
	"anfrage_id" text,
	"anzahl" integer,
	CONSTRAINT "aktivitaet_art_check" CHECK ("aktivitaet"."art" in ('aktion', 'anmeldung', 'audit', 'zugriff', 'system')),
	CONSTRAINT "aktivitaet_akteur_check" CHECK ("aktivitaet"."akteur" in ('person', 'anonym', 'cli', 'system')),
	CONSTRAINT "aktivitaet_ergebnis_check" CHECK ("aktivitaet"."ergebnis" in ('erfolg', 'fehler')),
	CONSTRAINT "aktivitaet_laenge_check" CHECK (char_length("aktivitaet"."aktion") <= 200 and char_length("aktivitaet"."bereich") <= 60 and ("aktivitaet"."name" is null or char_length("aktivitaet"."name") <= 120) and ("aktivitaet"."fehler_code" is null or char_length("aktivitaet"."fehler_code") <= 60) and ("aktivitaet"."herkunft" is null or char_length("aktivitaet"."herkunft") <= 32) and ("aktivitaet"."geraet" is null or char_length("aktivitaet"."geraet") <= 40) and ("aktivitaet"."anfrage_id" is null or char_length("aktivitaet"."anfrage_id") <= 64))
);
--> statement-breakpoint
CREATE INDEX "aktivitaet_zeit_idx" ON "aktivitaet" USING btree ("zeit" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "aktivitaet_user_idx" ON "aktivitaet" USING btree ("user_id","zeit" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "aktivitaet_aktion_idx" ON "aktivitaet" USING btree ("aktion","zeit" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "aktivitaet_bereich_idx" ON "aktivitaet" USING btree ("bereich","zeit" DESC NULLS LAST);--> statement-breakpoint
-- Nur lesen und anfügen (wie audit_log)
REVOKE UPDATE, DELETE ON "aktivitaet" FROM cevi_os_api;--> statement-breakpoint
CREATE FUNCTION aktivitaet_aufraeumen(tage integer, max_zeilen integer) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH alt AS (
    DELETE FROM aktivitaet WHERE zeit < now() - make_interval(days => greatest(tage, 7)) RETURNING 1
  ), ueber AS (
    DELETE FROM aktivitaet WHERE id <= (SELECT id FROM aktivitaet ORDER BY id DESC OFFSET greatest(max_zeilen, 10000) LIMIT 1) RETURNING 1
  )
  SELECT (SELECT count(*) FROM alt) + (SELECT count(*) FROM ueber)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION aktivitaet_aufraeumen(integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION aktivitaet_aufraeumen(integer, integer) TO cevi_os_api;--> statement-breakpoint
-- Eine Zeile audit_log wird eine Zeile «audit»: nur Namen der Felder aus details, nie Werte; der Name der handelnden Person als Schnappschuss, wenn es ein Konto ist («cli» und «system» sind keine Konten)
CREATE FUNCTION aktivitaet_aus_audit() RETURNS trigger
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
CREATE TRIGGER aktivitaet_aus_audit AFTER INSERT ON "audit_log" FOR EACH ROW EXECUTE FUNCTION aktivitaet_aus_audit();
