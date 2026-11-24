import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Lager: Ladezustände und Bewegung (#686); ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let bewegung: Modul;
let skeleton: Modul & { SKELETON_ARTEN: string[] };
let register: { MODULE: { schluessel: string }[] };
let status: Modul & { STATUS_SATZ: Record<string, string> };

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  bewegung = await lade("lager-bewegung.js");
  skeleton = (await lade("lager-skeleton.js")) as typeof skeleton;
  register = (await lade("lager-module.js")) as unknown as typeof register;
  status = (await lade("lager-status.js")) as typeof status;
  vi.unstubAllGlobals();
});

// Schneidet die Blöcke «@media (… prefers-reduced-motion: no-preference …) { … }» samt Inhalt heraus
function ohneBewegung(css: string): string {
  const aus: string[] = [];
  let i = 0;
  while (i < css.length) {
    const start = css.indexOf("@media", i);
    if (start < 0) {
      aus.push(css.slice(i));
      break;
    }
    const klammer = css.indexOf("{", start);
    const kopf = css.slice(start, klammer);
    let tiefe = 1;
    let j = klammer + 1;
    while (j < css.length && tiefe > 0) {
      if (css[j] === "{") tiefe++;
      else if (css[j] === "}") tiefe--;
      j++;
    }
    aus.push(css.slice(i, start));
    if (!kopf.includes("prefers-reduced-motion: no-preference"))
      aus.push(css.slice(start, j));
    i = j;
  }
  return aus.join("");
}

describe("Lager: Ladezustände", () => {
  test("jedes Modul des Registers hat einen Ladezustand mit Skeleton", () => {
    for (const m of register.MODULE) {
      const text = quelle(`lager-m-${m.schluessel}.js`);
      expect(text, `lager-m-${m.schluessel}.js`).toMatch(/skeleton/);
    }
  });

  test("Rahmen, Angaben, Mitglieder, Rechte, Ausdrucke und Vorlagen laden mit Skeleton", () => {
    for (const d of [
      "lager-rahmen.js",
      "lager-detail.js",
      "lager-mitglieder.js",
      "lager-rechte.js",
      "lager-ausdrucke.js",
      "lager-vorlagen.js",
      "lager.js",
    ])
      expect(quelle(d), d).toMatch(/skeleton/);
  });

  test("die Skeleton-Arten sind die, die das Register und die Module benutzen", () => {
    expect(skeleton.SKELETON_ARTEN).toEqual(
      expect.arrayContaining([
        "liste",
        "tabelle",
        "karten",
        "flaechen",
        "detail",
      ]),
    );
    const benutzt = new Set<string>();
    for (const m of register.MODULE)
      for (const t of quelle(`lager-m-${m.schluessel}.js`).matchAll(
        /inhalt: "(\w+)"/g,
      ))
        benutzt.add(t[1]!);
    for (const art of benutzt) expect(skeleton.SKELETON_ARTEN).toContain(art);
  });

  test("der Rahmen holt das Lager nur, wenn der Stand alt ist, und kennt Fehler beim Laden des Moduls", () => {
    const r = quelle("lager-rahmen.js");
    expect(r).toMatch(/frischerRahmen/);
    expect(r).toMatch(/zustandsKarte/);
    expect(r).toMatch(/nochmals/);
  });
});

describe("Lager: Bewegung", () => {
  test("lager-rahmen.css: Animationen und Übergänge nur bei erlaubter Bewegung", () => {
    const rest = ohneBewegung(quelle("lager-rahmen.css"));
    expect(rest).not.toMatch(/\banimation(-[a-z]+)?\s*:/);
    expect(rest).not.toMatch(/\btransition(-[a-z]+)?\s*:/);
    expect(quelle("lager-rahmen.css")).toMatch(
      /prefers-reduced-motion: no-preference/,
    );
  });

  test("lager-rahmen.css: erzwungene Farben für Marke und Skeleton", () => {
    expect(quelle("lager-rahmen.css")).toMatch(/forced-colors: active/);
  });

  test("keine Bewegungsdatei nutzt Speicher des Browsers oder Inline-Skripte", () => {
    for (const d of [
      "lager-bewegung.js",
      "lager-skeleton.js",
      "lager-rahmen.js",
    ])
      expect(quelle(d), d).not.toMatch(
        /localStorage|sessionStorage|innerHTML|setAttribute\("style"/,
      );
  });

  test("fuelle: ohne erlaubte Bewegung steht der Wert sofort", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    const balken = { value: 0, dataset: {} as Record<string, string> };
    const zurueck = bewegung.fuelle!(balken, 40);
    expect(balken.value).toBe(40);
    expect(zurueck).toBe(balken);
    vi.unstubAllGlobals();
  });

  test("blendeAus entfernt ohne erlaubte Bewegung sofort", async () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    let entfernt = false;
    await bewegung.blendeAus!({
      isConnected: true,
      remove: () => (entfernt = true),
    });
    expect(entfernt).toBe(true);
    vi.unstubAllGlobals();
  });

  test("beobachteListen läuft ohne MutationObserver leer", () => {
    vi.stubGlobal("MutationObserver", undefined);
    expect(typeof bewegung.beobachteListen!({})).toBe("function");
    vi.unstubAllGlobals();
  });
});

