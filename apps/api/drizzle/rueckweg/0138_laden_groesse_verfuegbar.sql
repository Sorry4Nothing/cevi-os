-- Rückweg zu 0138_laden_groesse_verfuegbar (#629), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0138_laden_groesse_verfuegbar.sql
-- Danach den Code auf den Stand vor 0138 zurückstellen. Verloren geht nur, welche Grössen als nicht verfügbar gemeldet waren: Mit dem alten Code sind sie danach wieder bestellbar. Ein Artikel, dessen Grössen alle gemeldet waren, bekommt vorher den Stand «nicht verfügbar», damit er nicht plötzlich bestellbar wird.
UPDATE "laden_artikel" SET "verfuegbar" = false WHERE cardinality("varianten") > 0 AND "varianten" <@ "nicht_verfuegbar";--> statement-breakpoint
ALTER TABLE "laden_artikel" DROP CONSTRAINT "laden_artikel_nicht_verfuegbar_check";--> statement-breakpoint
ALTER TABLE "laden_artikel" DROP COLUMN "nicht_verfuegbar";--> statement-breakpoint
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
