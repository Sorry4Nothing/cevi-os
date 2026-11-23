import type { Ausgabe } from "./ausgabe.js";
import { CADDY_DATEI } from "./weiterleitungen.js";

// Die öffentliche Website bei einer Informationssperre vom Netz nehmen (#425): Ausgabe leeren, eine neutrale Hinweisseite schreiben. Der Abgleich erzeugt in dieser Zeit nichts neu (siehe mitSperre).
// Nach dem Aufheben löscht gibFrei die Hinweisseiten; der Abgleich findet dann eine leere Ausgabe und schreibt alles neu.

// Dieselben Dateien, die der Abgleich für den Start und für unbekannte Adressen schreibt
const HINWEIS_DATEIEN = ["index.html", "404.html"];
// Der Stil der Hinweisseite als eigene Datei: Die CSP des Hosts erlaubt nur style-src 'self', ein Inline-Stil bliebe wirkungslos
export const HINWEIS_STIL_DATEI = "gesperrt.css";
// Die Schrift und ihre Lizenz bleiben liegen: Sie sind kein Inhalt, und die Hinweisseite setzt ihren Titel damit
const BLEIBT = new Set([
  CADDY_DATEI,
  "website/archivo-latin.woff2",
  "website/archivo-ofl.txt",
]);

// Die Hinweisseite steht allein, ohne die Stilvorlage der Website (sie ist dann gelöscht): dieselbe Anlage wie die Fehlerseiten (#567, blaue Fahne vom linken Rand, Archivo), die Farben des Designs «Cevi Web» in Tag und Nacht
export const HINWEIS_STIL = `@font-face {
  font-family: Archivo;
  font-weight: 400 900;
  font-display: swap;
  src: url("/website/archivo-latin.woff2") format("woff2");
}

:root {
  color-scheme: light dark;
  --flaeche: #ffffff;
  --text: #1a1a1a;
  --leise: #4d4d4d;
  --fahne: #013974;
  --auf-fahne: #ffffff;
  --knopf: #d50038;
  --fokus: #013974;
  --rand: clamp(1rem, 4vw, 4.5rem);
}

@media (prefers-color-scheme: dark) {
  :root {
    --flaeche: #1c1c1a;
    --text: #f3f3ef;
    --leise: #bebeb6;
    --fokus: #9dc0ea;
  }
}

* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  background: var(--flaeche);
  color: var(--text);
  font-family: Archivo, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.55;
}

main {
  display: grid;
  gap: 2rem clamp(2rem, 5vw, 6rem);
  max-width: 105rem;
  margin: 0 auto;
  padding: clamp(3rem, 14vh, 9rem) var(--rand) 4rem;
}

.fahne {
  position: relative;
  width: fit-content;
  max-width: min(100%, 48rem);
  padding: clamp(1.5rem, 1rem + 2vw, 3rem) clamp(1.5rem, 1rem + 2.5vw, 3.5rem) clamp(1.5rem, 1rem + 2vw, 3rem) 0;
  border-radius: 0 1rem 1rem 0;
  background: var(--fahne);
  color: var(--auf-fahne);
}

.fahne::before {
  position: absolute;
  top: 0;
  right: calc(100% - 1px);
  bottom: 0;
  width: 100vw;
  background: inherit;
  content: "";
}

h1 {
  max-width: 13ch;
  margin: 0;
  font-size: clamp(2.125rem, 1.4rem + 3vw, 4.25rem);
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.025em;
  text-wrap: balance;
}

a {
  display: inline-flex;
  align-items: center;
  min-height: 3.5rem;
  margin-top: clamp(1.25rem, 2.5vw, 2.25rem);
  padding: 0 2rem;
  border-radius: 9999px;
  background: var(--knopf);
  color: #ffffff;
  font-size: 1.0625rem;
  font-weight: 700;
  text-decoration: none;
}

a:focus-visible {
  outline: 3px solid var(--auf-fahne);
  outline-offset: 3px;
}

p {
  max-width: 62ch;
  margin: 0;
  color: var(--leise);
  font-size: clamp(1.1875rem, 1.05rem + 0.55vw, 1.5rem);
}

@media (min-width: 64.0625em) {
  main {
    grid-template-columns: minmax(0, max-content) minmax(20rem, 1fr);
    align-items: center;
  }
}

@media (forced-colors: active) {
  .fahne,
  a {
    border: 1px solid CanvasText;
  }
}
`;

// Neutral: kein Anlass, keine Namen, keine Zeitangabe. Eine kleine Seite ohne Skript und ohne Dateien von aussen; «Nochmals versuchen» ist ein Link auf dieselbe Adresse
export const HINWEISSEITE = `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Vorübergehend nicht erreichbar</title>
<link rel="stylesheet" href="/${HINWEIS_STIL_DATEI}">
</head>
<body>
<main>
<div class="fahne"><h1>Vorübergehend nicht erreichbar</h1><a href="">Nochmals versuchen</a></div>
<p>Diese Website ist im Moment nicht verfügbar. Versuche es später nochmals.</p>
</main>
</body>
</html>
`;

export type WebsiteSperre = {
  // Die Abteilung, deren Website diese Ausgabe trägt (WEBSITE_ABTEILUNG_ID); eine Sperre anderer Abteilungen berührt sie nicht
  abteilungId: string;
  nimmVomNetz: () => Promise<void>;
  gibFrei: () => Promise<void>;
};

export function erstelleWebsiteSperre(
  ausgabe: Ausgabe,
  abteilungId: string,
): WebsiteSperre {
  return {
    abteilungId,
    async nimmVomNetz() {
      // Die Weiterleitungsdatei für Caddy bleibt: Sie ist nur eine Liste alter Adressen, die Ziele zeigen auf die Hinweisseite
      for (const datei of await ausgabe.liste()) {
        if (!BLEIBT.has(datei) && !HINWEIS_DATEIEN.includes(datei)) {
          await ausgabe.loesche(datei);
        }
      }
      await ausgabe.schreibe(HINWEIS_STIL_DATEI, HINWEIS_STIL);
      for (const datei of HINWEIS_DATEIEN) {
        await ausgabe.schreibe(datei, HINWEISSEITE);
      }
    },
    async gibFrei() {
      for (const datei of [...HINWEIS_DATEIEN, HINWEIS_STIL_DATEI]) {
        await ausgabe.loesche(datei);
      }
    },
  };
}

// Umhüllt den Lauf des Abgleichs: Solange die Sperre die Website vom Netz hält, läuft er nicht (er stellte sonst die Seiten wieder her)
export function mitSperre<T>(
  gesperrt: () => boolean,
  lauf: () => Promise<T>,
): () => Promise<T | "gesperrt"> {
  return async () => (gesperrt() ? "gesperrt" : lauf());
}
