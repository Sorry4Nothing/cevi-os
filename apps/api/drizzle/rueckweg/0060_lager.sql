-- Rückweg zu 0060_lager (#364), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0060_lager.sql
-- Danach den Code auf den Stand vor 0060 zurückstellen (ohne Lager-Modul).
-- Es gehen alle Lager und Mitgliedschaften verloren. Spätere Lager-Tabellen (ab 0061) zuerst zurückbauen: Sie hängen mit ON DELETE CASCADE am Lager, DROP TABLE "lager" scheitert sonst.
DROP TABLE "lager_mitglied";
DROP TABLE "lager";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
