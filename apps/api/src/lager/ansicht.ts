import type { lager } from "../db/schema.js";
import { wetterOrt } from "./wetter-ort.js";

// Was eine Route vom Lager zeigt: nie die ganze Zeile, damit eine neue Spalte nicht still nach aussen geht (anlassId folgt mit seinem Issue)
export function lagerAnsicht(zeile: typeof lager.$inferSelect) {
  return {
    id: zeile.id,
    titel: zeile.titel,
    von: zeile.von,
    bis: zeile.bis,
    vorbereitungAb: zeile.vorbereitungAb,
    ort: zeile.ort,
    adresse: zeile.adresse,
    status: zeile.status,
    uebung: zeile.uebung,
    farbe: zeile.farbe,
    logoMediumId: zeile.logoMediumId,
    // Stand der Ortssuche für das Wetter (#694): kein Ort, offen, gefunden (mit Name), nicht gefunden, nicht eindeutig, Dienst nicht erreichbar
    wetterOrt: wetterOrt(zeile),
  };
}
