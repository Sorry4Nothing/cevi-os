import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { keineDaten, type Kontext } from "../src/website/rendern.js";
import {
  rendereTermineSeiten,
  STIL_TERMINE,
  TERMINE_DATEIEN,
} from "../src/website/termine-seiten.js";

// Die Seiten für Termine und Anlässe (#530): fertige Dateien ohne Daten, mit Skript und strenger CSP
const kontext: Kontext = {
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten: keineDaten(),
};
const seiten = rendereTermineSeiten(kontext);
const PUBLIC = new URL("../public/website/", import.meta.url);

describe("Seiten für Termine und Anlässe", () => {
  test("vier Dateien an den Adressen termine und anlass", () => {
    expect(seiten.map(([d]) => d)).toEqual(TERMINE_DATEIEN);
    expect(TERMINE_DATEIEN).toEqual([
      "termine/index.html",
      "termine/vorschlagen/index.html",
      "anlass/index.html",
      "anlass/anmeldung/index.html",
    ]);
  });

  test.each(seiten)(
    "%s: Gerüst, Skript, Stil, Hinweis ohne Skript",
    (datei, inhalt) => {
      expect(inhalt).toContain('<div class="tm">');
      expect(inhalt).toContain('<div id="tm-app" data-seite="');
      expect(inhalt).toContain(
        `<link rel="stylesheet" href="${STIL_TERMINE}">`,
      );
      expect(inhalt).toContain('role="status" aria-live="polite"');
      expect(inhalt).toContain("<noscript>");
      expect(inhalt).toContain("Diese Seite braucht JavaScript.");
      // Nur diese Seiten dürfen nicht in Suchmaschinen: sie zeigen ohne Sitzung nichts
      expect(inhalt).toContain('<meta name="robots" content="noindex">');
      expect(inhalt).toContain("<h1");
    },
  );

  test.each(seiten)(
    "%s: theme.js, ladezustand.js, das Konto-Menü und ein Modul der eigenen Herkunft, nie inline",
    (datei, inhalt) => {
      const skripte = [...inhalt.matchAll(/<script([^>]*)>/g)];
      expect(skripte).toHaveLength(4);
      expect(skripte[0][1]).toBe(' src="/website/theme.js"');
      expect(skripte[1][1]).toBe(' src="/website/ladezustand.js"');
      expect(skripte[2][1]).toBe(' type="module" src="/website/konto.js"');
      expect(skripte[3][1]).toMatch(
        /^ type="module" src="\/website\/[a-z-]+\.js"$/,
      );
      expect(inhalt).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
      expect(inhalt).not.toMatch(/\sstyle=/);
      expect(inhalt).not.toMatch(/\son[a-z]+=/);
      const csp = /Content-Security-Policy" content="([^"]+)"/
        .exec(inhalt)![1]
        .replaceAll("&#39;", "'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toMatch(/unsafe|https?:/);
    },
  );

  test("jede Seite lädt ein Skript und Stil, die es im Quellordner gibt", () => {
    const dateien = readdirSync(PUBLIC);
    for (const [, inhalt] of seiten) {
      const skript = /src="\/website\/([a-z-]+\.js)"/.exec(inhalt)![1];
      expect(dateien).toContain(skript);
    }
    expect(dateien).toContain("termine.css");
    // Das eigene Auswahlfeld (#564): Stil und Skript liegen daneben
    expect(seiten[0]![1]).toContain('href="/website/auswahl.css"');
    expect(dateien).toContain("auswahl.css");
    expect(dateien).toContain("auswahl.js");
    expect(existsSync(new URL("termine.css", PUBLIC))).toBe(true);
  });

  test("die Anlassseite hat einen Platz für Datum und Titel, die Anmeldung für den Titel", () => {
    const anlass = seiten.find(([d]) => d === "anlass/index.html")![1];
    expect(anlass).toContain('<p class="kicker" hidden></p>');
    expect(anlass).toContain('<h1 id="tm-titel">Anlass</h1>');
    expect(
      seiten.find(([d]) => d === "anlass/anmeldung/index.html")![1],
    ).toContain('<h1 id="tm-titel">Anmeldung</h1>');
  });
});

describe("Stil und Module der Seiten", () => {
  const css = readFileSync(new URL("termine.css", PUBLIC), "utf8");
  test("Tag und Nacht, Reduced-Motion, erzwungene Farben, kein Fremdhost", () => {
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("forced-colors: active");
    expect(css).not.toMatch(/url\(|@import|https?:\/\//);
  });
  test("kein innerHTML, kein eval in den Modulen", () => {
    for (const n of readdirSync(PUBLIC).filter((n) =>
      /^(tm|termine|termine-link|vorschlag|anlass|anmeldung|auswahl)\.js$/.test(
        n,
      ),
    )) {
      const q = readFileSync(new URL(n, PUBLIC), "utf8").replace(
        /\/\/.*$/gm,
        "",
      );
      expect(q, n).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/,
      );
      // Eine Sitzung lebt nur im Cookie, nie im Speicher des Browsers
      expect(q, n).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});
