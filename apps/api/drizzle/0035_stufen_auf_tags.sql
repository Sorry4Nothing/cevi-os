-- Stufen werden Tags vom Typ «stufe» (#332). Die Stufen-ID bleibt die Tag-ID, die Rollen «leitung» und «stufenleitung» werden Zuordnungen mit Rolle (person_tag).
-- Die Tabellen «stufe» und «rolle» gibt es danach als Sichten gleichen Namens und gleicher Spalten (Kompatibilitätsschicht): Lesen und Schreiben der bestehenden Routen und Apps bleiben unverändert. Beide Sichten sind einfach und damit ohne Trigger beschreibbar.
-- Rückweg: Datei rueckweg/0035_stufen_auf_tags.sql im selben Ordner (von Hand, in einer Transaktion; Migrationen laufen sonst nur vorwärts).
--
-- Kollision: Der Name eines Tags ist pro Abteilung über alle Typen eindeutig. Ein bestehender Tag, dessen Name einer Stufe gleicht, bekommt ein Suffix mit Typ und ID-Anfang; der Name der Stufe bleibt, wie die Apps ihn kennen.
UPDATE "tag" t
SET "name" = t."name" || ' (' || t."typ" || ', ' || left(t."id"::text, 8) || ')'
WHERE EXISTS (
  SELECT 1 FROM "stufe" s
  WHERE s."abteilung_id" = t."abteilung_id" AND lower(s."name") = lower(t."name")
);--> statement-breakpoint
INSERT INTO "tag" ("id", "abteilung_id", "typ", "name", "kuerzel")
SELECT "id", "abteilung_id", 'stufe', "name", "kuerzel" FROM "stufe";--> statement-breakpoint
INSERT INTO "person_tag" ("user_id", "tag_id", "rolle", "prioritaet", "erstellt_am")
SELECT "user_id", "stufe_id", "typ", "prioritaet", "erstellt_am" FROM "rolle";--> statement-breakpoint
-- Verlustfrei: jede Zeile steht mit gleicher ID und gleichen Werten im Ziel, sonst bricht die Migration ab und nichts ändert sich
DO $$
BEGIN
  IF (SELECT count(*) FROM "stufe" s JOIN "tag" t
        ON t."id" = s."id" AND t."typ" = 'stufe' AND t."abteilung_id" = s."abteilung_id"
       AND t."name" = s."name" AND t."kuerzel" = s."kuerzel")
     <> (SELECT count(*) FROM "stufe") THEN
    RAISE EXCEPTION 'Stufen nicht vollständig auf Tags übertragen';
  END IF;
  IF (SELECT count(*) FROM "rolle" r JOIN "person_tag" p
        ON p."user_id" = r."user_id" AND p."tag_id" = r."stufe_id" AND p."rolle" = r."typ"
       AND p."prioritaet" IS NOT DISTINCT FROM r."prioritaet" AND p."erstellt_am" = r."erstellt_am")
     <> (SELECT count(*) FROM "rolle") THEN
    RAISE EXCEPTION 'Rollen nicht vollständig auf Zuordnungen übertragen';
  END IF;
END
$$;--> statement-breakpoint
-- Die Sicht der wirksamen Programm-Stufen hängt an «stufe» und entsteht unten neu, direkt auf den Tags
DROP VIEW "programm_stufe_wirksam";--> statement-breakpoint
ALTER TABLE "kind" DROP CONSTRAINT "kind_stufe_id_stufe_id_fk";--> statement-breakpoint
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_stufe_id_stufe_id_fk";--> statement-breakpoint
ALTER TABLE "programm_stufe" DROP CONSTRAINT "programm_stufe_stufe_id_stufe_id_fk";--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chat_stufe_id_stufe_id_fk";--> statement-breakpoint
ALTER TABLE "stufenlogo" DROP CONSTRAINT "stufenlogo_stufe_id_stufe_id_fk";--> statement-breakpoint
ALTER TABLE "zeitregel" DROP CONSTRAINT "zeitregel_stufe_id_stufe_id_fk";--> statement-breakpoint
DROP TABLE "rolle";--> statement-breakpoint
DROP TABLE "stufe";--> statement-breakpoint
ALTER TABLE "kind" ADD CONSTRAINT "kind_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programm_stufe" ADD CONSTRAINT "programm_stufe_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stufenlogo" ADD CONSTRAINT "stufenlogo_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeitregel" ADD CONSTRAINT "zeitregel_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Kompatibilitätsschicht. WITH CHECK OPTION: Über die Sichten entstehen nur Stufen und Stufenrollen. «typ» der Sicht «stufe» hat den Vorgabewert «stufe», damit ein INSERT ohne Typ einen Stufen-Tag anlegt
CREATE VIEW "stufe" AS
SELECT "id", "abteilung_id", "name", "kuerzel", "typ" FROM "tag" WHERE "typ" = 'stufe'
WITH CHECK OPTION;--> statement-breakpoint
ALTER VIEW "stufe" ALTER COLUMN "typ" SET DEFAULT 'stufe';--> statement-breakpoint
CREATE VIEW "rolle" AS
SELECT "user_id", "tag_id" AS "stufe_id", "rolle" AS "typ", "prioritaet", "erstellt_am"
FROM "person_tag"
WHERE "rolle" IN ('leitung', 'stufenleitung')
  AND "tag_id" IN (SELECT "id" FROM "tag" WHERE "typ" = 'stufe')
WITH CHECK OPTION;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stufe", "rolle" TO cevi_os_api;--> statement-breakpoint
CREATE VIEW "programm_stufe_wirksam" AS
SELECT "programm_id", "stufe_id" FROM "programm_stufe"
UNION ALL
SELECT p."id", t."id"
FROM "programm" p
JOIN "tag" t ON t."abteilung_id" = p."abteilung_id" AND t."typ" = 'stufe'
WHERE NOT EXISTS (SELECT 1 FROM "programm_stufe" ps WHERE ps."programm_id" = p."id");
