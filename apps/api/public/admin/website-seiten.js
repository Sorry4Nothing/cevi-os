import { el } from "./dom.js";

// Platzhalter (#353). #357 füllt diese Datei: Seitenliste und Einstellungen. Schnittstelle: siehe website.js
export function zeige(bereich) {
  bereich.append(
    el("p", { class: "leer" }, "Die Seitenliste ist noch nicht verfügbar."),
  );
}
