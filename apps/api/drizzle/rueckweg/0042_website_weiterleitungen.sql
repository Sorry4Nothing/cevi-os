-- Rückweg zu 0042_website_weiterleitungen (#356), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0042_website_weiterleitungen.sql
-- Danach den Code auf den Stand vor 0042 zurückstellen. Es gehen alle Weiterleitungen verloren; die erzeugten Dateien (weiterleitungen.caddy und die Rückfallseiten) bleiben in der Ausgabe liegen.
DROP TABLE "weiterleitung";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
