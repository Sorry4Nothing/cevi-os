-- Rückweg zu 0124_anlass_anmeldung (#443), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0124_anlass_anmeldung.sql
-- Danach den Code auf den Stand vor 0124 zurückstellen. Es gehen alle Anmeldungen zu Anlässen und ihre Antworten verloren; die Anlässe und ihre Zusatzfelder (0123) bleiben.
DROP TABLE "anlass_anmeldung";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
