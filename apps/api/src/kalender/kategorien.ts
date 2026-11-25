import type ICAL from "ical.js";

// Obergrenzen je Termin und Name: Der Feed ist Fremdtext, und die Namen landen in einer Spalte und einer Warnliste
const MAX_KATEGORIEN = 20;
const MAX_LAENGE = 100;

// Bereinigt rohe Kategorienamen aus einer Quelle (iCal oder Microsoft Graph): getrimmt, ohne Leere und zu lange, ohne Doppelte (Gross-/Kleinschreibung egal, die erste Schreibweise bleibt), höchstens MAX_KATEGORIEN
export function bereinigeKategorien(werte: unknown[]): string[] {
  const gesehen = new Set<string>();
  const namen: string[] = [];
  for (const wert of werte) {
    if (typeof wert !== "string") continue;
    const name = wert.trim();
    if (name === "" || name.length > MAX_LAENGE) continue;
    const schluessel = name.toLowerCase();
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    namen.push(name);
  }
  return namen.slice(0, MAX_KATEGORIEN);
}

// Kategorien eines Termins, getrimmt, ohne Doppelte (Gross-/Kleinschreibung egal, die erste Schreibweise bleibt).
// Aus dem iCal-Feld CATEGORIES; mit der Graph-Anbindung (#835) kommen die Kategorien von dort (graph-kategorien.ts), weil der Feed sie nicht zuverlässig enthält.
// Bei Serien gilt die Komponente der Instanz: eine Ausnahme mit eigener Kategorie zählt mit ihrer
export function kategorienVon(termin: ICAL.Event): string[] {
  // Mehrere Zeilen und kommagetrennte Werte (Maskierung «\,») löst ical.js auf
  return bereinigeKategorien(
    termin.component
      .getAllProperties("categories")
      .flatMap((eigenschaft) => eigenschaft.getValues()),
  );
}
