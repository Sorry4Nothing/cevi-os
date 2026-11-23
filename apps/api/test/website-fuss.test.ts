import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { STIL_FUSS } from "../src/website/kontakt.js";
import { keineDaten, rahmen, type Kontext } from "../src/website/rendern.js";

// Fuss und Kontaktkarte (#580): Stil und Einbindung. Den Aufbau prüft website-darstellung.test.ts.
const kontext = (): Kontext => ({
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten: keineDaten(),
});
const css = readFileSync(
  new URL("../public/website/fuss.css", import.meta.url),
  "utf8",
);

describe("fuss.css (#580)", () => {
  test("jede Seite lädt die Datei nach dem Grundstil und dem Stil des Kopfs", () => {
    const html = rahmen(kontext(), {
      titel: "T",
      aktuell: null,
      inhalt: "<p>x</p>",
    });
    expect(STIL_FUSS).toBe("/website/fuss.css");
    expect(html).toContain(
      '<link rel="stylesheet" href="/website/kopf.css">\n<link rel="stylesheet" href="/website/fuss.css">',
    );
  });

  test("nichts von aussen, keine Farbe ausser Tokens und erzwungenen Farben", () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/url\(|@import|https?:/);
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(code).not.toMatch(/\b(rgb|hsl|oklch)a?\(/);
    expect(css).toContain("@media (forced-colors: active)");
  });

  test("Bewegung nur am Bildschirm und ohne «Bewegung reduzieren»", () => {
    const [ruhe, bewegt] = css.split(
      "@media screen and (prefers-reduced-motion: no-preference) {",
    );
    expect(ruhe).not.toMatch(/transition|animation/);
    expect(bewegt).toContain("transition: translate var(--dauer)");
  });

  test("Links und Knöpfe bekommen hier keine eigene Fassung: nur Zusätze für Blau und Pfeile", () => {
    expect(css).not.toMatch(/^(a|\.btn)(\.[pst]|\.gross)?(:hover)? \{/m);
    expect(css).not.toMatch(/^\.verweis(:hover)? \{/m);
    // «Nach oben» ist eine Nebenaktion des Repertoires, auf Blau mit hellem Rand
    expect(css).toContain(".fuss a.btn.s {");
  });
});
