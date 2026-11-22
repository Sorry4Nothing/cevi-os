-- Rückweg zu 0063_lager_warteschlange (#367), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0063_lager_warteschlange.sql
-- Danach den Code auf den Stand vor 0063 zurückstellen (ohne Warteschlange).
-- Es gehen die gespeicherten Ergebnisse der Warteschlange verloren.
DROP TABLE "lager_client_op";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
