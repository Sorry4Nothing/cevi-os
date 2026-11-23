import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Kästchen und Profilbilder im Lager (#668): Es gibt in der Verwaltung kein rohes Browser-Kästchen, und Personen im Lager zeigen ihr Bild
const ordner = new URL("../public/admin/", import.meta.url);
const lies = (datei: string) => readFileSync(new URL(datei, ordner), "utf8");
const dateien = (ende: string) =>
  readdirSync(ordner).filter((d) => d.endsWith(ende));

describe("Kästchen der Verwaltung", () => {
  const css = lies("admin.css");

  test("jedes Kästchen trägt die gemeinsame Gestaltung, auch ohne .wahl", () => {
    expect(css).toMatch(
      /\.wahl input,\s+input\[type="checkbox"\] \{\s+appearance: none;/,
    );
    // Haken, Hover, deaktiviert, Bewegung und erzwungene Farben sind für alle Kästchen da
    for (const regel of [
      /input\[type="checkbox"\]::after \{/,
      /input\[type="checkbox"\]:checked \{/,
      /label:hover > input\[type="checkbox"\]:not\(:checked, :disabled\)/,
      /input\[type="checkbox"\]:disabled \{/,
      /@media \(prefers-reduced-motion: no-preference\) \{\s+\.wahl input,\s+input\[type="checkbox"\]/,
      /@media \(forced-colors: active\) \{\s+\.wahl input,\s+input\[type="checkbox"\]/,
    ]) {
      expect(css).toMatch(regel);
    }
  });

  test("kein Stylesheet der Verwaltung zeichnet ein Kästchen mit accent-color nach", () => {
    for (const datei of dateien(".css")) {
      expect(lies(datei), datei).not.toMatch(/accent-color/);
    }
  });

  test("Kästchen im Lager sitzen in einer Zeile mit Zielfläche von mindestens 44 px", () => {
    const lager = lies("lager.css");
    expect(lager).toMatch(/\.lg-person \{[^}]*min-height: 3\.25rem/);
    expect(lager).toMatch(/\.lg-schalter \{[^}]*min-height: 2\.75rem/);
    expect(lager).not.toMatch(/\.lg-(person|schalter) input \{/);
  });
});

describe("Profilbilder im Lager", () => {
  test("jeder Kreis mit Namen im Lager bekommt die Bild-Angabe der Person", () => {
    for (const datei of dateien(".js").filter((d) => d.startsWith("lager"))) {
      const q = lies(datei);
      for (const treffer of q.matchAll(/\bavatar\(([^)]*\))/g)) {
        expect(treffer[0], datei).toContain("bildUrl");
      }
    }
  });
});
