// Bilder-Karussell (#559): ein Bildstreifen, der seitwärts läuft. Ohne Skript ist er ein Streifen zum Scrollen und Wischen, mit Skript (website/karussell.js) kommen Knöpfe, Stand und der Wechsel von selbst dazu.
// Nur Elemente und Attribute, die auch das Nachladen geschützter Bausteine kennt (knoten.js): Knöpfe und Symbole baut das Skript.
import type { HtmlKnoten } from "./rendern.js";

export const STIL_KARUSSELL = "/website/karussell.css";
export const SKRIPT_KARUSSELL = "/website/karussell.js";
// Grossansicht eines Bildes über der Seite; eigenes Modul, das auch Bild und Galerie nutzen
export const STIL_LICHTKASTEN = "/website/lichtkasten.css";
export const SKRIPT_LICHTKASTEN = "/website/lichtkasten.js";

const anzahlText = (n: number) => `${n} Bilder`;

// Die Bildunterschrift steht unter jedem Bild. Fehlt sie, zeigt das Karussell den Alt-Text; für Screenreader wäre er doppelt, darum dort verborgen
function mitUnterschrift(figur: HtmlKnoten): HtmlKnoten {
  if (typeof figur === "string") return figur;
  const kinder = figur.kinder ?? [];
  if (kinder.some((k) => typeof k !== "string" && k.tag === "figcaption")) {
    return figur;
  }
  // Das Bild steckt im Link zur Grossansicht
  const img = kinder
    .flatMap((k) => (typeof k === "string" ? [] : [k, ...(k.kinder ?? [])]))
    .find((k) => typeof k !== "string" && k.tag === "img");
  const alt = typeof img === "object" ? img.attr?.alt : undefined;
  if (typeof alt !== "string" || alt === "") return figur;
  return {
    ...figur,
    kinder: [
      ...kinder,
      {
        tag: "figcaption",
        attr: { "aria-hidden": "true" },
        kinder: [alt],
      },
    ],
  };
}

// figuren: die Bilder als <figure> (mindestens zwei)
export function karussell(figuren: HtmlKnoten[]): HtmlKnoten {
  return {
    tag: "div",
    attr: {
      class: "karussell",
      role: "group",
      "aria-roledescription": "Karussell",
      "aria-label": "Bilder",
    },
    kinder: [
      {
        tag: "ul",
        // Der Streifen scrollt seitwärts; mit der Tastatur erreichbar über die Links der Bilder
        attr: { class: "folien" },
        kinder: figuren.map((f) => ({
          tag: "li",
          attr: { class: "folie" },
          kinder: [mitUnterschrift(f)],
        })),
      },
      // Platz für die Leiste des Skripts: So springt nichts, wenn sie erscheint
      {
        tag: "p",
        attr: { class: "k-stand" },
        kinder: [anzahlText(figuren.length)],
      },
    ],
  };
}
