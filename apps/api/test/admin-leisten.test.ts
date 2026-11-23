import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Die Leisten der Verwaltung (#661, #667): Höhen, Schrift und Strich wie auf der Website (website/kopf.css)
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

describe("Leisten der Verwaltung", () => {
  const css = lies("geruest.css");
  const website = readFileSync(
    new URL("../public/website/kopf.css", import.meta.url),
    "utf8",
  );

  test("Höhen als Tokens wie auf der Website: 4rem/3rem, ab 106 em 4.5rem, Unterleiste 44 px", () => {
    expect(css).toContain("--logozeile-hoehe: 4rem;");
    expect(css).toContain("--nav-hoehe: calc(3rem + 2px);");
    expect(css).toContain("--unter-hoehe: calc(2.75rem + 1px);");
    expect(css).toMatch(
      /@media \(min-width: 106em\) \{\s+:root \{\s+--logozeile-hoehe: 4\.5rem;\s+--nav-hoehe: 4\.5rem;/,
    );
    // Dieselben Werte hat die Website (Zeile 72 px, Navigation 48 px, Unterleiste 44 px)
    expect(website).toContain("--kopf-zeile: 4rem;");
    expect(website).toContain("--nav-hoehe: 3rem;");
    expect(website).toContain("--kopf-zeile: 4.5rem;");
    expect(website).toMatch(/\.unterleiste a \{[^}]*min-height: 2\.75rem;/);
    expect(css).toMatch(/\.logozeile \{\s+height: var\(--logozeile-hoehe\);/);
    expect(css).toMatch(/\.bereichsleiste \{\s+height: var\(--nav-hoehe\);/);
    expect(css).toMatch(/\.unterleiste \{\s+height: var\(--unter-hoehe\);/);
    // Die Zeile der Bereichsauswahl (schmal) ist ebenso hoch wie die Logozeile: Linien oben und unten eingerechnet
    expect(css).toMatch(
      /@media \(max-width: 960px\) \{\s+:root \{\s+--nav-hoehe: 4rem;/,
    );
    expect(css).toMatch(
      /\.bereichswahl-zeile \{[^}]*min-height: calc\(var\(--leiste-hoehe\) - 2px\)/,
    );
  });

  test("Bereichsleiste wie die Hauptnavigation der Website: Schrift, Abstand, roter Strich", () => {
    expect(css).toMatch(
      /\.bereichsleiste a,\s+\.unterleiste a \{[^}]*padding: 0 0\.75rem;[^}]*font-size: 1rem;[^}]*font-weight: 600;/,
    );
    expect(css).toMatch(/\.bereichsleiste a::before \{[^}]*height: 3px;/);
    expect(css).toMatch(
      /\.bereichsleiste a\[aria-current\],\s+\.unterleiste a\[aria-current="page"\] \{\s+color: var\(--titel\);\s+font-weight: 800;/,
    );
  });

  test("Unterleiste wie die der Website: 0.9375rem, Gewicht 500, unterstrichen beim Zeigen, aktiv mit Strich unten", () => {
    expect(css).toMatch(
      /\.unterleiste a \{\s+font-size: 0\.9375rem;\s+font-weight: 500;/,
    );
    expect(css).toMatch(
      /\.unterleiste a:hover \{\s+text-decoration: underline;/,
    );
    expect(css).toMatch(
      /\.unterleiste a\[aria-current="page"\] \{[^}]*box-shadow: inset 0 -3px 0 var\(--primary\)/,
    );
    expect(css).not.toMatch(/\.unterleiste a::before/);
  });

  test("Logo und Knöpfe der Logozeile wie im Kopf der Website", () => {
    expect(css).toMatch(/\.logo \{[^}]*height: 2\.25rem;/);
    expect(css).toMatch(
      /\.logozeile \.knopf \{[^}]*min-height: 2\.75rem;[^}]*padding: 0 1\.125rem 0 0\.875rem;[^}]*font-size: 1rem;[^}]*font-weight: 600;/,
    );
  });

  test("schmal bleibt die Logozeile eine Zeile: nur Symbole, «Abmelden» als Symbol", () => {
    expect(css).toMatch(/\.abmelden-text,\s+\.palette-knopf-text/);
    expect(css).not.toMatch(/\.logozeile \.breite \{[^}]*flex-wrap: wrap/);
    expect(lies("rahmen.js")).toContain('class: "abmelden-text"');
  });
});
