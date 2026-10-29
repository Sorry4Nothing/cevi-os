CREATE UNIQUE INDEX "meldung_offen_pro_person" ON "meldung" USING btree ("nachricht_id","gemeldet_von") WHERE "meldung"."erledigt_am" is null;--> statement-breakpoint
ALTER TABLE "meldung" ADD CONSTRAINT "meldung_kopie_nur_offen" CHECK ("meldung"."erledigt_am" is null or "meldung"."text_kopie" is null);--> statement-breakpoint
-- Textkopien nach spätestens 30 Tagen leeren, auch wenn die Meldung noch offen ist; die Meldung selbst bleibt (Aufbewahrung 12 Monate). Läuft mit den Rechten der API-Rolle, die meldung ändern darf
CREATE FUNCTION meldung_textkopien_aufraeumen() RETURNS bigint
LANGUAGE sql AS $$
  WITH geleert AS (
    UPDATE meldung SET text_kopie = NULL
    WHERE text_kopie IS NOT NULL AND erstellt_am < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) FROM geleert
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION meldung_textkopien_aufraeumen() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION meldung_textkopien_aufraeumen() TO cevi_os_api;
