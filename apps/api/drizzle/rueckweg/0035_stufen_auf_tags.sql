-- Rückweg zu 0035_stufen_auf_tags (#332), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0035_stufen_auf_tags.sql
-- Danach den Code auf den Stand vor 0035 zurückstellen (Tabellen «stufe» und «rolle»).
-- Es gehen verloren: die Tag-Zeilen der Stufen samt ihren Zuordnungen, auch jener ohne Stufenrolle (Stand von 0033). Vorher umbenannte Tags behalten ihr Suffix.
DROP VIEW "programm_stufe_wirksam";
DROP VIEW "rolle";
DROP VIEW "stufe";
CREATE TABLE "stufe" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"abteilung_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kuerzel" text NOT NULL
);
CREATE TABLE "rolle" (
	"user_id" uuid NOT NULL,
	"stufe_id" uuid NOT NULL,
	"typ" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"prioritaet" integer,
	CONSTRAINT "rolle_user_id_stufe_id_pk" PRIMARY KEY("user_id","stufe_id"),
	CONSTRAINT "rolle_typ_check" CHECK ("rolle"."typ" in ('leitung', 'stufenleitung')),
	CONSTRAINT "rolle_prioritaet_check" CHECK ("rolle"."prioritaet" >= 1)
);
ALTER TABLE "stufe" ADD CONSTRAINT "stufe_abteilung_id_abteilung_id_fk" FOREIGN KEY ("abteilung_id") REFERENCES "public"."abteilung"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "rolle" ADD CONSTRAINT "rolle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "stufe_name_pro_abteilung" ON "stufe" USING btree ("abteilung_id",lower("name"));
INSERT INTO "stufe" ("id", "abteilung_id", "name", "kuerzel")
SELECT "id", "abteilung_id", "name", "kuerzel" FROM "tag" WHERE "typ" = 'stufe';
INSERT INTO "rolle" ("user_id", "stufe_id", "typ", "prioritaet", "erstellt_am")
SELECT p."user_id", p."tag_id", p."rolle", p."prioritaet", p."erstellt_am"
FROM "person_tag" p JOIN "tag" t ON t."id" = p."tag_id" AND t."typ" = 'stufe'
WHERE p."rolle" IN ('leitung', 'stufenleitung');
ALTER TABLE "rolle" ADD CONSTRAINT "rolle_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
-- Fremdschlüssel zurück auf «stufe»
ALTER TABLE "kind" DROP CONSTRAINT "kind_stufe_id_tag_id_fk";
ALTER TABLE "programm_eckdaten" DROP CONSTRAINT "programm_eckdaten_stufe_id_tag_id_fk";
ALTER TABLE "programm_stufe" DROP CONSTRAINT "programm_stufe_stufe_id_tag_id_fk";
ALTER TABLE "chat" DROP CONSTRAINT "chat_stufe_id_tag_id_fk";
ALTER TABLE "stufenlogo" DROP CONSTRAINT "stufenlogo_stufe_id_tag_id_fk";
ALTER TABLE "zeitregel" DROP CONSTRAINT "zeitregel_stufe_id_tag_id_fk";
ALTER TABLE "kind" ADD CONSTRAINT "kind_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "programm_eckdaten" ADD CONSTRAINT "programm_eckdaten_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "programm_stufe" ADD CONSTRAINT "programm_stufe_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "chat" ADD CONSTRAINT "chat_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stufenlogo" ADD CONSTRAINT "stufenlogo_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "zeitregel" ADD CONSTRAINT "zeitregel_stufe_id_stufe_id_fk" FOREIGN KEY ("stufe_id") REFERENCES "public"."stufe"("id") ON DELETE restrict ON UPDATE no action;
-- Die Stufen sind wieder Tabellenzeilen: ihre Tag-Zeilen und Zuordnungen fallen weg
DELETE FROM "person_tag" WHERE "tag_id" IN (SELECT "id" FROM "stufe");
DELETE FROM "tag" WHERE "id" IN (SELECT "id" FROM "stufe");
CREATE VIEW "programm_stufe_wirksam" AS
SELECT "programm_id", "stufe_id" FROM "programm_stufe"
UNION ALL
SELECT p."id", s."id"
FROM "programm" p
JOIN "stufe" s ON s."abteilung_id" = p."abteilung_id"
WHERE NOT EXISTS (SELECT 1 FROM "programm_stufe" ps WHERE ps."programm_id" = p."id");
-- Migrationsjournal: Eintrag von 0035 entfernen, damit sie erneut laufen kann
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
