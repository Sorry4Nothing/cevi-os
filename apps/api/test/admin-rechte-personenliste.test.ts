import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as m from "../public/admin/rechte-modell.js";

// «Was darf wer?» > Person (#661): Rolle im Klartext, gleiche Namen unterscheidbar, Suche, Aufbau der Karte
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const stufen = new Map([
  ["s1", "Artemis"],
  ["s2", "Exodus"],
]);
const lua1 = {
  name: "Lua Demo",
  benutzername: "lua.demo",
  ceviName: "Lua",
  abteilungsleitung: false,
  rollen: [{ typ: "stufenleitung", stufeId: "s1" }],
};
const lua2 = {
  name: "Lua Demo",
  benutzername: "lua.demo2",
  ceviName: null,
  abteilungsleitung: false,
  rollen: [{ typ: "leitung", stufeId: "s2" }],
};
const chef = {
  name: "Jonas Demo",
  benutzername: "jonas",
  abteilungsleitung: true,
  rollen: [],
};
const nichts = {
  name: "Mia Probe",
  benutzername: "mia",
  abteilungsleitung: false,
  rollen: [],
};

describe("Personenliste von «Was darf wer?»", () => {
  test("die Rolle steht im Klartext, mehrere mit Komma, ohne Rolle leer", () => {
    expect(m.rolleText(lua1, stufen)).toBe("Stufenleitung Artemis");
    expect(m.rolleText(lua2, stufen)).toBe("Gruppenleitung Exodus");
    expect(m.rolleText(chef, stufen)).toBe("Abteilungsleitung");
    expect(m.rolleText(nichts, stufen)).toBe("");
    expect(m.rolleText({ ...chef, rollen: lua1.rollen }, stufen)).toBe(
      "Abteilungsleitung, Stufenleitung Artemis",
    );
    // Eine Stufe, die es nicht mehr gibt, lässt die Rolle ohne Namen stehen
    expect(m.rolleText(lua1, new Map())).toBe("Stufenleitung");
  });

  test("die Rolle folgt dem Geschlecht der Person, die Suche findet beide Formen (#817)", () => {
    const frau = { ...lua1, geschlecht: "w" };
    const mann = { ...lua2, geschlecht: "m" };
    expect(m.rolleText(frau, stufen)).toBe("Stufenleiterin Artemis");
    expect(m.rolleText(mann, stufen)).toBe("Gruppenleiter Exodus");
    expect(m.rolleText({ ...frau, geschlecht: null }, stufen)).toBe(
      "Stufenleitung Artemis",
    );
    const [z] = m.listenZeilen([frau], stufen);
    expect(m.passtZurSuche(z, "stufenleiterin")).toBe(true);
    expect(m.passtZurSuche(z, "stufenleitung")).toBe(true);
  });

  test("gleiche Namen bekommen Cevi-Name und Benutzername als Merkmal, die anderen nicht", () => {
    const zeilen = m.listenZeilen([lua1, lua2, chef, nichts], stufen);
    expect(zeilen.map((z: { zusatz: string }) => z.zusatz)).toEqual([
      "Lua · lua.demo",
      "lua.demo2",
      "",
      "",
    ]);
    expect(m.doppelteNamen([lua1, chef, lua1]).size).toBe(1);
    expect(m.doppelteNamen([chef, nichts]).size).toBe(0);
  });

  test("die Suche findet nach Name, Cevi-Name, Benutzername und Rolle", () => {
    const [z1, z2] = m.listenZeilen([lua1, lua2], stufen);
    expect(m.passtZurSuche(z1, "")).toBe(true);
    expect(m.passtZurSuche(z1, "  LUA ")).toBe(true);
    expect(m.passtZurSuche(z2, "demo2")).toBe(true);
    expect(m.passtZurSuche(z1, "demo2")).toBe(false);
    expect(m.passtZurSuche(z2, "exodus")).toBe(true);
    expect(m.passtZurSuche(z1, "stufenleitung")).toBe(true);
  });

  test("die Zahl der Treffer als Satz", () => {
    expect(m.anzahlText(0)).toBe("Keine Person gefunden");
    expect(m.anzahlText(1)).toBe("1 Person");
    expect(m.anzahlText(20)).toBe("20 Personen");
  });

  test("die Karte hat feste Höhe, die Liste scrollt in ihr, die Suche bleibt oben und wächst nicht in die Höhe", () => {
    const css = lies("rechte.css");
    // Ursache des Leerraums: .suche hat flex: 1 1 280px, in einer Spalte wird daraus eine Höhe
    expect(css).toMatch(
      /\.rr-wahl-block \.suche \{\s+flex: none;\s+max-width: none;/,
    );
    expect(css).toMatch(
      /\.rr-wahl-block \{[^}]*position: sticky;[^}]*max-height: min\(46rem/,
    );
    expect(css).toMatch(/\.rr-wahlliste \{[^}]*overflow-y: auto;/);
    expect(lies("rechte-uebersicht.js")).toContain("rr-wahlkopf");
  });
});
