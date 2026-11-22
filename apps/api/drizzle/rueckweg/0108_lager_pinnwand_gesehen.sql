-- Rückweg zu 0108_lager_pinnwand_gesehen (#520), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0108_lager_pinnwand_gesehen.sql
-- Danach den Code auf den Stand vor 0108 zurückstellen.
-- Es gehen alle «gesehen»-Einträge verloren.
DROP TABLE "pinnwand_gesehen";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
