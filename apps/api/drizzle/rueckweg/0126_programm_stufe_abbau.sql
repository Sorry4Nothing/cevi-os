-- Rückweg zu 0126_programm_stufe_abbau (#449), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0126_programm_stufe_abbau.sql
-- Danach den Code auf den Stand vor 0126 zurückstellen. programm_stufe wird aus den Stufen-Tags in programm_tag gefüllt (ein Programm ohne Stufen-Tag bleibt ohne Zeile und gilt dann wie früher für alle Stufen);
-- programm_tag bleibt unverändert. Zuordnungen von Hand aus der Zeit davor lassen sich nicht von den Tags unterscheiden und gehen in dieser Form über.
CREATE TABLE "programm_stufe" (
	"programm_id" uuid NOT NULL,
	"stufe_id" uuid NOT NULL,
	CONSTRAINT "programm_stufe_programm_id_stufe_id_pk" PRIMARY KEY("programm_id","stufe_id")
);
ALTER TABLE "programm_stufe" ADD CONSTRAINT "programm_stufe_programm_id_programm_id_fk" FOREIGN KEY ("programm_id") REFERENCES "public"."programm"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "programm_stufe" ADD CONSTRAINT "programm_stufe_stufe_id_tag_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."tag"("id") ON DELETE restrict ON UPDATE no action;
INSERT INTO "programm_stufe" ("programm_id", "stufe_id")
SELECT pt."programm_id", pt."tag_id"
FROM "programm_tag" pt
JOIN "tag" t ON t."id" = pt."tag_id" AND t."typ" = 'stufe';
CREATE VIEW "programm_stufe_wirksam" AS
SELECT "programm_id", "stufe_id" FROM "programm_stufe"
UNION ALL
SELECT p."id", t."id"
FROM "programm" p
JOIN "tag" t ON t."abteilung_id" = p."abteilung_id" AND t."typ" = 'stufe'
WHERE NOT EXISTS (SELECT 1 FROM "programm_stufe" ps WHERE ps."programm_id" = p."id");
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
