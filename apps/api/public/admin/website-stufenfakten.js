import { el } from "./dom.js";

// Platzhalter (#353). #355 füllt diese Datei: Stufenfelder je Datum. Schnittstelle: siehe website.js
export function zeige(bereich) {
  bereich.append(
    el("p", { class: "leer" }, "Die Stufenfelder sind noch nicht verfügbar."),
  );
}
