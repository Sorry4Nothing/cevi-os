import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Arbeitsbereich des Lagers (#672): Register, Navigation nach Rechten, Einbau in lager.js; ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let rahmen: Modul;
let suche: Modul;
let benachrichtigungen: Modul;
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
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  rahmen = await lade("lager-rahmen.js");
  register = (await lade("lager-module.js")) as unknown as typeof register;
  suche = await lade("lager-m-suche.js");
  benachrichtigungen = await lade("lager-m-benachrichtigungen.js");
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

  test("Suche: Treffer öffnen nur ein sichtbares Modul, sonst keinen Link", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const t = { typ: "ressort", id: "00000000-0000-4000-8000-000000000002" };
    expect(suche.trefferAdresse!(id, t, ["ressorts"])).toBe(
      `#lager/lager/${id}/ressorts/${t.id}`,
    );
    expect(suche.trefferAdresse!(id, t, ["heute"])).toBeNull();
    expect(
      suche.trefferAdresse!(id, { typ: "unbekannt", id: "x" }, ["x"]),
    ).toBeNull();
  });

  test("Suche: der Suchbegriff geht nicht in die Adresse", () => {
    const q = quelle("lager-m-suche.js");
    expect(q).toContain("suchbegriff.frage");
    expect(q).not.toMatch(/location.hashs*=[^;]*frage/);
  });

  test("Benachrichtigungen: Ziel nach Typ, Adressbuch ohne Objekt-ID", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const e = {
      objektTyp: "aufgabe",
      objektId: "00000000-0000-4000-8000-000000000003",
    };
    expect(benachrichtigungen.zielAdresse!(id, e, ["aufgaben"])).toBe(
      `#lager/lager/${id}/aufgaben/${e.objektId}`,
    );
    expect(
      benachrichtigungen.zielAdresse!(
        id,
        { objektTyp: "adressbuch", objektId: id },
        ["adressbuch"],
      ),
    ).toBe(`#lager/lager/${id}/adressbuch`);
    expect(benachrichtigungen.zielAdresse!(id, e, [])).toBeNull();
  });

  test("Schreibende Module behandeln Versionskonflikte und geschlossene Lager", () => {
    for (const datei of [
      "lager-start-teile.js",
      "lager-m-check.js",
      "lager-m-ressorts.js",
    ])
      expect(quelle(datei)).toMatch(/konfliktHinweis|konfliktText/);
    expect(quelle("lager-konflikt.js")).toContain("VERSION_KONFLIKT");
    expect(quelle("lager-konflikt.js")).toContain("LAGER_GESCHLOSSEN");
  });

  test("Der Event-Stream ist einer je Lager und kein Takt", () => {
    const q = quelle("lager-ereignisse.js");
    expect(q).toContain("/ereignisse");
    expect(q).not.toMatch(/setInterval/);
  });
});
