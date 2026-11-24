// Skizzen der Seitenvorlagen für «Neue Seite» (#595): schematische Flächen, keine Inhalte. Linien und Flächen in den Tokens der Verwaltung (CSS: website-seiten.css).
const SVG_NS = "http://www.w3.org/2000/svg";

const form = (tag, eigenschaften) => {
  const k = document.createElementNS(SVG_NS, tag);
  for (const [n, w] of Object.entries(eigenschaften))
    k.setAttribute(n, String(w));
  return k;
};
// Fläche (f), Linie (l) und Akzent (a) sind Klassen im CSS
const flaeche = (x, y, b, h, klasse = "f") =>
  form("rect", { x, y, width: b, height: h, rx: 2, class: `sk-${klasse}` });
const zeilen = (x, y, n, b) =>
  Array.from({ length: n }, (_, i) =>
    flaeche(x, y + i * 6, i === n - 1 ? b * 0.6 : b, 2.5, "l"),
  );

const SKIZZEN = {
  // Stufenfakten, Text, Leitungsteam, Termine
  stufenseite: () => [
    flaeche(6, 6, 84, 14, "a"),
    flaeche(6, 25, 26, 12),
    flaeche(35, 25, 26, 12),
    flaeche(64, 25, 26, 12),
    ...zeilen(6, 42, 2, 84),
    ...[12, 26, 40].map((x) =>
      form("circle", { cx: x + 3, cy: 59, r: 4, class: "sk-f" }),
    ),
    flaeche(54, 55, 36, 8, "l"),
  ],
  anlass: () => [
    flaeche(6, 6, 84, 14, "a"),
    flaeche(6, 26, 24, 24),
    ...zeilen(36, 27, 4, 54),
    flaeche(36, 54, 30, 8, "a"),
  ],
  textseite: () => [
    flaeche(6, 6, 54, 6, "a"),
    ...zeilen(6, 20, 4, 84),
    ...zeilen(6, 46, 3, 84),
  ],
  leer: () => [
    form("rect", {
      x: 6,
      y: 6,
      width: 84,
      height: 52,
      rx: 4,
      class: "sk-rahmen",
    }),
    form("path", { d: "M48 26v12M42 32h12", class: "sk-plus" }),
  ],
};

export function skizze(schluessel) {
  const svg = form("svg", {
    viewBox: "0 0 96 64",
    class: "ws-skizze",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(...(SKIZZEN[schluessel] ?? SKIZZEN.leer)());
  return svg;
}
