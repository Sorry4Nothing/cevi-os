import { describe, expect, test, vi } from "vitest";

// Die Module der Verwaltung hängen beim Laden Ereignisse an window und document: eine leere Hülle genügt
const leer = {
  addEventListener() {},
  location: { hash: "" },
  history: {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
vi.stubGlobal("window", leer);
vi.stubGlobal("document", { ...leer, querySelector: () => null });
// Browser-Modul ohne Typen: der Pfad steht in einer Variablen, damit TypeScript es nicht auflöst
const laden = (datei: string) =>
  import(/* @vite-ignore */ `../public/admin/${datei}`);
const { vorZeit } = await laden("dom.js");

const JETZT = Date.parse("2026-11-24T12:00:00Z");
const vor = (sekunden: number) =>
  vorZeit(new Date(JETZT - sekunden * 1000).toISOString(), JETZT);
const MIN = 60;
const STD = 3600;
const TAG = 86400;

describe("Relative Zeit (#763)", () => {
  test("die Einheit wächst mit dem Abstand", () => {
    expect(vor(20)).toBe("gerade eben");
    expect(vor(5 * MIN)).toBe("vor 5 Minuten");
    expect(vor(3 * STD)).toBe("vor 3 Stunden");
    expect(vor(41 * STD)).toBe("vorgestern");
    expect(vor(1 * TAG + 2 * STD)).toBe("gestern");
    expect(vor(4 * TAG)).toBe("vor 4 Tagen");
    expect(vor(15 * TAG)).toBe("vor 2 Wochen");
    expect(vor(100 * TAG)).toBe("vor 3 Monaten");
    expect(vor(800 * TAG)).toBe("vor 2 Jahren");
  });

  test("nie eine Zahl in Stunden oder Tagen, die in eine grössere Einheit passt", () => {
    for (const tage of [2, 6, 7, 29, 30, 344, 345, 365, 3000]) {
      const text = vor(tage * TAG);
      const zahl = Number(/\d+/.exec(text)?.[0] ?? 0);
      if (text.includes("Tagen")) expect(zahl).toBeLessThan(7);
      if (text.includes("Wochen")) expect(zahl).toBeLessThan(5);
      if (text.includes("Monaten")) expect(zahl).toBeLessThan(12);
      expect(text).not.toMatch(/Stunden/);
    }
    expect(vor(47 * STD)).not.toMatch(/Stunden/);
  });

  test("Einzahl, und eine Zeit in der Zukunft rechnet gleich", () => {
    expect(vor(1 * MIN)).toBe("vor 1 Minute");
    expect(vor(1 * STD)).toBe("vor 1 Stunde");
    expect(vorZeit(new Date(JETZT + 3 * STD * 1000).toISOString(), JETZT)).toBe(
      "in 3 Stunden",
    );
  });
});
