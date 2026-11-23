import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Querschnitt-Komponenten der Verwaltung (#578): reine Funktionen ohne Browser und Quelltext-Prüfungen.
// dom.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let sortieren: Modul;
let filter: Modul;
let datum: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  // Als Text, damit tsc die Browserdateien nicht als Module des Programms prüft
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  sortieren = await lade("sortieren.js");
  filter = await lade("filterleiste.js");
  datum = await lade("datumsfeld.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

describe("sortieren.js", () => {
  test("verschiebe: bewegt ein Element und lässt die Ränder stehen", () => {
    expect(sortieren.verschiebe!(["a", "b", "c", "d"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(sortieren.verschiebe!(["a", "b", "c"], 2, 0)).toEqual([
      "c",
      "a",
      "b",
    ]);
    // Über den Rand hinaus bleibt es am Rand, gleiche Stelle ändert nichts, ungültige Stelle auch nicht
    expect(sortieren.verschiebe!(["a", "b", "c"], 0, -5)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortieren.verschiebe!(["a", "b", "c"], 1, 9)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortieren.verschiebe!(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  test("verschiebe ändert die Eingabe nicht", () => {
    const ids = ["a", "b", "c"];
    sortieren.verschiebe!(ids, 0, 2);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  test("positionsText sagt Name und Stelle an", () => {
    expect(sortieren.positionsText!("Wolfsstufe", 1, 4)).toBe(
      "Wolfsstufe, Position 2 von 4",
    );
  });

  test("Quelltext: Griff mit Namen, Tastatur, Knöpfe als Alternative und Ansage", () => {
    const q = quelle("sortieren.js");
    expect(q).toContain('"aria-label": `Verschieben: ');
    expect(q).toContain("Nach oben: ");
    expect(q).toContain("Nach unten: ");
    expect(q).toContain('role: "status"');
    expect(q).toContain('"Escape"');
    expect(q).toContain("mitRueckgaengig");
  });
});

describe("filterleiste.js", () => {
  test("trefferText: Zahl mit Einzahl oder Mehrzahl, gefiltert «a von n»", () => {
    expect(filter.trefferText!(14, 14, "Person", "Personen")).toBe(
      "14 Personen",
    );
    expect(filter.trefferText!(1, 1, "Person", "Personen")).toBe("1 Person");
    expect(filter.trefferText!(3, 14, "Person", "Personen")).toBe(
      "3 von 14 Personen",
    );
    expect(filter.trefferText!(0, 14, "Person", "Personen")).toBe(
      "0 von 14 Personen",
    );
  });

  test("gesetzteFilter: nur Werte ungleich dem Grundwert, mit dem Text der Option", () => {
    const f = [
      {
        schluessel: "status",
        label: "Status",
        grundwert: "alle",
        optionen: [
          ["alle", "Alle"],
          ["aktiv", "Aktiv"],
        ],
      },
      {
        schluessel: "rolle",
        label: "Rolle",
        grundwert: "",
        optionen: [
          ["", "Alle"],
          ["leitung", "Leitung"],
        ],
      },
    ];
    expect(filter.gesetzteFilter!(f, { status: "alle", rolle: "" })).toEqual(
      [],
    );
    expect(
      filter.gesetzteFilter!(f, { status: "aktiv", rolle: "leitung" }),
    ).toEqual([
      { schluessel: "status", label: "Status", wertText: "Aktiv" },
      { schluessel: "rolle", label: "Rolle", wertText: "Leitung" },
    ]);
  });

  test("Quelltext: Trefferzahl in einer Statusregion, Chips mit Namen, Zurücksetzen", () => {
    const q = quelle("filterleiste.js");
    expect(q).toContain('role: "status"');
    expect(q).toContain("Filter entfernen: ");
    expect(q).toContain("Zurücksetzen");
  });
});

describe("datumsfeld.js", () => {
  const heute = new Date(2026, 10, 23);

  test("parseDatum liest die Schreibweisen der Schweiz", () => {
    expect(datum.parseDatum!("5.12.2026", heute)).toBe("2026-12-05");
    expect(datum.parseDatum!("05.12.26", heute)).toBe("2026-12-05");
    expect(datum.parseDatum!("5.12.", heute)).toBe("2026-12-05");
    expect(datum.parseDatum!(" 5/12/2026 ", heute)).toBe("2026-12-05");
    expect(datum.parseDatum!("2026-12-05", heute)).toBe("2026-12-05");
  });

  test("parseDatum weist Ungültiges ab, auch den 30. Februar und den 29. Februar im Nichtschaltjahr", () => {
    for (const s of [
      "",
      "abc",
      "32.1.2026",
      "30.2.2026",
      "29.2.2026",
      "5.13.2026",
      "2026-02-30",
    ]) {
      expect(datum.parseDatum!(s, heute), s).toBe("");
    }
    expect(datum.parseDatum!("29.2.2028", heute)).toBe("2028-02-29");
  });

  test("formatDatum schreibt TT.MM.JJJJ", () => {
    expect(datum.formatDatum!("2026-12-05")).toBe("05.12.2026");
    expect(datum.formatDatum!("")).toBe("");
    expect(datum.formatDatum!("kaputt")).toBe("");
  });

  test("parseZeit liest 8, 8:30, 8.30, 0830 und 14", () => {
    expect(datum.parseZeit!("8")).toBe("08:00");
    expect(datum.parseZeit!("8:30")).toBe("08:30");
    expect(datum.parseZeit!("8.30")).toBe("08:30");
    expect(datum.parseZeit!("0830")).toBe("08:30");
    expect(datum.parseZeit!("830")).toBe("08:30");
    expect(datum.parseZeit!("14")).toBe("14:00");
    for (const s of ["", "24:00", "12:60", "x", "1:2:3"])
      expect(datum.parseZeit!(s), s).toBe("");
  });

  test("monatsRaster: Montag zuerst, Zeilen zu sieben, alle Tage genau einmal", () => {
    // Dezember 2026 beginnt an einem Dienstag
    const r = datum.monatsRaster!(2026, 12) as (number | null)[][];
    expect(r[0]![0]).toBeNull();
    expect(r[0]![1]).toBe(1);
    expect(r.every((z) => z.length === 7)).toBe(true);
    const tage = r.flat().filter((t): t is number => t !== null);
    expect(tage).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  test("addiereTage und addiereMonate laufen über Monats- und Jahresgrenzen, der Tag bleibt im Monat", () => {
    expect(datum.addiereTage!("2026-12-31", 1)).toBe("2027-01-01");
    expect(datum.addiereTage!("2026-03-01", -1)).toBe("2026-02-28");
    expect(datum.addiereMonate!("2026-01-31", 1)).toBe("2026-02-28");
    expect(datum.addiereMonate!("2026-12-15", 1)).toBe("2027-01-15");
    expect(datum.addiereMonate!("2026-01-15", -1)).toBe("2025-12-15");
  });

  test("Quelltext: Kalender mit Tastatur, Format de-CH, keine nativen Eingaben", () => {
    const q = quelle("datumsfeld.js");
    for (const taste of ["ArrowLeft", "PageUp", "Home", "Escape"])
      expect(q).toContain(taste);
    expect(q).toContain("TT.MM.JJJJ");
    expect(q).not.toMatch(/type: "(date|time|datetime-local)"/);
  });
});

describe("Registrierung", () => {
  test("neue Dateien: in index.html (css) und in den Stilvorlagen nur Tokens, keine Hex-Farben", () => {
    expect(quelle("index.html")).toContain("/admin/werkzeuge.css");
    // Ohne Kommentare (sie nennen die Nummer des Issues)
    const css = quelle("werkzeuge.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
  });

  test("keine Popups: geteilter Knopf und Bestätigung am Ort kennen weder dialog noch confirm", () => {
    const q = quelle("aktionen.js");
    expect(q).not.toMatch(/showModal|confirm\(|alert\(|prompt\(/);
    expect(q).toContain('role: "menu"');
    expect(q).toContain('"aria-haspopup": "menu"');
  });
});

describe("Ziehen mit Bewegung (#609)", () => {
  test("eine Engine in sortieren.js: Seitenbaum, Lädeli und Sortierliste benutzen sie, keiner baut ein eigenes Ziehen", () => {
    expect(quelle("sortieren.js")).toContain(
      "export function zieheMitBewegung",
    );
    for (const datei of [
      "website-baumansicht.js",
      "laedeli.js",
      "sortieren.js",
    ]) {
      const q = quelle(datei);
      expect(q, datei).toContain("zieheMitBewegung(");
      // Kein eigener Griff am Zeiger mehr (er ging beim Umbauen des Dokuments verloren)
      expect(q, datei).not.toContain("setPointerCapture");
    }
  });

  test("Bewegung nur bei erlaubter Bewegung: Übergänge im Block no-preference, JS fragt matchMedia", () => {
    const css = quelle("werkzeuge.css");
    const block = css.slice(
      css.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    expect(block).toContain(".sortier-weicht.sortier-weicht");
    expect(block).toContain(".sortier-setzt-ab.sortier-setzt-ab");
    // Ausserhalb des Blocks gibt es keinen Übergang für die Zeilen
    expect(
      css.slice(0, css.indexOf("@media (prefers-reduced-motion")),
    ).not.toContain(".sortier-weicht");
    expect(quelle("sortieren.js")).toContain(
      "(prefers-reduced-motion: no-preference)",
    );
  });

  test("Tastatur und Knöpfe bleiben: Griff mit Leertaste, Hoch und Runter, Ansage", () => {
    const q = quelle("sortieren.js");
    expect(q).toContain("onkeydown");
    expect(q).toContain("Nach oben:");
    expect(q).toContain("Nach unten:");
    expect(q).toContain('role: "status"');
    const l = quelle("laedeli.js");
    expect(l).toContain('"Nach oben"');
    expect(l).toContain('e.key === "ArrowUp"');
  });

  test("Lädeli Einstellungen: Speicherleiste unten statt Knopf im Formular", () => {
    const l = quelle("laedeli.js");
    const teil = l.slice(l.indexOf("function zeigeEinstellungen"));
    expect(teil).toContain("speicherLeiste(");
    expect(teil).not.toContain('knopf("Speichern"');
    expect(teil).not.toContain("aktionen--unten");
  });

  test("keine Style-Attribute aus dem Skript (CSP style-src 'self')", () => {
    for (const datei of [
      "laedeli.js",
      "sortieren.js",
      "website-baumansicht.js",
    ]) {
      expect(quelle(datei), datei).not.toMatch(/\bstyle: [`"]/);
      expect(quelle(datei), datei).not.toContain('setAttribute("style"');
    }
  });
});
