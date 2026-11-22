import { icon } from "./dom.js";

// Symbole des Website-Bereichs, die dom.js nicht kennt (24er Raster, Strich über CSS). Alles andere kommt aus icon().
// Ein String ist ein Pfad, sonst [Tag, Eigenschaften], wie in dom.js.
const SVG_NS = "http://www.w3.org/2000/svg";
const EIGENE = {
  griff: [
    ["circle", { cx: 9, cy: 6, r: 1.2 }],
    ["circle", { cx: 15, cy: 6, r: 1.2 }],
    ["circle", { cx: 9, cy: 12, r: 1.2 }],
    ["circle", { cx: 15, cy: 12, r: 1.2 }],
    ["circle", { cx: 9, cy: 18, r: 1.2 }],
    ["circle", { cx: 15, cy: 18, r: 1.2 }],
  ],
  zurueck: ["M19 12H5", "m11 6-6 6 6 6"],
  vorschau: [
    "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z",
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  bild: [
    ["rect", { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }],
    ["circle", { cx: 9, cy: 10, r: 1.6 }],
    "m4 17 5-4.5 3.5 3 3-2.5L20 16",
  ],
  hochladen: [
    "M12 16V5",
    "m7.5 9.5 4.5-4.5 4.5 4.5",
    "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  ],
  ablegen: ["M12 4v11", "m7.5 10.5 4.5 4.5 4.5-4.5", "M4 19h16"],
};

export function symbol(name) {
  const teile = EIGENE[name];
  if (!teile) return icon(name);
  const knoten = document.createElementNS(SVG_NS, "svg");
  knoten.setAttribute("class", "i");
  knoten.setAttribute("viewBox", "0 0 24 24");
  knoten.setAttribute("aria-hidden", "true");
  for (const teil of teile) {
    const [tagName, eigenschaften] =
      typeof teil === "string" ? ["path", { d: teil }] : teil;
    const form = document.createElementNS(SVG_NS, tagName);
    for (const [k, w] of Object.entries(eigenschaften)) {
      form.setAttribute(k, String(w));
    }
    knoten.append(form);
  }
  return knoten;
}

// Setzt eines dieser Symbole vor den Text eines Knopfes (knopf() kennt nur die Symbole aus dom.js)
export function mitSymbol(knopfEl, name) {
  knopfEl.prepend(symbol(name));
  return knopfEl;
}
