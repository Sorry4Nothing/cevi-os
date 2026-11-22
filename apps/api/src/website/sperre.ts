import type { Ausgabe } from "./ausgabe.js";
import { CADDY_DATEI } from "./weiterleitungen.js";

// Die öffentliche Website bei einer Informationssperre vom Netz nehmen (#425): Ausgabe leeren, eine neutrale Hinweisseite schreiben. Der Abgleich erzeugt in dieser Zeit nichts neu (siehe mitSperre).
// Nach dem Aufheben löscht gibFrei die Hinweisseiten; der Abgleich findet dann eine leere Ausgabe und schreibt alles neu.

// Dieselben Dateien, die der Abgleich für den Start und für unbekannte Adressen schreibt
const HINWEIS_DATEIEN = ["index.html", "404.html"];

// Neutral: kein Anlass, keine Namen, keine Zeitangabe. Eine kleine Seite ohne Skript und ohne Dateien von aussen
export const HINWEISSEITE = `<!doctype html>
<html lang="de-CH">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex" />
    <title>Vorübergehend nicht erreichbar</title>
    <style>
      /* Die Farben des Designs «Cevi Web» (Tag und Nacht); die Seite steht allein, ohne Stilvorlage der Website */
      :root { --flaeche: #ffffff; --text: #1a1a1a; --leise: #4d4d4d; --titel: #d50038; --leiste: #013974; }
      @media (prefers-color-scheme: dark) { :root { --flaeche: #1c1c1a; --text: #f3f3ef; --leise: #bebeb6; --titel: #ff7a93; } }
      body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; background: var(--flaeche); color: var(--text); line-height: 1.6; }
      body::before { content: ""; display: block; height: 0.75rem; background: var(--leiste); }
      main { max-width: 36rem; padding: 3rem 1.5rem; justify-self: center; }
      h1 { font-size: clamp(1.75rem, 6vw, 2.5rem); line-height: 1.2; margin: 0 0 1rem; color: var(--titel); }
      p { margin: 0; font-size: 1.125rem; color: var(--leise); }
    </style>
  </head>
  <body>
    <main>
      <h1>Vorübergehend nicht erreichbar</h1>
      <p>Diese Website ist im Moment nicht verfügbar. Bitte versuchen Sie es später nochmals.</p>
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
        if (datei !== CADDY_DATEI && !HINWEIS_DATEIEN.includes(datei)) {
          await ausgabe.loesche(datei);
        }
      }
      for (const datei of HINWEIS_DATEIEN) {
        await ausgabe.schreibe(datei, HINWEISSEITE);
      }
    },
    async gibFrei() {
      for (const datei of HINWEIS_DATEIEN) await ausgabe.loesche(datei);
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
