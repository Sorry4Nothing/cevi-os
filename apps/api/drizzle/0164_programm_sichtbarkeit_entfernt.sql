-- Die alte Spalte «programm.sichtbarkeit» (intern, leitende, eltern) fällt weg (#807). Wer einen Termin sieht, entscheiden allein die Tags (programm_tag) und die Sichtbarkeit des Anlasses.
-- Wirkung auf bestehende Zeilen: Termine mit «intern» (Altlast: 0002 setzte den Vorgabewert «intern», 0030 änderte ihn ohne Nachtrag) erscheinen danach wie alle anderen, «leitende» sehen auch Eltern über die Stufe ihres Kindes. Die Daten werden nicht angepasst.
-- Das Recht «programm.intern_sehen» fehlt im Katalog; Zeilen mit diesem Namen in den Rechtetabellen bleiben stehen und geben nichts (fail-closed).
-- Rückweg: drizzle/rueckweg/0164_programm_sichtbarkeit_entfernt.sql
ALTER TABLE "programm" DROP CONSTRAINT "programm_sichtbarkeit_check";--> statement-breakpoint
ALTER TABLE "programm" DROP COLUMN "sichtbarkeit";
