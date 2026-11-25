-- Teilnehmende hängen am Kind, wenn es eindeutig ist (#779): Wer ein Kind in der Verwaltung löscht, löscht damit auch die Namenskopien in den Lagern samt Einteilung, Abzählen, Anwesenheit und Fahrten (SR-41, Löschkonzept). Bisher stand kind_id nie, und der Fremdschlüssel setzte beim Löschen nur NULL.
-- Rückweg: drizzle/rueckweg/0161_teilnehmer_kind_cascade.sql
-- Zuordnung der bestehenden Zeilen: nur wenn Vor- und Nachname (ohne Beachtung der Gross- und Kleinschreibung) zu genau einem Kind der Abteilung des Lagers passen und genau ein Teilnehmender des Lagers so heisst; sonst bleibt kind_id leer (nie raten). Geburtsdatum gibt es bei Teilnehmenden nicht. kind_id kommt in keiner Antwort und in keinem Feed vor, die Version der Zeile bleibt darum gleich.
UPDATE "teilnehmer" t SET "kind_id" = z."kind_id"
FROM (
  SELECT t2."id" AS "teilnehmer_id", (array_agg(k."id"))[1] AS "kind_id"
  FROM "teilnehmer" t2
  INNER JOIN "lager" l ON l."id" = t2."lager_id"
  INNER JOIN "kind" k ON k."abteilung_id" = l."abteilung_id"
    AND lower(normalize(btrim(k."vorname"), NFC)) = lower(normalize(btrim(t2."vorname"), NFC))
    AND lower(normalize(btrim(k."nachname"), NFC)) = lower(normalize(btrim(t2."nachname"), NFC))
  WHERE t2."kind_id" IS NULL
    AND (
      SELECT count(*) FROM "teilnehmer" t3
      WHERE t3."lager_id" = t2."lager_id"
        AND lower(normalize(btrim(t3."vorname"), NFC)) = lower(normalize(btrim(t2."vorname"), NFC))
        AND lower(normalize(btrim(t3."nachname"), NFC)) = lower(normalize(btrim(t2."nachname"), NFC))
    ) = 1
  GROUP BY t2."id"
  HAVING count(k."id") = 1
) z
WHERE t."id" = z."teilnehmer_id";--> statement-breakpoint
ALTER TABLE "teilnehmer" DROP CONSTRAINT "teilnehmer_kind_id_kind_id_fk";--> statement-breakpoint
ALTER TABLE "teilnehmer" ADD CONSTRAINT "teilnehmer_kind_id_kind_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."kind"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teilnehmer_kind_idx" ON "teilnehmer" USING btree ("kind_id") WHERE "teilnehmer"."kind_id" is not null;
