-- Ruhige Ressorts (#520): ressort.ruhig kennzeichnet ein Ressort, das gerade nichts zu tun hat (die Apps blenden es in Listen aus oder grau). Vorgabe false: Bestehende Ressorts bleiben unverändert.
-- Rückweg (Migrationen laufen nur vorwärts): drizzle/rueckweg/0105_lager_ressort_ruhig.sql, als Besitzer der Datenbank in einer Transaktion: psql -1 -f rueckweg/0105_lager_ressort_ruhig.sql
--   Es geht nur die Kennzeichnung verloren.
ALTER TABLE "ressort" ADD COLUMN "ruhig" boolean DEFAULT false NOT NULL;
