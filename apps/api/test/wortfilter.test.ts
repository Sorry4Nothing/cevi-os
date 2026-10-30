import { describe, expect, test } from "vitest";
import { enthaeltVerbotenes, WORTFILTER_ANTWORT } from "../src/wortfilter.js";

describe("enthaeltVerbotenes", () => {
  test.each([
    "Du Arschloch",
    "ARSCHLOCH",
    "Ihr seid alles Arschlöcher",
    "Riesenarschloch!",
    "Hurensohn",
    "so eine Nutte",
    "Sieg Heil",
    "du   Schwuchtel",
    "fotze",
  ])("lehnt «%s» ab", (text) => {
    expect(enthaeltVerbotenes(text)).toBe(true);
  });

  test.each([
    "Treffpunkt ist um 14 Uhr beim Pfadiheim",
    "Wir fahren in die Mongolei",
    "Frau Nuttall bringt den Kuchen",
    "Die Spastik-Therapie startet am Montag",
    "Das Gebäude ist gross und die Strasse weiss",
    "Heil geblieben sind alle, siegreich auch",
    "",
  ])("lässt «%s» durch", (text) => {
    expect(enthaeltVerbotenes(text)).toBe(false);
  });

  test("die Antwort nennt den Grund auf Deutsch, ohne das Wort zu wiederholen", () => {
    expect(WORTFILTER_ANTWORT.code).toBe("NACHRICHT_ABGELEHNT");
    expect(WORTFILTER_ANTWORT.message).toMatch(/nicht erlaubt/);
  });
});
