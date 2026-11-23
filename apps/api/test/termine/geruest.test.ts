import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PUSH_KANAL, TERMINE_PUSH_TYPEN } from "../../src/push.js";
import { TERMINE_RECHTE } from "../../src/termine/rechte-katalog.js";
import { TERMINE_PUSH_ARTEN } from "../../src/termine/push-arten.js";
import { MATRIX_MODULE, TERMINE_MODULE } from "./matrix.js";

const lies = (pfad: string) =>
  readFileSync(new URL(pfad, import.meta.url), "utf8");
const openapi = lies("../../../../docs/api/openapi.yaml");
const panel = new URL("../../public/admin/", import.meta.url);

describe("Gerüst der Termine: Verzeichnisse und Marker", () => {
  test("jede Matrix-Datei gehört zu einem Modul der Liste (Tippfehler im Namen fallen auf)", () => {
    expect(
      MATRIX_MODULE.filter(
        (m) => !(TERMINE_MODULE as readonly string[]).includes(m),
      ),
    ).toEqual([]);
  });

  test("die Modulnamen sind eindeutig", () => {
    expect(new Set(TERMINE_MODULE).size).toBe(TERMINE_MODULE.length);
  });

  // Wie die Marker des Lagers: Jedes Modul schreibt seine Einträge unter seine Zeile und vor die nächste, damit parallele Issues im OpenAPI nicht um dieselben Zeilen streiten
  test.each(["pfade", "schemas"])(
    "das OpenAPI hat für jedes Modul genau einen Marker «termine-%s»",
    (art) => {
      for (const modul of TERMINE_MODULE) {
        const treffer = openapi.match(
          new RegExp(`^ +# termine-${art}: ${modul} \\(`, "gm"),
        );
        expect(treffer, `${art}: ${modul}`).toHaveLength(1);
      }
    },
  );
});

describe("Gerüst der Termine: Register", () => {
  test("jeder Push-Typ hat einen festen Titel, einen Kanal und umgekehrt", () => {
    expect(Object.keys(TERMINE_PUSH_ARTEN).sort()).toEqual(
      [...TERMINE_PUSH_TYPEN].sort(),
    );
    for (const typ of TERMINE_PUSH_TYPEN) {
      expect(TERMINE_PUSH_ARTEN[typ].titel.length, typ).toBeGreaterThan(0);
      expect(PUSH_KANAL[typ], typ).toBe(
        typ.startsWith("raum_") ? "raeume" : "termine",
      );
    }
  });

  test("der Rechtekatalog nennt zu jedem Recht das Issue und ist je Name eindeutig", () => {
    for (const [name, { issue }] of Object.entries(TERMINE_RECHTE)) {
      expect(issue, name).toMatch(/^T[A-H][0-9]?$/);
    }
  });
});

describe("Gerüst der Termine: Admin-Panel", () => {
  const dateien = readdirSync(panel).filter((d) => d.startsWith("termine"));

  test("jede Stilvorlage der Termine ist in index.html eingebunden", () => {
    const html = lies("../../public/admin/index.html");
    const css = dateien.filter((d) => d.endsWith(".css"));
    expect(css.length).toBeGreaterThan(0);
    for (const datei of css) {
      expect(html, datei).toContain(`href="/admin/${datei}"`);
    }
  });

  test("navigation.js bindet jedes Modul-Skript der Termine ein, und der Bereich «termine» steht dort", () => {
    const navigation = lies("../../public/admin/navigation.js");
    // termine-monat.js ist ein Baustein des Kalenders (kein Modul einer Unterseite), termine-kalender.js lädt ihn
    for (const datei of dateien.filter(
      (d) => /^termine-.*\.js$/.test(d) && d !== "termine-monat.js",
    )) {
      expect(navigation, datei).toContain(`"./${datei}"`);
    }
    expect(navigation).toContain('schluessel: "termine"');
  });
});
