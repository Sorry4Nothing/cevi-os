import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Querschnitt-Komponenten der Verwaltung (#578): reine Funktionen ohne Browser und Quelltext-Prüfungen.
// dom.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let sortieren: Modul;
let filter: Modul;
let datum: Modul;
let zuschnitt: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  // Als Text, damit tsc die Browserdateien nicht als Module des Programms prüft
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  sortieren = await lade("sortieren.js");
  filter = await lade("filterleiste.js");
  datum = await lade("datumsfeld.js");
  zuschnitt = await lade("zuschneiden.js");
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

describe("zuschneiden.js (#633)", () => {
  const bild = { b: 400, h: 300 };

  test("das grösste Rechteck liegt mittig und hat das Verhältnis", () => {
    expect(zuschnitt.groesstesRechteck!(bild, null)).toEqual({
      x: 0,
      y: 0,
      w: 400,
      h: 300,
    });
    expect(zuschnitt.groesstesRechteck!(bild, 1)).toEqual({
      x: 50,
      y: 0,
      w: 300,
      h: 300,
    });
    const r = zuschnitt.groesstesRechteck!(bild, 16 / 9);
    expect(r.w).toBe(400);
    expect(r.h).toBeCloseTo(225);
    expect(r.y).toBeCloseTo(37.5);
  });

  test("verhaeltnisWert liest 16:9 und lehnt Unsinn ab", () => {
    expect(zuschnitt.verhaeltnisWert!("16:9")).toBeCloseTo(16 / 9);
    expect(zuschnitt.verhaeltnisWert!("frei")).toBeNull();
    expect(zuschnitt.verhaeltnisWert!("0:3")).toBeNull();
    expect(zuschnitt.verhaeltnisWert!(null)).toBeNull();
  });

  test("Verschieben und Begrenzen halten den Ausschnitt im Bild", () => {
    const r = { x: 50, y: 0, w: 300, h: 300 };
    expect(zuschnitt.verschiebe!(r, 500, 500, bild)).toEqual({
      x: 100,
      y: 0,
      w: 300,
      h: 300,
    });
    expect(zuschnitt.verschiebe!(r, -500, 0, bild).x).toBe(0);
    expect(zuschnitt.begrenze!({ x: -5, y: 290, w: 900, h: 50 }, bild)).toEqual(
      { x: 0, y: 250, w: 400, h: 50 },
    );
  });

  test("Skalieren behält das Verhältnis, bleibt im Bild und über der Mindestgrösse", () => {
    const r = { x: 50, y: 0, w: 300, h: 300 };
    const klein = zuschnitt.skaliere!(r, 0.5, bild);
    expect(klein).toEqual({ x: 125, y: 75, w: 150, h: 150 });
    expect(zuschnitt.skaliere!(r, 5, bild).h).toBe(300);
    expect(zuschnitt.skaliere!(r, 0.0001, bild).w).toBe(zuschnitt.MIN_SEITE);
    const ecke = zuschnitt.skaliere!(r, 0.5, bild, { x: 0, y: 0 });
    expect(ecke.x).toBe(50);
    expect(ecke.y).toBe(0);
  });

  test("Griffe ändern Kante oder Ecke; mit Verhältnis bleibt die Gegenecke stehen", () => {
    const r = { x: 100, y: 100, w: 100, h: 100 };
    expect(zuschnitt.aendereMitGriff!(r, "e", 50, 0, bild)).toEqual({
      x: 100,
      y: 100,
      w: 150,
      h: 100,
    });
    expect(zuschnitt.aendereMitGriff!(r, "w", -500, 0, bild).x).toBe(0);
    // nicht über die Gegenkante hinaus
    expect(zuschnitt.aendereMitGriff!(r, "e", -500, 0, bild).w).toBe(
      zuschnitt.MIN_SEITE,
    );
    const fest = zuschnitt.aendereMitGriff!(r, "se", 40, 0, bild, 1);
    expect(fest).toEqual({ x: 100, y: 100, w: 140, h: 140 });
    // an der Ecke «nw» bleibt «se» stehen
    const nw = zuschnitt.aendereMitGriff!(r, "nw", -30, -30, bild, 1);
    expect(nw.x + nw.w).toBe(200);
    expect(nw.y + nw.h).toBe(200);
    // höchstens bis zum Bildrand
    expect(zuschnitt.aendereMitGriff!(r, "se", 900, 900, bild, 1).h).toBe(200);
  });

  test("Drehen um 90 Grad: rechts und links heben sich auf, viermal ergibt das Ausgangsrechteck", () => {
    const r = { x: 10, y: 20, w: 100, h: 50 };
    const rechts = zuschnitt.dreheRechteck!(r, bild, true);
    expect(rechts).toEqual({ x: 230, y: 10, w: 50, h: 100 });
    expect(zuschnitt.dreheRechteck!(rechts, { b: 300, h: 400 }, false)).toEqual(
      r,
    );
    let x = r;
    let b = bild;
    for (let i = 0; i < 4; i++) {
      x = zuschnitt.dreheRechteck!(x, b, true);
      b = { b: b.h, h: b.b };
    }
    expect(x).toEqual(r);
  });

  test("passeAn wechselt auf ein Verhältnis, ohne das alte Rechteck zu verlassen", () => {
    const r = { x: 0, y: 0, w: 400, h: 300 };
    expect(zuschnitt.passeAn!(r, 1, bild)).toEqual({
      x: 50,
      y: 0,
      w: 300,
      h: 300,
    });
    expect(zuschnitt.passeAn!(r, null, bild)).toBe(r);
  });

  test("Zoomstufe und Regler sind Umkehrungen", () => {
    expect(zuschnitt.zoomZuRegler!(1)).toBe(0);
    expect(zuschnitt.zoomZuRegler!(zuschnitt.ZOOM_MAX!)).toBe(100);
    expect(zuschnitt.reglerZuZoom!(0)).toBe(1);
    expect(zuschnitt.zoomZuRegler!(zuschnitt.reglerZuZoom!(50))).toBe(50);
    expect(
      zuschnitt.zoomStufe!({ x: 0, y: 0, w: 100, h: 75 }, bild),
    ).toBeCloseTo(4);
  });

  test("Ausgabegrösse: nie über dem Ausschnitt, die längere Seite höchstens maxSeite", () => {
    expect(zuschnitt.ausgabeMasse!({ w: 3000, h: 3000 }, 512)).toEqual({
      b: 512,
      h: 512,
    });
    expect(zuschnitt.ausgabeMasse!({ w: 4000, h: 2000 }, 2048)).toEqual({
      b: 2048,
      h: 1024,
    });
    expect(zuschnitt.ausgabeMasse!({ w: 200.4, h: 100.6 }, 2048)).toEqual({
      b: 200,
      h: 101,
    });
  });

  test("Dateigrösse und Dateiname", () => {
    expect(zuschnitt.groesseText!(512)).toBe("512 Byte");
    expect(zuschnitt.groesseText!(2048)).toBe("2 KB");
    expect(zuschnitt.groesseText!(5 * 1024 * 1024)).toBe("5 MB");
    expect(zuschnitt.dateiname!("Ausflug 2026.JPG", "image/jpeg")).toBe(
      "Ausflug 2026-zugeschnitten.jpg",
    );
    expect(zuschnitt.dateiname!("logo.png", "image/png")).toBe(
      "logo-zugeschnitten.png",
    );
    expect(zuschnitt.dateiname!("", "image/jpeg")).toBe(
      "bild-zugeschnitten.jpg",
    );
  });

  test("Quelltext: Ausrichtung nach EXIF, Leinwand statt Bild-Element, keine blob:-Adresse, keine Inline-Stile", () => {
    const q = quelle("zuschneiden.js");
    expect(q).toContain('imageOrientation: "from-image"');
    expect(q).toContain("createImageBitmap");
    expect(q).toContain("toBlob");
    expect(q).not.toMatch(
      /createObjectURL|innerHTML|setAttribute\("style"/,
    );
    expect(q).not.toMatch(/el\("img"/);
    // Zuhörer für Zeiger, Rad und Tasten
    expect(q).toContain('"wheel"');
    expect(q).toContain("pointerdown");
    expect(q).toContain("keydown");
    // Eingaben auf der Seite zählen nicht als ungespeicherte Änderung
    expect(q).toContain("stopPropagation");
  });

  test("Alle Stellen mit Bild-Upload rufen zuschneiden auf", () => {
    for (const name of ["konto.js", "stufen.js", "website-medien.js"]) {
      expect(quelle(name), name).toContain('from "./zuschneiden.js"');
      expect(quelle(name), name).toContain("zuschneiden(");
    }
    expect(quelle("index.html")).toContain("/admin/zuschneiden.css");
  });

  test("Stilvorlage: Fokus, 44-Pixel-Ziele, Bewegung nur ohne «reduzieren», keine festen Farben", () => {
    const c = quelle("zuschneiden.css");
    expect(c).toContain("focus-visible");
    expect(c).toContain("2.75rem");
    expect(c).toContain("touch-action: none");
    expect(c).toContain("prefers-reduced-motion: no-preference");
    expect(c).not.toMatch(/:[^;]*#[0-9a-fA-F]{3,8}\b/);
  });
});
