import { ortAnfrage } from "../../src/lager/wetter-ort.js";
import type { OrtTreffer } from "../../src/lager/wetter-geocoding.js";
import type { Wetterdienst } from "../../src/lager/wetter-openmeteo.js";

// Hilfen für die Tests des Wetters (#694): Der Wetterort kommt aus dem Lagerort, kein Test ruft den echten Dienst ab. Alle Namen sind erfunden.

// Die Spalten eines Lagers, dessen Ort schon aufgelöst ist (wie nach der Suche des Servers)
export const aufgeloest = (
  breite: number,
  laenge: number,
  ort = "Musterstadt",
) => ({
  ort,
  breite,
  laenge,
  wetterOrtSchluessel: ortAnfrage(ort, null)!.schluessel,
  wetterOrtName: `${ort}, Kanton Beispiel`,
  wetterOrtErgebnis: "gefunden" as const,
  wetterOrtVersuchAm: new Date(),
});

export const treffer = (p: Partial<OrtTreffer> = {}): OrtTreffer => ({
  name: "Musterstadt",
  breite: 47.3769,
  laenge: 8.5417,
  kanton: "Kanton Beispiel",
  bevoelkerung: 10_000,
  plz: ["9999"],
  ...p,
});

// Ein Wetterdienst aus Attrappen: Die Ortssuche findet jeden Ort an derselben Stelle
export const dienst = (
  holen: Wetterdienst["holen"],
  suchen: Wetterdienst["suchen"] = async () => [treffer()],
): Wetterdienst => ({ holen, suchen });
