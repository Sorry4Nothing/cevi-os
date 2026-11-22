import { el } from "./dom.js";

// Reiter «Kategorien» (Platzhalter aus #431). #434 (TA3) füllt diese Datei. Schnittstelle: siehe termine.js
export function zeige(bereich) {
  bereich.append(
    el("h2", { class: "tm-kategorien-titel" }, "Kategorien"),
    el(
      "p",
      { class: "leer" },
      "Die Zuordnung der Kategorien ist noch nicht verfügbar.",
    ),
  );
}
