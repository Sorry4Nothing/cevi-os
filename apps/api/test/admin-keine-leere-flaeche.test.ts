import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Keine leeren Flächen (#756, #723): Die Höhe eines Bereichs kommt aus dem verfügbaren Platz, nie aus «vh minus geschätzter Kopfhöhe» und nie als Mindesthöhe in Fensterhöhe. Eine Fensterhöhe (vh, dvh, svh, lvh) im CSS der Verwaltung ist nur zulässig, wenn
//  - die Leiste als Token eingerechnet ist (var(--leiste-hoehe), var(--scroll-hoehe)), oder
//  - die Zeile in ERLAUBT steht, mit Grund.
const ordner = new URL("../public/admin/", import.meta.url);
const einheit = /\d(?:d|s|l)?vh\b/;

type Erlaubt = { datei: string; selektor: string; grund: string };
const ERLAUBT: Erlaubt[] = [
  {
    datei: "admin.css",
    selektor: ".app",
    grund:
      "Rahmen ist mindestens fensterhoch, damit die Fusszeile unten steht; kein Scrollbereich",
  },
  {
    datei: "admin.css",
    selektor: "dialog",
    grund:
      "Obergrenze eines Dialogs: Er scrollt innen, statt über das Fenster zu laufen",
  },
  {
    datei: "admin.css",
    selektor: "dialog.blatt",
    grund: "Seitenblatt von rechts: Vollhöhe des Fensters, innen scrollbar",
  },
  {
    datei: "geruest.css",
    selektor: ".palette",
    grund:
      "Abstand der Befehlspalette (--palette-oben): Dialog, kein Seitenbereich",
  },
  {
    datei: "geruest.css",
    selektor: ".palette-karte",
    grund:
      "Obergrenze der Befehlspalette (Dialog) mit dem Abstand --palette-oben",
  },
  {
    datei: "website-orte.css",
    selektor: ".ort-suche-popup",
    grund:
      "Obergrenze einer aufklappenden Trefferliste (nur max-height, nie leer)",
  },
  {
    datei: "zuschneiden.css",
    selektor: ".zs-flaeche",
    grund: "Bildausschnitt im Dialog: Das Skript passt die Höhe dem Bild an",
  },
];

// Zulässig ohne Eintrag: die Höhe rechnet die haftende Leiste als Token ein
const mitLeiste = /var\(--(?:leiste-hoehe|scroll-hoehe)\b/;

type Fund = { datei: string; selektor: string; zeile: string };

function funde(): Fund[] {
  const gefunden: Fund[] = [];
  for (const datei of readdirSync(ordner).filter((d) => d.endsWith(".css"))) {
    const css = readFileSync(new URL(datei, ordner), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selektor = m[1]!.trim().split("\n").pop()!.trim();
      for (const zeile of m[2]!.split(";")) {
        if (einheit.test(zeile)) {
          gefunden.push({ datei, selektor, zeile: zeile.trim() });
        }
      }
    }
  }
  return gefunden;
}

describe("Keine leeren Flächen in der Verwaltung (#756)", () => {
  test("jede Fensterhöhe im CSS rechnet die Leiste als Token ein oder steht mit Grund auf der Liste", () => {
    const offen = funde().filter(
      (f) =>
        !mitLeiste.test(f.zeile) &&
        !ERLAUBT.some((e) => e.datei === f.datei && e.selektor === f.selektor),
    );
    expect(offen).toEqual([]);
  });

  test("die Liste enthält nur Zeilen, die es noch gibt, und jede hat einen Grund", () => {
    const vorhanden = funde();
    for (const e of ERLAUBT) {
      expect(e.grund.length).toBeGreaterThan(10);
      expect(
        vorhanden.some((f) => f.datei === e.datei && f.selektor === e.selektor),
        `${e.datei} ${e.selektor}`,
      ).toBe(true);
    }
  });

  test("Mindesthöhe oder feste Höhe aus der Fensterhöhe gibt es nur im Rahmen und im Seitenblatt", () => {
    const verboten = funde().filter(
      (f) =>
        /^(?:min-height|height)\s*:/.test(f.zeile) &&
        !(
          f.datei === "admin.css" &&
          [".app", "dialog.blatt"].includes(f.selektor)
        ) &&
        !(f.datei === "zuschneiden.css") &&
        !/^height\s*:\s*var\(--scroll-hoehe\)$/.test(f.zeile),
    );
    expect(verboten).toEqual([]);
  });

  test("der Scrollbereich des Seiten-Editors und der Formularraster hat die Höhe aus --scroll-hoehe", () => {
    const geruest = readFileSync(new URL("geruest.css", ordner), "utf8");
    expect(geruest.replace(/\s+/g, " ")).toContain(
      "--scroll-hoehe: calc( 100dvh - var(--leiste-hoehe) - 1rem - var(--inhalt-unten) );",
    );
    for (const datei of ["website-editor.css", "werkzeuge.css"]) {
      expect(readFileSync(new URL(datei, ordner), "utf8")).toContain(
        "height: var(--scroll-hoehe);",
      );
    }
  });

  test(".nur-leser hat einen Versatz, sonst verlängert die Marke in einem Scrollbereich ohne Bezugsrahmen das Dokument", () => {
    const admin = readFileSync(new URL("admin.css", ordner), "utf8");
    expect(admin).toMatch(
      /\.nur-leser \{\s+position: absolute;[^}]*top: 0;[^}]*left: 0;/,
    );
  });
});
