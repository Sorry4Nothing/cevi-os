import { describe, expect, test } from "vitest";
import { MAX_EINTRAEGE, teileMitnehmen } from "../src/website/mitnehmen.js";

// «Mitnehmen» der Stufenseite als Liste (#645)
describe("teileMitnehmen", () => {
  test("Komma, Strichpunkt und Zeilenumbruch trennen; Reihenfolge und Wortlaut bleiben", () => {
    expect(
      teileMitnehmen(
        "Cevi-Kluft, zu trinken; Zvieri\r\nwarme Outdoor-Kleidung\nSchuhe für in den Wald",
      ),
    ).toEqual([
      "Cevi-Kluft",
      "zu trinken",
      "Zvieri",
      "warme Outdoor-Kleidung",
      "Schuhe für in den Wald",
    ]);
  });

  test("ein Komma in Klammern trennt nicht", () => {
    expect(
      teileMitnehmen("Kluft, Kleidung (warm, wetterfest), evtl. Regenschutz"),
    ).toEqual(["Kluft", "Kleidung (warm, wetterfest)", "evtl. Regenschutz"]);
  });

  test("eine offene Klammer verschluckt den Rest nicht", () => {
    expect(teileMitnehmen("Kluft (warm, Zvieri")).toEqual([
      "Kluft (warm",
      "Zvieri",
    ]);
    expect(teileMitnehmen("Kluft warm), Zvieri")).toEqual([
      "Kluft warm)",
      "Zvieri",
    ]);
  });

  test("Aufzählungszeichen, Leerraum und leere Teile fallen weg", () => {
    expect(teileMitnehmen("- Velo mit  Licht\n• Helm\n\n  ,, Hut  ")).toEqual([
      "Velo mit Licht",
      "Helm",
      "Hut",
    ]);
  });

  test("Markup bleibt Text (der Renderer maskiert)", () => {
    expect(teileMitnehmen("<b>x</b>, a & b")).toEqual(["<b>x</b>", "a & b"]);
  });

  test("keine Liste: leer, ein Ding oder ein Satz ohne Trenner", () => {
    expect(teileMitnehmen("")).toBeNull();
    expect(teileMitnehmen("   \n  ")).toBeNull();
    expect(teileMitnehmen("Trinkflasche")).toBeNull();
    expect(teileMitnehmen("Warme Kleidung und eine Trinkflasche")).toBeNull();
    expect(teileMitnehmen("Kluft,")).toBeNull();
  });

  test("höchstens 30 Einträge: genau 30 sind eine Liste, 31 bleiben ein Text", () => {
    const n = (k: number) =>
      Array.from({ length: k }, (_, i) => `Ding ${i + 1}`).join(", ");
    expect(teileMitnehmen(n(MAX_EINTRAEGE))).toHaveLength(30);
    expect(teileMitnehmen(n(MAX_EINTRAEGE + 1))).toBeNull();
  });
});
