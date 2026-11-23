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

// Die Hinweisseite steht allein, ohne die Stilvorlage der Website (sie ist dann gelöscht): dieselbe Handschrift wie die Fehlerseiten (#567, links die Aussage, rechts das blaue Feld mit Pfosten und Schild), die Farben des Designs «Cevi Web» in Tag und Nacht
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
  --titel: #013974;
  --feld: #013974;
  --knopf: #d50038;
  --keil: #c9d5e1;
  --fokus: #013974;
  --rand: clamp(1rem, 4vw, 4.5rem);
}

@media (prefers-color-scheme: dark) {
  :root {
    --flaeche: #1c1c1a;
    --text: #f3f3ef;
    --leise: #bebeb6;
    --titel: #f3f3ef;
    --keil: #3b3b37;
    --fokus: #9dc0ea;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--flaeche);
  color: var(--text);
  font-family: Archivo, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}

main {
  display: grid;
  min-height: 100vh;
  min-height: 100svh;
}

.text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 1.25rem;
  padding: clamp(2rem, 5vw, 4rem) var(--rand);
}

h1 {
  margin: 0;
  color: var(--titel);
  font-size: clamp(2.5rem, 1.2rem + 4.6vw, 5.5rem);
  font-weight: 800;
  line-height: 0.98;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

p {
  max-width: 34ch;
  margin: 0;
  font-size: clamp(1.125rem, 1rem + 0.5vw, 1.375rem);
}

a {
  display: inline-flex;
  align-items: center;
  min-height: 3.5rem;
  padding: 0 2rem;
  border-radius: 9999px;
  background: var(--knopf);
  color: #ffffff;
  font-size: 1.0625rem;
  font-weight: 700;
  text-decoration: none;
}

a:focus-visible {
  outline: 3px solid var(--fokus);
  outline-offset: 3px;
}

.feld {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 16rem;
  padding: 3rem 4rem 5rem calc(clamp(1rem, 4vw, 3.5rem) + 0.75rem);
  background: var(--feld);
}

.feld::before {
  position: absolute;
  top: 2rem;
  bottom: 0;
  left: clamp(1rem, 4vw, 3.5rem);
  width: 0.75rem;
  border-radius: 0.25rem 0.25rem 0 0;
  background: #ffffff;
  content: "";
}

.schild {
  position: relative;
  width: min(100%, 24rem);
  padding: 1.125rem 1.25rem;
  background: var(--flaeche);
  font-size: 1.25rem;
  font-weight: 800;
}

.schild::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(100% - 1px);
  width: 1.75rem;
  background: var(--keil);
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  content: "";
}

@media (min-width: 64.0625em) {
  main {
    grid-template-columns: 1fr 1fr;
  }
}

@media (forced-colors: active) {
  a,
  .schild {
    border: 1px solid CanvasText;
  }

  .feld::before,
  .schild::after {
    background: CanvasText;
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
<div class="text">
<h1>Vorübergehend nicht erreichbar</h1>
<p>Diese Website ist im Moment nicht verfügbar. Versuche es später nochmals.</p>
<a href="">Nochmals versuchen</a>
</div>
<div class="feld"><span class="schild">Im Moment geschlossen</span></div>
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
