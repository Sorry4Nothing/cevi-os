-- Rückweg zu 0123_anlass (#442), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0123_anlass.sql
-- Danach den Code auf den Stand vor 0123 zurückstellen. Es gehen alle Anlässe und ihre Zusatzfelder verloren; die Anlassseiten der Website bleiben (sie verlieren nur den Verweis).
-- Spätere Tabellen, die auf anlass zeigen (ab 0124, Anmeldungen), zuerst zurückbauen.
DROP TABLE "anlass_feld";
DROP TABLE "anlass";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
