import { describe, expect, test } from "vitest";
// @ts-expect-error reine Browser-Datei ohne Typen
import { rollenName } from "../public/admin/rollenname.js";

describe("rollenName (#817)", () => {
  test.each([
    ["stufenleitung", "m", "Stufenleiter"],
    ["stufenleitung", "w", "Stufenleiterin"],
    ["stufenleitung", "d", "Stufenleitung"],
    ["stufenleitung", null, "Stufenleitung"],
    ["stufenleitung", undefined, "Stufenleitung"],
    ["leitung", "m", "Gruppenleiter"],
    ["leitung", "w", "Gruppenleiterin"],
    ["leitung", "d", "Gruppenleitung"],
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
