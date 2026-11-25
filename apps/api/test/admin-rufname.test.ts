import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Rufname in der Verwaltung (#815): Cevi-Name, sonst Vorname, sonst voller Name. Erfundene Namen.
// dom.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let dom: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  const name: string = "dom.js";
  dom = (await import(/* @vite-ignore */ `../public/admin/${name}`)) as Modul;
  vi.unstubAllGlobals();
});

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

describe("rufname", () => {
  test("der Cevi-Name gilt zuerst", () => {
    expect(dom.rufname!({ name: "Anna Muster", ceviName: "Pfeil" })).toBe(
      "Pfeil",
    );
  });

  test("ohne Cevi-Name der Vorname: das erste Wort des Namens", () => {
    expect(dom.rufname!({ name: "Anna Muster", ceviName: null })).toBe("Anna");
    expect(dom.rufname!({ name: "Anna Muster" })).toBe("Anna");
  });

  test("ein ausdrücklicher Vorname geht dem ersten Wort vor", () => {
    expect(
      dom.rufname!({
        name: "Anna Lena Muster",
        ceviName: "",
        vorname: "Anna Lena",
      }),
    ).toBe("Anna Lena");
  });

  test("leere Strings und Leerzeichen zählen als nicht vorhanden", () => {
    expect(
      dom.rufname!({ name: "  Anna   Muster ", ceviName: "   ", vorname: " " }),
    ).toBe("Anna");
    expect(dom.rufname!({ name: "Anna Muster", ceviName: " Pfeil " })).toBe(
      "Pfeil",
    );
  });

  test("ohne Namen bleibt ein leerer Text, nie «undefined»", () => {
    expect(dom.rufname!({ name: "", ceviName: "" })).toBe("");
    expect(dom.rufname!({})).toBe("");
  });
});

describe("vollerNameZusatz", () => {
  test("der volle Name steht dabei, wenn er etwas Neues sagt", () => {
    expect(
      dom.vollerNameZusatz!({ name: "Anna Muster", ceviName: "Pfeil" }),
    ).toBe("Anna Muster");
    expect(dom.vollerNameZusatz!({ name: "Anna Muster", ceviName: "" })).toBe(
      "Anna Muster",
    );
  });

  test("entfällt, wenn Rufname und voller Name gleich sind", () => {
    expect(dom.vollerNameZusatz!({ name: "Pfeil", ceviName: "Pfeil" })).toBe(
      "",
    );
    expect(dom.vollerNameZusatz!({ name: "Anna", ceviName: null })).toBe("");
    expect(dom.vollerNameZusatz!({ name: " Anna ", ceviName: "" })).toBe("");
  });
});

describe("Hauptstellen nutzen die Regel", () => {
  test.each([
    ["mitglieder.js", "rufname({ name, ceviName, vorname })"],
    ["befehlspalette.js", "titel: rufname(p)"],
    ["admin.js", "name: rufname({ name: ich.name, ceviName })"],
    ["personen-blatt.js", "titel: person ? rufname(person)"],
    ["rechte-gemeinsam.js", "name: rufname(p)"],
    ["lager-personenwahl.js", "const ruf = rufname(p)"],
  ])("%s", (datei, stelle) => {
    expect(lies(datei)).toContain(stelle);
  });

  test("die Personenliste zeigt den vollen Namen als zweite Zeile, nicht mehr den Cevi-Namen", () => {
    const quelle = lies("mitglieder.js");
    expect(quelle).toContain('voll && el("span", { class: "mg-zweit" }, voll)');
    expect(quelle).not.toContain("ceviName && el(");
  });
});
