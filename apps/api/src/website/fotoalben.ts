import { el, symbol, type HtmlKnoten } from "./rendern.js";

// Baustein «fotoalben» (#690): die Fotos der Abteilung aus Flickr, nur für angemeldete Personen.
// Im HTML steht nur ein leerer Behälter (Klasse «fotos»; geschützt nachgeladen kennt knoten.js nur Klassen) und der Hinweis für Browser ohne Skript: Alben, Titel und Bilder stehen nie in der erzeugten Datei, denn die Seite ist statisch und für alle gleich. Das Skript (public/website/fotos.js) fragt nach dem Laden unseren Server (GET /api/v1/fotos/alben) und zeigt ohne Sitzung «Nur angemeldet sichtbar» mit dem Link zur Anmeldung. Die Bilder kommen von unserem Server, nie von Flickr (img-src 'self').
// Stil: public/website/fotos.css. Die Grossansicht ist lichtkasten.js (Pfeiltasten, Esc, Wischen).

export const STIL_FOTOS = "/website/fotos.css";
export const SKRIPT_FOTOS = "/website/fotos.js";

export function rendereFotoalben(): HtmlKnoten {
  return el(
    "div",
    { class: "fotos" },
    el(
      "noscript",
      undefined,
      el(
        "div",
        { class: "band wa" },
        symbol("warnung"),
        el(
          "div",
          { class: "text" },
          el(
            "strong",
            undefined,
            "Zum Anzeigen braucht diese Seite JavaScript.",
          ),
          "Schalte es im Browser ein und lade die Seite neu.",
        ),
      ),
    ),
  );
}
