ALTER TABLE "programm" ALTER COLUMN "sichtbarkeit" SET DEFAULT 'eltern';--> statement-breakpoint
CREATE VIEW "programm_stufe_wirksam" AS
SELECT "programm_id", "stufe_id" FROM "programm_stufe"
UNION ALL
SELECT p."id", s."id"
FROM "programm" p
JOIN "stufe" s ON s."abteilung_id" = p."abteilung_id"
WHERE NOT EXISTS (SELECT 1 FROM "programm_stufe" ps WHERE ps."programm_id" = p."id");
