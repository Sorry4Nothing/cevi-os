-- Rückweg zu 0101_bearbeiter_ohne_alle_seiten (#426), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0101_bearbeiter_ohne_alle_seiten.sql
-- Danach den Code auf den Stand vor 0101 zurückstellen (Rolle «Redaktion» als Zeile ohne objekt_id).
-- Jede Person mit einer Plattformrolle, die «seiten.bearbeiten» trägt, bekommt wieder eine Zeile «alle Seiten». Die Vergaben in person_plattform_rolle bleiben (0100 räumt sie beim eigenen Rückweg ab).
-- Was die Migration aus einem Team gemacht hat, wird nicht wieder zum Team: Die Mitglieder von damals sind einzelne Personen mit einer Zeile.
ALTER TABLE "bearbeiter" ALTER COLUMN "objekt_id" DROP NOT NULL;
INSERT INTO "bearbeiter" ("abteilung_id", "objekt_typ", "objekt_id", "user_id") SELECT DISTINCT r."abteilung_id", 'seite', NULL::uuid, pr."user_id" FROM "person_plattform_rolle" pr INNER JOIN "plattform_rolle" r ON r."id" = pr."rolle_id" INNER JOIN "plattform_rolle_recht" rr ON rr."rolle_id" = r."id" AND rr."recht" = 'seiten.bearbeiten' ON CONFLICT ON CONSTRAINT "bearbeiter_eindeutig" DO NOTHING;
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
