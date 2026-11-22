-- Rückweg zu 0087_lager_einkauf (#392), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0087_lager_einkauf.sql
-- Danach den Code auf den Stand vor 0087 zurückstellen (ohne Einkaufsliste).
-- Es gehen alle Einkaufsartikel, der Artikelstamm und die Vorschläge verloren.
DROP TABLE "einkauf_vorschlag";
DROP TABLE "einkauf_artikelstamm";
DROP TABLE "einkauf_artikel";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
