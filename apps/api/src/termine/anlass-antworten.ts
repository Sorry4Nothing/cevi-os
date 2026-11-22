// Antworten einer Anmeldung gegen die Zusatzfelder des Anlasses prüfen (#443).
// Fehler tragen nur Schlüssel und Code, nie den Wert: Antworten können Personendaten sein und gehören nicht in Antwort, Log oder Audit.

export type FeldDefinition = {
  schluessel: string;
  typ: "text" | "ja_nein" | "auswahl";
  optionen: string[];
  pflicht: boolean;
};

export type Antworten = Record<string, string | boolean>;

export const ANTWORT_MAX_ZEICHEN = 500;
// Mehr Schlüssel als Felder gibt es nie (höchstens 20); die Eingabe lehnt grössere Objekte ab
export const MAX_ANTWORT_SCHLUESSEL = 20;

export type AntwortFehlerCode =
  "UNBEKANNT" | "PFLICHT" | "TYP" | "OPTION" | "ZU_LANG" | "STEUERZEICHEN";
export type AntwortFehler = { schluessel: string; code: AntwortFehlerCode };

// Steuerzeichen (auch Zeilenumbruch und Tabulator) und Formatzeichen wie Zeilentrenner: Ein Textfeld ist eine Zeile
const STEUERZEICHEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

// Prüft jede Antwort gegen ihr Feld. Gültige Antworten kommen bereinigt zurück (Text getrimmt, leere optionale Antworten fehlen); bei Fehlern gibt es keine Antworten
export function pruefeAntworten(
  felder: readonly FeldDefinition[],
  antworten: Record<string, unknown>,
): { antworten: Antworten } | { fehler: AntwortFehler[] } {
  const fehler: AntwortFehler[] = [];
  // Als Paare, dann Object.fromEntries: Ein Schlüssel wie constructor ist erlaubt (a-z0-9_) und wird so ein gewöhnlicher Eintrag (die Eingabe verwirft __proto__ schon vorher)
  const ok: [string, string | boolean][] = [];
  const nachSchluessel = new Map(felder.map((f) => [f.schluessel, f]));
  for (const schluessel of Object.keys(antworten)) {
    if (!nachSchluessel.has(schluessel))
      fehler.push({ schluessel, code: "UNBEKANNT" });
  }
  for (const feld of felder) {
    const wert = Object.hasOwn(antworten, feld.schluessel)
      ? antworten[feld.schluessel]
      : undefined;
    // Ein Feld ohne Antwort: null und undefined gleich; bei Text und Auswahl zählt auch leer
    const leer =
      wert === undefined ||
      wert === null ||
      (feld.typ !== "ja_nein" &&
        typeof wert === "string" &&
        wert.trim() === "");
    if (leer) {
      if (feld.pflicht)
        fehler.push({ schluessel: feld.schluessel, code: "PFLICHT" });
      continue;
    }
    if (feld.typ === "ja_nein") {
      if (typeof wert === "boolean") ok.push([feld.schluessel, wert]);
      else fehler.push({ schluessel: feld.schluessel, code: "TYP" });
      continue;
    }
    if (typeof wert !== "string") {
      fehler.push({ schluessel: feld.schluessel, code: "TYP" });
      continue;
    }
    if (STEUERZEICHEN.test(wert)) {
      fehler.push({ schluessel: feld.schluessel, code: "STEUERZEICHEN" });
      continue;
    }
    // Eine Auswahl gilt genau so, wie die Option geschrieben ist
    const text = feld.typ === "auswahl" ? wert : wert.trim();
    if (text.length > ANTWORT_MAX_ZEICHEN) {
      fehler.push({ schluessel: feld.schluessel, code: "ZU_LANG" });
    } else if (feld.typ === "auswahl" && !feld.optionen.includes(text)) {
      fehler.push({ schluessel: feld.schluessel, code: "OPTION" });
    } else {
      ok.push([feld.schluessel, text]);
    }
  }
  return fehler.length > 0 ? { fehler } : { antworten: Object.fromEntries(ok) };
}
