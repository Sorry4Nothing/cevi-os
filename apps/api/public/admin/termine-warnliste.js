import { el } from "./dom.js";

// Reiter «Warnliste» (Platzhalter aus #431). #433 (TA2) füllt diese Datei. Schnittstelle: siehe termine.js
export function zeige(bereich) {
  bereich.append(
    el("h2", { class: "tm-warnliste-titel" }, "Warnliste"),
    el("p", { class: "leer" }, "Die Warnliste ist noch nicht verfügbar."),
  );
}
