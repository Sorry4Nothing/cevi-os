import { rahmen, type Kontext } from "./rendern.js";

// Die Seiten für Termine und Anlässe (#530, Boards W3, W5 bis W8). Es sind fertige Dateien ohne Daten: Inhalt, Zustände und Anmeldung kommen im Browser aus der API (Skript im eigenen Modul unter /website/), weil sie von der Sitzung der Person abhängen. Ohne Skript zeigt jede Seite den Hinweis.
// Die Adressen «termine» und «anlass» gehören dazu (RESERVIERTE_ADRESSEN in seiten.ts), damit keine Seite aus dem Editor sie überdeckt.

export const STIL_TERMINE = "/website/termine.css";

type Definition = {
  datei: string;
  titel: string;
  seite: string;
  skript: string;
  // Die Kopfzeile: bei Anlassseiten füllt das Skript Titel und Datum nach
  kopf: "einfach" | "anlass";
};

const SEITEN: Definition[] = [
  {
    datei: "termine/index.html",
    titel: "Termine",
    seite: "termine",
    skript: "termine",
    kopf: "einfach",
  },
  {
    datei: "termine/vorschlagen/index.html",
    titel: "Termin vorschlagen",
    seite: "vorschlag",
    skript: "vorschlag",
    kopf: "einfach",
  },
  {
    datei: "anlass/index.html",
    titel: "Anlass",
    seite: "anlass",
    skript: "anlass",
    kopf: "anlass",
  },
  {
    datei: "anlass/anmeldung/index.html",
    titel: "Anmeldung",
    seite: "anmeldung",
    skript: "anmeldung",
    kopf: "einfach",
  },
];

export const TERMINE_DATEIEN = SEITEN.map((s) => s.datei);

function seite(s: Definition, k: Kontext): string {
  const kopf =
    s.kopf === "anlass"
      ? `<div class="seitenkopf" id="tm-kopf">
<p class="kicker" hidden></p>
<h1 id="tm-titel">${s.titel}</h1>
</div>`
      : `<div class="seitenkopf" id="tm-kopf">
<h1 id="tm-titel">${s.titel}</h1>
</div>`;
  return rahmen(k, {
    titel: s.titel,
    aktuell: null,
    robots: "noindex",
    skript: `/website/${s.skript}.js`,
    stile: [STIL_TERMINE],
    inhalt: `<div class="tm">
${kopf}
<div id="tm-app" data-seite="${s.seite}">
<noscript><div class="band wa" role="status"><div class="text"><strong>Diese Seite braucht JavaScript.</strong>Schalte es in deinem Browser ein, um die Seite zu nutzen.</div></div></noscript>
</div>
<p class="nur-leser" id="tm-status" role="status" aria-live="polite"></p>
</div>`,
  });
}

// [Dateipfad, Inhalt] für den Abgleich
export const rendereTermineSeiten = (k: Kontext): [string, string][] =>
  SEITEN.map((s) => [s.datei, seite(s, k)]);
