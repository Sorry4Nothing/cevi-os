// Kleine Bausteine der Oberfläche für die Skripte der Website (#529): Elemente ohne innerHTML und die Symbole des Designs.
// Text kommt immer als Textknoten, die Pfade der Symbole sind feste Werte aus diesem Modul.

const SVG = "http://www.w3.org/2000/svg";

// Dieselben Formen wie im Renderer (src/website/rendern.ts): Linien, dazu gefüllte Dreiecke und Quadrate (Klasse «f»)
const SYMBOLE = {
  info: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["path", { d: "M12 11v6" }],
    ["path", { class: "f", d: "M11 6.5h2v2h-2z" }],
  ],
  warnung: [
    ["path", { d: "M12 3.5 21.5 20h-19z" }],
    ["path", { d: "M12 9.5v5" }],
    ["path", { class: "f", d: "M11 15.5h2v2h-2z" }],
  ],
  schloss: [
    ["path", { d: "M5 11h14v10H5z" }],
    ["path", { d: "M8 11V7.5a4 4 0 0 1 8 0V11" }],
  ],
  // Pfeil nach rechts wie im Renderer; die Stile drehen ihn für «zurück»
  pfeil: [
    ["path", { d: "M3 12h12" }],
    ["path", { class: "f", d: "M14 6l7.5 6-7.5 6z" }],
  ],
  // Ersatz für ein Album ohne Titelbild
  bild: [
    ["path", { d: "M3.5 5.5h17v13h-17z" }],
    ["circle", { cx: 9, cy: 10.5, r: 1.75 }],
    ["path", { d: "M3.5 17l5.5-5 4 3.5 3-2.5 4.5 4" }],
  ],
  // Dreieck der Untermenüs im Kopf (Navigation)
  dreieck: [["path", { class: "f", d: "M6.5 9.5h11L12 16z" }]],
  nochmals: [
    ["path", { d: "M19.5 13.5A7.5 7.5 0 1 1 16 7" }],
    ["path", { class: "f", d: "M14 3.5h7v7z" }],
  ],
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

// --- Ladezustände (#574). Der Stil steht in website.css (Abschnitt «Ladezustände»): .skelett, .sk mit Breite und Höhe, Bilder über ladezustand.js.
// Ein Skelett in der Form des späteren Inhalts. Jedes Argument beschreibt ein Teil über Klassen, z. B. skelett("t h24 b40", "t b90", "r h48 bpx160").
// Es ist für Hilfstechnik verborgen: Der Bereich trägt aria-busy, die Ansage steht in einer Statusregion. Es erscheint erst nach 150 ms (Stil).
export function skelett(...teile) {
  const s = el("div", "skelett", ...teile.map((k) => el("span", `sk ${k}`)));
  s.setAttribute("aria-hidden", "true");
  return s;
}

// Nichts bleibt für immer im Ladezustand: Nach dieser Frist gilt ein Abruf als gescheitert (der Aufrufer zeigt dann seinen Fehlerzustand mit «Nochmals versuchen»)
export const FRIST_MS = 15000;

// fetch mit Frist; bricht ab, wenn die Frist abläuft oder das übergebene signal abbricht. Wirft wie fetch (der Aufrufer fängt es ab)
export function holeMitFrist(url, optionen = {}, frist = FRIST_MS) {
  const abbruch = new AbortController();
  const aus = setTimeout(() => abbruch.abort(), frist);
  optionen.signal?.addEventListener("abort", () => abbruch.abort());
  return fetch(url, { ...optionen, signal: abbruch.signal }).finally(() =>
    clearTimeout(aus),
  );
}
