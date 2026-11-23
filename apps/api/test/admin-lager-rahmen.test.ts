import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Arbeitsbereich des Lagers (#672): Register, Navigation nach Rechten, Einbau in lager.js; ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let rahmen: Modul;
let register: { GRUPPEN: string[]; MODULE: Eintrag[] };
type Eintrag = {
  schluessel: string;
  titel: string;
  gruppe: string;
  recht?: string;
  laden: () => unknown;
};

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  rahmen = (await import(
    /* @vite-ignore */ "../public/admin/lager-rahmen.js"
  )) as Modul;
  register = (await import(
    /* @vite-ignore */ "../public/admin/lager-module.js"
  )) as typeof register;
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

const ctxMit = (...rechte: string[]) => ({
  zugang: { darf: (r: string) => rechte.includes(r) },
});

describe("Lager: Arbeitsbereich", () => {
  test("sichtbar: ohne recht für alle, mit «a|b» genügt eines, verwalten folgt dem Recht der Abteilung", () => {
    const mit = (e: object, rechte: string[], ctx = ctxMit()) =>
      rahmen.sichtbar!(e, { rechte: new Set(rechte), ctx });
    expect(mit({ schluessel: "heute" }, [])).toBe(true);
    expect(mit({ recht: "check.lesen" }, [])).toBe(false);
    expect(mit({ recht: "check.lesen" }, ["check.lesen"])).toBe(true);
    expect(mit({ recht: "a.lesen|b.lesen" }, ["b.lesen"])).toBe(true);
    expect(mit({ verwalten: "rechte.verwalten" }, [])).toBe(false);
    expect(
      mit({ verwalten: "rechte.verwalten" }, [], ctxMit("rechte.verwalten")),
    ).toBe(true);
  });

  test("gruppiere: Reihenfolge der Gruppen, unbekannte dahinter, leere fehlen", () => {
    const g = rahmen.gruppiere!([
      { schluessel: "a", gruppe: "Lager" },
      { schluessel: "b", gruppe: "Start" },
      { schluessel: "c", gruppe: "Sonst" },
      { schluessel: "d", gruppe: "Start" },
    ]) as { name: string; eintraege: { schluessel: string }[] }[];
    expect(g.map((x) => x.name)).toEqual(["Start", "Lager", "Sonst"]);
    expect(g[0]!.eintraege.map((e) => e.schluessel)).toEqual(["b", "d"]);
  });

  test("startModul: das erste der Gruppe «Start», sonst das erste überhaupt", () => {
    const eintraege = [
      { schluessel: "x", gruppe: "Lager" },
      { schluessel: "h", gruppe: "Start" },
    ];
    expect(rahmen.startModul!(eintraege).schluessel).toBe("h");
    expect(rahmen.startModul!([eintraege[0]]).schluessel).toBe("x");
    expect(rahmen.startModul!([])).toBeNull();
  });

  test("das Register hat eindeutige Schlüssel, bekannte Gruppen und ein Recht des Katalogs", () => {
    const katalog = quelle("../../src/lager/rechte-katalog.ts");
    const schluessel = register.MODULE.map((m) => m.schluessel);
    expect(new Set(schluessel).size).toBe(schluessel.length);
    for (const m of register.MODULE) {
      expect(register.GRUPPEN).toContain(m.gruppe);
      expect(typeof m.laden).toBe("function");
      for (const r of (m.recht ?? "").split("|").filter(Boolean))
        expect(katalog).toContain(`"${r}"`);
      // Jedes Modul liegt in einer Datei lager-m-<schluessel>.js
      expect(quelle(`lager-m-${m.schluessel}.js`)).toContain(
        "export function zeige",
      );
    }
  });

  test("lager.js hängt jede Adresse unter einer Lager-ID in den Rahmen; Öffnen steht in der Liste", () => {
    const l = quelle("lager.js");
    expect(l).toContain("lager-rahmen.js");
    expect(l).toContain("zeigeRahmen");
    expect(l).toContain('"Öffnen"');
  });

  test("der Rahmen nutzt die eigene Navigation mit aria-current und kein localStorage", () => {
    const q = quelle("lager-rahmen.js");
    expect(q).toContain('"aria-current": "page"');
    expect(q).toContain("/api/v1/lager/");
    expect(q).not.toMatch(/localStorage|sessionStorage/);
    // Der Suchbegriff bleibt aus der Adresse
    expect(q).toContain("suchbegriff.frage");
  });
});
