-- Die Website zeigt Personen nach ihrer Rolle (Leitung oder Stufenleitung einer Stufe), nicht mehr nach einer Freigabe der Person (#610). Die Spalte aus 0132 entfällt; ihre Werte hat keine Regel mehr gelesen.
-- Rückweg: drizzle/rueckweg/0134_website_freigabe_entfernt.sql
ALTER TABLE "user" DROP COLUMN "website_freigabe_am";
