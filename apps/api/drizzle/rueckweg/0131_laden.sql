-- Rückweg zu 0131_laden (#566), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0131_laden.sql
-- Danach den Code auf den Stand vor 0131 zurückstellen. Es gehen alle Artikel des Lädelis, die Übergabearten und alle Bestellungen verloren. Seiten mit dem Baustein «laden» vorher zurückziehen oder den Baustein entfernen: Der ältere Code kennt ihn nicht.
DROP TABLE "laden_bestellposition";
DROP TABLE "laden_bestellung";
DROP TABLE "laden_einstellung";
DROP TABLE "laden_artikel";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