describe("Lager: Navigation ohne Hochspringen (#693)", () => {
  test("der Rahmen meldet den Klick in der Navigation und bei Reitern, verlauf.js scrollt dann nicht nach oben", () => {
    const r = quelle("lager-rahmen.js");
    expect(r).toMatch(/behalteStelle\(\s*a\.classList\.contains\("tab"\)/);
    expect(r).toMatch(/nimmBehaltene\(\)/);
    expect(r).toMatch(/haltStelle\(/);
    const v = quelle("verlauf.js");
    expect(v).toMatch(/export function behalteStelle/);
    expect(v).toMatch(/if \(frischBehalten\(\)\)/);
    // Der Fokus auf die Überschrift scrollt nicht von selbst
    expect(quelle("admin.js")).toMatch(
      /kopf\.h1\.focus\(\{ preventScroll: true \}\)/,
    );
  });

  test("die Navigation klappt je Gruppe auf und zu und hat keine eigene dicke Leiste: Gruppen sind Knöpfe mit aria-expanded", () => {
    const r = quelle("lager-rahmen.js");
    expect(r).toMatch(/"aria-expanded": String\(offen\)/);
    expect(r).toContain("offeneGruppen");
    const css = quelle("lager-rahmen.css");
    expect(css).toMatch(/\.lg-nav-auf \{[^}]*grid-template-rows: 0fr/);
    // Keine eigenen Regeln für Scrollleisten: Sie stehen nur in tokens.css
    expect(css).not.toMatch(/scrollbar|::-webkit-scrollbar/);
  });
});

describe("Lager: Status mit klaren Schritten (#693)", () => {
  test("je Status genau eine Hauptaktion, die übrigen Schritte im Menü", () => {
    expect(status.schritteFuer!("entwurf")).toEqual({
      haupt: "starten",
      mehr: ["archivieren"],
    });
    expect(status.schritteFuer!("aktiv")).toEqual({
      haupt: "abschliessen",
      mehr: ["archivieren"],
    });
    expect(status.schritteFuer!("abgeschlossen")).toEqual({
      haupt: "archivieren",
      mehr: ["oeffnen"],
    });
    expect(status.schritteFuer!("archiviert")).toEqual({
      haupt: "wiederherstellen",
      mehr: [],
    });
    expect(status.schritteFuer!("gibtsnicht")).toBeNull();
  });

  test("jeder Schritt hat Verb, Ziel und eine Folge in einem Satz; Abschliessen sagt, dass niemand mehr etwas ändert", () => {
    for (const name of [
      "starten",
      "abschliessen",
      "archivieren",
      "oeffnen",
      "wiederherstellen",
    ]) {
      const s = status.schrittDaten!(name);
      expect(s.text, name).toMatch(/^Lager |^Ins Archiv/);
      expect(["aktiv", "abgeschlossen", "archiviert"]).toContain(s.nach);
      expect(s.folge.split(". ").length, name).toBeLessThanOrEqual(3);
      expect(s.meldung("X")).toContain("«X»");
    }
    expect(status.schrittDaten!("abschliessen").folge).toContain(
      "niemand mehr etwas ändern",
    );
  });

  test("jeder Status hat einen Satz, nie «Aktivieren» auf einem Knopf, Bestätigung am Ort mit Rückgängig", () => {
    for (const k of ["entwurf", "aktiv", "abgeschlossen", "archiviert"])
      expect(status.STATUS_SATZ![k]).toMatch(/\.$/);
    const q = quelle("lager-status.js");
    expect(q).not.toMatch(/text: "Aktivieren"|text: "Archivieren"/);
    expect(q).toContain("Rückgängig");
    expect(q).not.toMatch(/confirm\(|alert\(/);
    // Die Schritte erscheinen nur mit dem Recht «lager.verwalten»
    expect(q).toContain('"lager.verwalten"');
    // Der Kopf des Arbeitsbereichs zeigt den Status, die Angaben nicht mehr
    expect(quelle("lager-rahmen.js")).toContain("statusZeile(");
    expect(quelle("lager-detail.js")).not.toContain("splitKnopf");
  });
});
