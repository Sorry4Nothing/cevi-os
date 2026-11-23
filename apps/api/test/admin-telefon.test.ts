import { describe, expect, test } from "vitest";
// @ts-expect-error reine Browser-Datei ohne Typen
import { normalisiereTelefon } from "../public/admin/telefon.js";

// Telefon im Feld der Personen (#594): tolerant beim Tippen, eine Schreibweise beim Speichern. Der Server prüft weiter selbst (src/telefon.ts)
describe("Telefonnummer schreiben", () => {
  test("Schweizer Nummern bekommen die Gruppen +41 79 123 45 67", () => {
    for (const eingabe of [
      "079 123 45 67",
      "0791234567",
      "+41791234567",
      "0041 79 123 45 67",
      "079/123.45.67",
      "(079) 123-45-67",
    ]) {
      expect(normalisiereTelefon(eingabe)).toEqual({
        wert: "+41 79 123 45 67",
        gueltig: true,
        vorschau: "+41 79 123 45 67",
      });
    }
  });

  test("leer entfernt die Nummer und ist gültig", () => {
    expect(normalisiereTelefon("  ")).toEqual({
      wert: "",
      gueltig: true,
      vorschau: "",
    });
  });

  test("Nummern aus dem Ausland bleiben, wie sie getippt wurden", () => {
    expect(normalisiereTelefon("+49  30 1234567").wert).toBe("+49 30 1234567");
  });

  test("zu kurz oder mit Buchstaben ist ungültig", () => {
    expect(normalisiereTelefon("12").gueltig).toBe(false);
    expect(normalisiereTelefon("079 abc 45 67").gueltig).toBe(false);
    expect(normalisiereTelefon("0791").vorschau).toBe("");
  });
});
