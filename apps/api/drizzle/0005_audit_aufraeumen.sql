-- Löschen nach 24 Monaten: Die API-Rolle darf audit_log nicht löschen, diese Funktion läuft mit den Rechten des Tabellenbesitzers
CREATE FUNCTION audit_log_aufraeumen() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH geloescht AS (
    DELETE FROM audit_log WHERE erstellt_am < now() - interval '24 months' RETURNING 1
  )
  SELECT count(*) FROM geloescht
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_log_aufraeumen() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_log_aufraeumen() TO cevi_os_api;
