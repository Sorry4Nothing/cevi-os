import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Reiter «Vorschläge» (#441): Er ruft nur die Routen der Abteilungsleitung aus #440 auf und schreibt nie anders als über «entscheid» und «eingetragen»
describe("Admin-Panel: Termine, Reiter Vorschläge", () => {
  const modul = lies("termine-vorschlaege.js");

  test("Modul und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain(
      'href="/admin/termine-vorschlaege.css"',
    );
    expect(lies("navigation.js")).toContain('"./termine-vorschlaege.js"');
  });

  test("lesen über GET, schreiben nur über entscheid und eingetragen", () => {
    expect(modul).toContain('"/api/v1/admin/termin-vorschlaege"');
    expect([...modul.matchAll(/anfrage\("(\w+)"/g)].map((t) => t[1])).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(modul).toContain('pfad: "entscheid"');
    expect(modul).toContain('pfad: "eingetragen"');
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    expect(modul).not.toMatch(/setInterval|\.style\b|setAttribute\("style"/);
  });
});
