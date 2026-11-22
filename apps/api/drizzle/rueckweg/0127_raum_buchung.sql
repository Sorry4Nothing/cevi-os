-- Rückweg zu 0127_raum_buchung (#447), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0127_raum_buchung.sql
-- Danach den Code auf den Stand vor 0127 zurückstellen. Es gehen alle Raumanfragen und Buchungen verloren; die Räume (0125) bleiben. Die Erweiterung btree_gist bleibt stehen (andere Teile könnten sie brauchen).
DROP TABLE "raum_buchung";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
