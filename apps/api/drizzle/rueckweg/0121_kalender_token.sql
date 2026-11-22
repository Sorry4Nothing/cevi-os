-- Rückweg zu 0121_kalender_token (#437), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0121_kalender_token.sql
-- Danach den Code auf den Stand vor 0121 zurückstellen. Es gehen alle persönlichen ICS-Links verloren: Abonnierte Kalender erhalten 404, bis die Personen einen neuen Link erzeugen.
-- Spätere Termin-Tabellen (ab 0122) zeigen nicht auf diese Tabelle.
DROP TABLE "kalender_token";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
