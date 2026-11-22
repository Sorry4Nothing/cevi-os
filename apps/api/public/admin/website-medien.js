import { el } from "./dom.js";

// Platzhalter (#353). #359 füllt diese Datei: Medienbibliothek mit Alt-Text. Schnittstelle: siehe website.js
export function zeige(bereich) {
  bereich.append(
    el(
      "p",
      { class: "leer" },
      "Die Medienbibliothek ist noch nicht verfügbar.",
    ),
  );
}
