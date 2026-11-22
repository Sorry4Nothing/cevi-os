-- Rückweg zu 0100_plattformrollen (#423), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0100_plattformrollen.sql
-- Danach den Code auf den Stand vor 0100 zurückstellen (ohne Plattformrollen; die Rechte der Stufenleitung, von «bearbeiter» und der Abteilungsleitung bleiben).
-- Es gehen alle Rollen, ihre Rechte, ihre Vergaben und die Entwickler verloren. Konten und Abteilungen bleiben.
DROP TABLE "person_plattform_rolle";
DROP TABLE "plattform_rolle_recht";
DROP TABLE "plattform_rolle";
DROP TABLE "plattform_entwickler";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
