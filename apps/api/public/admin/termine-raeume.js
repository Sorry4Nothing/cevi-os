import { el } from "./dom.js";

// Reiter «Räume» (Platzhalter aus #431). #446 und #447 (TG1, TG2; warten auf das OK des Nutzers) füllt diese Datei. Schnittstelle: siehe termine.js
export function zeige(bereich) {
  bereich.append(
    el("h2", { class: "tm-raeume-titel" }, "Räume"),
    el("p", { class: "leer" }, "Die Räume sind noch nicht verfügbar."),
  );
}
