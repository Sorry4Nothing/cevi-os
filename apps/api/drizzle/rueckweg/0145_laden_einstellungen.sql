-- Rückweg zu 0145_laden_einstellungen (#642), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0145_laden_einstellungen.sql
-- Danach den Code auf den Stand vor 0145 zurückstellen. Verloren gehen alle Regeln und Texte des Lädelis ausser den Übergabearten; die Vorgaben gelten dann wieder fest im Code. Gibt es Bestellpositionen mit einer Menge über 10, bricht der Rückweg ab, ohne etwas zu ändern: Setze die Menge dieser Positionen vorher von Hand (die Summe der Bestellung bleibt dabei, wie sie war) oder lass die Grenze auf 99 stehen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "laden_bestellposition" WHERE "menge" > 10) THEN
    RAISE EXCEPTION 'Rückweg 0145 abgebrochen: Es gibt Bestellpositionen mit einer Menge über 10.';
  END IF;
END
$$;
ALTER TABLE "laden_bestellposition" DROP CONSTRAINT "laden_bestellposition_menge_check";
ALTER TABLE "laden_bestellposition" ADD CONSTRAINT "laden_bestellposition_menge_check" CHECK ("laden_bestellposition"."menge" between 1 and 10);
ALTER TABLE "laden_einstellung" DROP CONSTRAINT "laden_einstellung_texte_check";
ALTER TABLE "laden_einstellung" DROP CONSTRAINT "laden_einstellung_grenzen_check";
ALTER TABLE "laden_einstellung" DROP COLUMN "geschlossen_text";
ALTER TABLE "laden_einstellung" DROP COLUMN "bedingungen";
ALTER TABLE "laden_einstellung" DROP COLUMN "uebergabehinweis";
ALTER TABLE "laden_einstellung" DROP COLUMN "bestaetigung";
ALTER TABLE "laden_einstellung" DROP COLUMN "zahlungsart";
ALTER TABLE "laden_einstellung" DROP COLUMN "bezahlhinweis";
ALTER TABLE "laden_einstellung" DROP COLUMN "mindest_rappen";
ALTER TABLE "laden_einstellung" DROP COLUMN "max_offene";
ALTER TABLE "laden_einstellung" DROP COLUMN "max_positionen";
ALTER TABLE "laden_einstellung" DROP COLUMN "max_menge";
ALTER TABLE "laden_einstellung" DROP COLUMN "preise_oeffentlich";
ALTER TABLE "laden_einstellung" DROP COLUMN "schnell_dazu";
ALTER TABLE "laden_einstellung" DROP COLUMN "bestellen_offen";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
