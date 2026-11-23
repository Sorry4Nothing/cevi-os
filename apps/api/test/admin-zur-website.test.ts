import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// «Zur Website» im Kopf der Verwaltung (#669): neben dem Logo, das Logo bleibt die Übersicht der Verwaltung
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

test("die Logozeile hat einen Link «Zur Website» mit sichtbarem Text, Ziel «/» und Symbol; das Logo führt in die Verwaltung", () => {
  const rahmen = lies("rahmen.js");
  const kopf = rahmen.slice(rahmen.indexOf("export function logozeile"));
  expect(kopf).toMatch(
    /class: "zur-website", href: "\/" \},\s*icon\("website"\),\s*el\("span", \{ class: "zur-website-text" \}, "Zur Website"\)/,
  );
  // Neben dem Logo: hinter dem Namen des Bereichs, vor dem Konto
  expect(kopf.indexOf("zur-website")).toBeGreaterThan(
    kopf.indexOf("bereichname"),
  );
  expect(kopf.indexOf("zur-website")).toBeLessThan(kopf.indexOf("kopf-rechts"));
  // Das Logo bleibt die Übersicht der Verwaltung (Adresse «#»), nicht die Website
  expect(rahmen.match(/class: "marke", href: "#"/g)).toHaveLength(1);
  expect(rahmen).toContain('href: "#",');
});

test("Fläche mindestens 44 px; schmal bleibt das Symbol, der Name bleibt für Screenreader; ganz schmal steht der Link im Bereichsmenü", () => {
  const css = lies("geruest.css");
  const regel = /\.zur-website \{([^}]*)\}/.exec(css)![1]!;
  expect(regel).toContain("min-height: 2.75rem");
  expect(regel).toContain("min-width: 2.75rem");
  expect(css).toMatch(/\.zur-website-text \{[^}]*clip-path: inset\(50%\)/);
  expect(css).toMatch(
    /@media \(max-width: 520px\) \{\s*\.zur-website \{\s*display: none/,
  );
  const rahmen = lies("rahmen.js");
  expect(rahmen).toContain('class: "bereichswahl-website"');
  expect(rahmen).toContain('el("span", {}, "Zur Website")');
});
