import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error reine Browser-Datei ohne Typen
import { rollenName } from "../public/admin/rollenname.js";

describe("rollenName (#817)", () => {
  test.each([
    ["stufenleitung", "m", "Stufenleiter"],
    ["stufenleitung", "w", "Stufenleiterin"],
    ["stufenleitung", null, "Stufenleitung"],
    ["stufenleitung", undefined, "Stufenleitung"],
    ["leitung", "m", "Gruppenleiter"],
    ["leitung", "w", "Gruppenleiterin"],
    ["leitung", null, "Gruppenleitung"],
  ])("%s, %s: %s", (typ, geschlecht, erwartet) => {
    expect(rollenName(typ, geschlecht)).toBe(erwartet);
  });

  test("ein unbekannter Wert bleibt, wie er ist; ohne Wert leer", () => {
    expect(rollenName("Kassier", "w")).toBe("Kassier");
    expect(rollenName(null, "w")).toBe("");
    expect(rollenName("toString", "m")).toBe("toString");
  });
});

describe("Auswahl Geschlecht im Blatt der Person (#849, #857)", () => {
  test("zwei Optionen: Weiblich und Männlich (ohne «andere» und seit #857 ohne «Keine Angabe»)", async () => {
    // Die Module der Verwaltung hängen beim Laden Zuhörer an document und window; ohne Browser genügt eine Attrappe
    vi.stubGlobal("document", { addEventListener: () => {} });
    vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
    const name: string = "personen-blatt.js";
    const blatt = (await import(
      /* @vite-ignore */ `../public/admin/${name}`
    )) as { GESCHLECHT_WAHL: [string, string][] };
    vi.unstubAllGlobals();
    expect(blatt.GESCHLECHT_WAHL).toEqual([
      ["w", "Weiblich"],
      ["m", "Männlich"],
    ]);
    // Das Blatt lädt viele Module der Verwaltung; unter Last dauert das länger als die üblichen 5 Sekunden
  }, 60_000);

  test("Pflicht beim Erfassen und Bearbeiten, mit Fehler beim Feld; ohne Angabe der Hinweis «Geschlecht fehlt» (#857)", () => {
    const blatt = readFileSync(
      new URL("../public/admin/personen-blatt.js", import.meta.url),
      "utf8",
    );
    expect(blatt).not.toContain("Geschlecht (optional)");
    expect(blatt).toContain('"aria-required": "true"');
    expect(blatt).toContain("Geschlecht fehlt.");
    expect(blatt).toMatch(
      /if \(!geschlecht\.wert\(\)\) \{\s*feldFehler\(geschlecht, "Wähle Weiblich oder Männlich\."\);\s*fehlt\.push\(\{ name: "Geschlecht"/,
    );
    // Das Blatt sendet die Wahl immer, nie mehr «undefined» oder null
    expect(blatt).not.toContain("geschlecht.wert() ?? undefined");
  });
});
