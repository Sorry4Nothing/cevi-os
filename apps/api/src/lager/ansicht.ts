import type { lager } from "../db/schema.js";

// Was eine Route vom Lager zeigt: nie die ganze Zeile, damit eine neue Spalte nicht still nach aussen geht (anlassId und uebung folgen mit ihren Issues)
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
    farbe: zeile.farbe,
    logoMediumId: zeile.logoMediumId,
  };
}
