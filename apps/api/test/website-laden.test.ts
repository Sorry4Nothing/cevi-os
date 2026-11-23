import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { keineDaten, rahmen, type Kontext } from "../src/website/rendern.js";
import { rendereTermineSeiten } from "../src/website/termine-seiten.js";

// Ladezustände der Website (#567): Platzhalter für Bilder, Platz für nachgeladene Inhalte
const PUBLIC = new URL("../public/website/", import.meta.url);
const lies = (datei: string) => readFileSync(new URL(datei, PUBLIC), "utf8");
const kontext: Kontext = {
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten: keineDaten(),
};

describe("Bilder", () => {
  const html = rahmen(kontext, {
    titel: "T",
    aktuell: null,
    inhalt: "<p>x</p>",
  });

  test("bilder.js steht klassisch im Kopf, vor dem Stil; laden.css folgt auf website.css", () => {
    const skript = html.indexOf('<script src="/website/bilder.js"></script>');
    expect(skript).toBeGreaterThan(0);
    // Klassisch: kein Modul, kein defer, damit die Marke gesetzt ist, bevor das erste Bild gezeichnet wird
    expect(html.slice(skript, skript + 60)).not.toMatch(/module|defer|async/);
    expect(skript).toBeLessThan(html.indexOf('href="/website/website.css"'));
    expect(html.indexOf('href="/website/laden.css"')).toBeGreaterThan(
      html.indexOf('href="/website/website.css"'),
    );
  });

  test("ohne Skript ändert sich nichts: Der Stil gilt nur unter html.bilder", () => {
    const css = lies("laden.css");
    const regeln = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // Jede Regel für Bilder hängt an der Klasse, die erst das Skript setzt
    for (const m of regeln.matchAll(/^\s*([^{}@]*img[^{}]*)\{/gm)) {
      expect(m[1], m[1]).toContain("html.bilder");
    }
    expect(css).not.toMatch(/url\(|@import|https?:\/\//);
  });

  test("Platzhalter, Fehlerzustand, ruhige Bewegung, erzwungene Farben", () => {
    const css = lies("laden.css");
    expect(css).toContain("img[data-fehlt]");
    expect(css).toContain("Bild nicht geladen.");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain("--skeleton");
  });

  test("bilder.js: nur Marken, nie Inhalt, kein Abruf, kein innerHTML", () => {
    const js = lies("bilder.js");
    expect(js).toContain('"data-fehlt"');
    expect(js).not.toMatch(/innerHTML|eval\(|fetch\(|XMLHttpRequest|import /);
  });
});

describe("Platz für nachgeladene Inhalte", () => {
  const seiten = new Map(rendereTermineSeiten(kontext));

  test("die Seite «Termine» hält Reiter und Werkzeugleiste frei, die anderen nicht", () => {
    expect(seiten.get("termine/index.html")).toContain(
      '<div class="vorab" aria-hidden="true">',
    );
    expect(seiten.get("termine/vorschlagen/index.html")).not.toContain("vorab");
  });

  test("das Skelett erscheint nur mit Skript, spät und verschwindet von selbst", () => {
    const css = lies("laden.css");
    expect(css).toMatch(/\.vorab \{\s*display: none;/);
    expect(css).toContain("html.bilder .vorab {");
    expect(css).toContain("vorab-ein 0s 0.4s");
    expect(css).toContain("vorab-weg 0s 8s");
  });
});
