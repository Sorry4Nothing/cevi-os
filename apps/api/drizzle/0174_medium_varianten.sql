-- Varianten der Medienbilder (#868): je Bild die Breiten der kleineren Fassungen für srcset; die Dateien liegen im Speicher unter «<speicher_schluessel>-w<breite>». Bestehende Zeilen bleiben leer und liefern weiter das eine Bild, bis «medien-varianten» sie nachträgt.
-- Rückweg: drizzle/rueckweg/0174_medium_varianten.sql
ALTER TABLE "medium" ADD COLUMN "varianten" integer[] DEFAULT '{}' NOT NULL;
