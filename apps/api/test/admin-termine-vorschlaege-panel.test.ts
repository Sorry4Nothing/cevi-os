import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Unterseite «Vorschläge» (#441, A9, A10): Sie ruft nur die Routen der Abteilungsleitung auf und schreibt nie anders als über «entscheid» und «eingetragen»
describe("Panel der Abteilungsleitung: Termine, Vorschläge", () => {
  const modul = lies("termine-vorschlaege.js");

  test("Modul und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain(
      'href="/admin/termine-vorschlaege.css"',
    );
    expect(lies("navigation.js")).toContain('"./termine-vorschlaege.js"');
  });

  test("lesen über GET, schreiben nur über entscheid und eingetragen", () => {
    expect(modul).toContain('"/api/v1/admin/termin-vorschlaege"');
    expect(
      [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]),
    ).toEqual(["GET", "GET", "POST"]);
    expect(modul).toContain('pfad: "entscheid"');
    expect(modul).toContain('pfad: "eingetragen"');
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    expect(modul).not.toMatch(/setInterval|\.style\b|setAttribute\("style"/);
  });
});
