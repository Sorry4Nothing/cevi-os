import { el } from "./dom.js";

// Reiter «Anlässe» (Platzhalter aus #431). #445 (TE4) füllt diese Datei. Schnittstelle: siehe termine.js
export function zeige(bereich) {
  bereich.append(
    el("h2", { class: "tm-anlaesse-titel" }, "Anlässe"),
    el("p", { class: "leer" }, "Die Anlässe sind noch nicht verfügbar."),
  );
}
