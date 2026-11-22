import { el } from "./dom.js";

// Platzhalter (#353). #358 füllt diese Datei: Editor mit Bausteinen, Vorschau, Veröffentlichen und Versionen. Schnittstelle: siehe website.js
export function zeige(bereich) {
  bereich.append(
    el("p", { class: "leer" }, "Der Editor ist noch nicht verfügbar."),
  );
}
