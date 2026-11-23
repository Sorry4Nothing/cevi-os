import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Die drei Leisten der Verwaltung (#661): Logozeile, Bereichsleiste und Unterleiste sind gleich hoch
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

describe("Leisten der Verwaltung", () => {
  const css = lies("geruest.css");

  test("eine Höhe als Token, alle drei Leisten nehmen sie", () => {
    expect(css).toContain("--leiste-hoehe: 3.5rem;");
    expect(css).toMatch(
      /\.logozeile,\s+\.bereichsleiste,\s+\.unterleiste \{\s+box-sizing: border-box;\s+height: var\(--leiste-hoehe\);/,
    );
    // Die Zeile der Bereichsauswahl (schmal) ist ebenso hoch: Linien oben und unten eingerechnet
    expect(css).toMatch(
      /\.bereichswahl-zeile \{[^}]*min-height: calc\(var\(--leiste-hoehe\) - 2px\)/,
    );
    // Keine eigene Höhe mehr für die Logozeile
    expect(css).not.toMatch(/\.logozeile \.breite \{[^}]*min-height: 4rem/);
  });

  test("Bereichs- und Unterleiste teilen Schrift, Abstand und Strich", () => {
    expect(css).toMatch(
      /\.bereichsleiste a,\s+\.unterleiste a \{[^}]*padding: 0 0\.75rem;[^}]*font-size: 1rem;/,
    );
    expect(css).toMatch(
      /\.bereichsleiste a::before,\s+\.unterleiste a::before \{[^}]*height: 3px;/,
    );
  });

  test("schmal bleibt die Logozeile eine Zeile: nur Symbole, «Abmelden» als Symbol", () => {
    expect(css).toMatch(/\.abmelden-text,\s+\.palette-knopf-text/);
    expect(css).not.toMatch(/\.logozeile \.breite \{[^}]*flex-wrap: wrap/);
    expect(lies("rahmen.js")).toContain('class: "abmelden-text"');
  });
});
