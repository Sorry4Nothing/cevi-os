import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Oberfläche der Website-Medien, Stufenfelder, Einstellungen und des Lädelis (#591): Aufbau der Module und Stilvorlagen.
// Die Verwaltung besteht aus Browser-Modulen ohne Build; geprüft wird, was sich ohne Browser prüfen lässt.
const ordner = new URL("../public/admin/", import.meta.url);
const lies = (datei: string) => readFileSync(new URL(datei, ordner), "utf8");

const MODULE = [
  "bildwahl.js",
  "website-medien.js",
  "website-einstellungen.js",
  "website-stufenfakten.js",
  "laedeli.js",
];

describe("Bereiche des Pakets 8", () => {
  test("keine nativen Datums-, Zeit- und Zahlfelder", () => {
    for (const datei of MODULE) {
      expect(lies(datei), datei).not.toMatch(
        /\b(?:type|typ):\s*"(?:date|time|datetime-local|number)"/,
      );
    }
  });

  test("Stilvorlagen sind in index.html eingebunden und vorhanden", () => {
    const html = lies("index.html");
    for (const css of ["bildwahl.css", "website-einstellungen.css"]) {
      expect(existsSync(new URL(css, ordner)), css).toBe(true);
      expect(html).toContain(`href="/admin/${css}"`);
    }
  });

  test("die Bildwahl liegt in der Seite, nicht in einem Fenster", () => {
    const wahl = lies("bildwahl.js");
    expect(wahl).toContain("export function bildwahl");
    expect(wahl).toContain("export function bildMitLader");
    expect(wahl).not.toContain("showModal");
    // Escape schliesst nur die Wahl, nicht die Seite darum herum
    expect(wahl).toContain("Escape");
    expect(lies("website-einstellungen.js")).not.toContain("bildDialog");
  });

  test("das Lädeli wählt Bilder ohne Auswahlfeld und zeigt den Stand als Schiene", () => {
    const l = lies("laedeli.js");
    expect(l).toContain("bildwahl(");
    expect(l).not.toMatch(/\bauswahl\(/);
    expect(l).toContain('"aria-current"');
    // Offen, Bereit, Übergeben in dieser Folge
    expect(l).toMatch(
      /\["offen", "Offen"\],\s*\["bereit", "Bereit"\],\s*\["uebergeben", "Übergeben"\]/,
    );
    // Die Reihenfolge der Artikel bleibt: Griff, Tastatur und Menü
    expect(l).toContain("ld-griff");
    expect(l).toContain("Nach oben");
  });

  test("die Medien haben Raster und Liste, Filterleiste und eine Auswahlleiste mit Rückgängig", () => {
    const m = lies("website-medien.js");
    expect(m).toContain("filterleiste(");
    expect(m).toContain("medien--liste");
    expect(m).toContain("ws-auswahlleiste");
    expect(m).toContain("mitRueckgaengig");
    expect(lies("website-medien.css")).toContain(".medien--liste");
  });
});
