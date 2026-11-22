import type ICAL from "ical.js";

// Obergrenzen je Termin und Name: Der Feed ist Fremdtext, und die Namen landen in einer Spalte und einer Warnliste
const MAX_KATEGORIEN = 20;
const MAX_LAENGE = 100;

// Kategorien eines Termins, getrimmt, ohne Doppelte (Gross-/Kleinschreibung egal, die erste Schreibweise bleibt).
// Heute aus dem iCal-Feld CATEGORIES; eine spätere Quelle (Microsoft Graph) tauscht nur diese Funktion.
// Bei Serien gilt die Komponente der Instanz: eine Ausnahme mit eigener Kategorie zählt mit ihrer
export function kategorienVon(termin: ICAL.Event): string[] {
  const gesehen = new Set<string>();
  const namen: string[] = [];
  // Mehrere Zeilen und kommagetrennte Werte (Maskierung «\,») löst ical.js auf
  for (const eigenschaft of termin.component.getAllProperties("categories")) {
    for (const wert of eigenschaft.getValues()) {
      if (typeof wert !== "string") continue;
      const name = wert.trim();
      if (name === "" || name.length > MAX_LAENGE) continue;
      const schluessel = name.toLowerCase();
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      namen.push(name);
    }
  }
  return namen.slice(0, MAX_KATEGORIEN);
}
