import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Bereich «Anwesenheit» (#195): Er liest nur die vorhandene Route der Stufen; eine eigene Admin-Route gibt es nicht
describe("Admin-Panel: Anwesenheit", () => {
  test("Modul, Stilvorlage und Bereich sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/anwesenheit.css"');
    const navigation = lies("navigation.js");
    expect(navigation).toContain('"./anwesenheit.js"');
    expect(navigation).toContain('schluessel: "anwesenheit"');
  });

  test("das Modul ruft nur die lesende Route der Stufen auf", () => {
    const modul = lies("anwesenheit.js");
    expect(modul).toContain("/api/v1/stufen/${id}/anwesenheit?anzahl=");
    expect(modul).not.toMatch(/anfrage\("(PUT|POST|PATCH|DELETE)"/);
  });
});
