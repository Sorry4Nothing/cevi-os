-- Rückweg zu 0069_lager_aufgaben_details (#373), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0069_lager_aufgaben_details.sql
-- Danach den Code auf den Stand vor 0069 zurückstellen (ohne Aufgaben-Details).
-- Es gehen alle Checkpunkte, Links und Stichworte der Aufgaben verloren; die Aufgaben selbst bleiben.
DROP TABLE "aufgabe_stichwort";
DROP TABLE "aufgabe_link";
DROP TABLE "aufgabe_checkpunkt";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
