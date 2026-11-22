import { el } from "./dom.js";

// Reiter «Vorschläge» (Platzhalter aus #431). #441 (TD3) füllt diese Datei. Schnittstelle: siehe termine.js
export function zeige(bereich) {
  bereich.append(
    el("h2", { class: "tm-vorschlaege-titel" }, "Vorschläge"),
    el(
      "p",
      { class: "leer" },
      "Die Terminvorschläge sind noch nicht verfügbar.",
    ),
  );
}
