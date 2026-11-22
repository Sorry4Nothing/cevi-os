-- Rückweg zu 0075_lager_erwaehnungen (#380), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0075_lager_erwaehnungen.sql
-- Danach den Code auf den Stand vor 0075 zurückstellen (ohne Erwähnungen).
-- Es gehen alle Erwähnungen verloren (ob erledigt, welche Aufgabe daraus entstand); die Aufgaben bleiben, ihre Spalte quelle behält den Wert «erwaehnung:<id>» ohne Ziel.
DROP TABLE "erwaehnung";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
