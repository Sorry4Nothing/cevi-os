-- Rückweg zu 0065_lager_benachrichtigungen (#369), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0065_lager_benachrichtigungen.sql
-- Danach den Code auf den Stand vor 0065 zurückstellen (ohne Benachrichtigungen des Lagers).
-- Es gehen alle Benachrichtigungen und die Schalter der Personen verloren.
DROP TABLE "lager_benachrichtigung_einstellung";
DROP TABLE "lager_benachrichtigung";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
