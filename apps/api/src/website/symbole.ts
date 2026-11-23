import type { HtmlKnoten } from "./rendern.js";

// Eigener Symbolsatz der Website (#555), 24er Raster. Eine Logik für alle: Linien 2 px mit geraden Enden und spitzen Ecken (Stil in website.css, Klasse «i»), Formen nur aus Gerade, Kreis und Bogen;
// was eine Richtung zeigt oder betont, ist ein gefülltes Dreieck oder Quadrat (Klasse «f»): Das Dreieck ist die Form des Cevi-Zeichens.
// Nur in der festen Hülle der Seite und in den Platzhaltern: Das Skript für geschützte Bausteine kennt keine SVG-Elemente
export const SYMBOLE: Record<string, HtmlKnoten[]> = {
  info: [
    { tag: "circle", attr: { cx: "12", cy: "12", r: "9" } },
    { tag: "path", attr: { d: "M12 11v6" } },
    { tag: "path", attr: { class: "f", d: "M11 6.5h2v2h-2z" } },
  ],
  warnung: [
    { tag: "path", attr: { d: "M12 3.5 21.5 20h-19z" } },
    { tag: "path", attr: { d: "M12 9.5v5" } },
    { tag: "path", attr: { class: "f", d: "M11 15.5h2v2h-2z" } },
  ],
  schloss: [
    { tag: "path", attr: { d: "M5 11h14v10H5z" } },
    { tag: "path", attr: { d: "M8 11V7.5a4 4 0 0 1 8 0V11" } },
  ],
  person: [
    { tag: "circle", attr: { cx: "12", cy: "8", r: "4" } },
    { tag: "path", attr: { d: "M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2" } },
  ],
  menue: [{ tag: "path", attr: { d: "M3 6h18M3 12h18M3 18h18" } }],
  schliessen: [{ tag: "path", attr: { d: "M5 5l14 14M19 5 5 19" } }],
  nochmals: [
    { tag: "path", attr: { d: "M19.5 13.5A7.5 7.5 0 1 1 16 7" } },
    { tag: "path", attr: { class: "f", d: "M14 3.5h7v7z" } },
  ],
  auge: [
    {
      tag: "path",
      attr: {
        d: "M2 12c3-4.7 6.3-7 10-7s7 2.3 10 7c-3 4.7-6.3 7-10 7s-7-2.3-10-7z",
      },
    },
    { tag: "circle", attr: { cx: "12", cy: "12", r: "3" } },
  ],
  "auge-zu": [
    {
      tag: "path",
      attr: {
        d: "M2 12c3-4.7 6.3-7 10-7s7 2.3 10 7c-3 4.7-6.3 7-10 7s-7-2.3-10-7z",
      },
    },
    { tag: "path", attr: { d: "M4 3l16 18" } },
  ],
  sonne: [
    { tag: "circle", attr: { cx: "12", cy: "12", r: "4" } },
    {
      tag: "path",
      attr: {
        d: "M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1",
      },
    },
  ],
  mond: [
    {
      tag: "path",
      attr: { d: "M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" },
    },
  ],
  gruppe: [
    { tag: "circle", attr: { cx: "8.5", cy: "8", r: "3.5" } },
    { tag: "path", attr: { d: "M2 21v-2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v2" } },
    {
      tag: "path",
      attr: { d: "M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.2A5 5 0 0 1 22 19v2" },
    },
  ],
  zelt: [
    { tag: "path", attr: { d: "M12 5 2.5 20.5h19z" } },
    { tag: "path", attr: { class: "f", d: "M12 12.5 8 20.5h8z" } },
    { tag: "path", attr: { d: "M9.5 1.5 12 5l2.5-3.5" } },
  ],
  kalender: [
    { tag: "path", attr: { d: "M3.5 5h17v15.5h-17z" } },
    { tag: "path", attr: { d: "M3.5 10h17M8 2v5M16 2v5" } },
  ],
  stern: [
    {
      tag: "path",
      attr: {
        d: "M12 2.5l2.8 6.3 6.7.7-5 4.6 1.4 6.7-5.9-3.4-5.9 3.4 1.4-6.7-5-4.6 6.7-.7z",
      },
    },
  ],
  herz: [
    {
      tag: "path",
      attr: {
        d: "M12 20.5 3.6 12A5 5 0 0 1 10.7 5L12 6.3 13.3 5a5 5 0 0 1 7.1 7z",
      },
    },
  ],
  ort: [
    { tag: "path", attr: { d: "M12 21.5 6 13.5a7.5 7.5 0 1 1 12 0z" } },
    { tag: "circle", attr: { cx: "12", cy: "9", r: "2.5" } },
  ],
  // Briefumschlag und Telefon für die Zeilen der Kontaktkarte (#605); das Telefon ist ein Handgerät aus Rechteck und Gerade
  mail: [
    { tag: "path", attr: { d: "M3 5.5h18v13H3z" } },
    { tag: "path", attr: { d: "M3 6l9 7.5L21 6" } },
  ],
  telefon: [
    { tag: "path", attr: { d: "M7 2.5h10v19H7z" } },
    { tag: "path", attr: { d: "M10.5 18.5h3" } },
  ],
  // Kleines Dreieck nach unten: zeigt ein Untermenü an (Kopf, #558)
  dreieck: [{ tag: "path", attr: { class: "f", d: "M6.5 9.5h11L12 16z" } }],
  pfeil: [
    { tag: "path", attr: { d: "M3 12h12" } },
    { tag: "path", attr: { class: "f", d: "M14 6l7.5 6-7.5 6z" } },
  ],
};

// Ein Symbol als Knoten des Markups (24 px, Farbe des Textes); in Text umwandeln mit serialisiere() aus rendern.ts
export const symbol = (name: string): HtmlKnoten => ({
  tag: "svg",
  attr: { class: "i", viewBox: "0 0 24 24", "aria-hidden": "true" },
  kinder: SYMBOLE[name]!,
});
