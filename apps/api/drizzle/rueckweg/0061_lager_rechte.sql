-- Rückweg zu 0061_lager_rechte (#365), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0061_lager_rechte.sql
-- Danach den Code auf den Stand vor 0061 zurückstellen (ohne einstellbare Rechte; es gilt die Standardmatrix).
-- Es gehen alle Einstellungen der Rechte verloren. Lager und Mitglieder bleiben.
DROP TABLE "lager_rolle_recht";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
