// Kleine Bausteine der Oberfläche für die Skripte der Website (#529): Elemente ohne innerHTML und die Symbole des Designs.
// Text kommt immer als Textknoten, die Pfade der Symbole sind feste Werte aus diesem Modul.

const SVG = "http://www.w3.org/2000/svg";

const SYMBOLE = {
  info: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["path", { d: "M12 11v5M12 8h.01" }],
  ],
  warnung: [
    ["path", { d: "M12 3 2.5 20h19L12 3z" }],
    ["path", { d: "M12 10v4M12 17h.01" }],
  ],
  schloss: [
    ["rect", { x: 5, y: 11, width: 14, height: 9, rx: 2 }],
    ["path", { d: "M8 11V8a4 4 0 0 1 8 0v3" }],
  ],
  nochmals: [["path", { d: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" }]],
};

export function symbol(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attr] of SYMBOLE[name]) {
    const e = document.createElementNS(SVG, tag);
    for (const [n, w] of Object.entries(attr)) e.setAttribute(n, String(w));
    svg.append(e);
  }
  return svg;
}

export function el(tag, klasse, ...kinder) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  e.append(...kinder);
  return e;
}

// Ein Band wie im Design: Symbol, fetter Titel, Text. art: "" (Info), "fe" (Fehler), "wa" (Warnung), "ok"
export function band(art, titel, text, symbolName) {
  const inhalt = el("div", "text", el("strong", "", titel));
  if (text) inhalt.append(text);
  return el("div", `band${art ? ` ${art}` : ""}`, symbol(symbolName), inhalt);
}
