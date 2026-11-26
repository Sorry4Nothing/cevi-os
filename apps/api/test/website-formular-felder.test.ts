import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereHuelle,
  rendereSeite,
  type Kontext,
} from "../src/website/rendern.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { spiegle } from "../public/website/auswahl.js";
import {
  addiereMonate,
  addiereTage,
  datumVon,
  klemme,
  monatsRaster,
  startTag,
  zeigeDatum,
  // @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
} from "../public/website/datum.js";

// Formular der Website (#887): eigenes Auswahlfeld (auswahl.js) und Datum mit Kalender (datum.js)
const lies = (pfad: string) =>
  readFileSync(new URL(`../public/website/${pfad}`, import.meta.url), "utf8");
const ohneKommentare = (js: string) => js.replace(/^\s*\/\/.*$/gm, "");

const kontext = (): Kontext => ({
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [{ pfad: "/", titel: "Start", kinder: [] }],
  daten: keineDaten(),
});
const zaehle = (t: string, teil: string) => t.split(teil).length - 1;

describe("Seite mit Formular", () => {
  const p = pruefeDokument({
    v: 1,
    titel: "Anmeldung",
    bausteine: [
      {
        id: randomUUID(),
        typ: "formular",
        daten: {
          felder: [
            {
              id: randomUUID(),
              typ: "auswahl",
              beschriftung: "Stufe",
              pflicht: true,
              optionen: ["Biber", "Wölfe"],
            },
            {
              id: randomUUID(),
              typ: "datum",
              beschriftung: "Geburtstag",
              pflicht: true,
              von: "2010-01-01",
              bis: "2024-12-31",
            },
          ],
          datenschutz: "Wir planen damit die Gruppen.",
        },
      },
    ],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  const html = rendereSeite(
    { id: randomUUID(), pfad: "/mitmachen/anmeldung", dokument: p.dokument },
    kontext(),
  );

  test("lädt den Stil des eigenen Auswahlfelds und das Formularskript, jeden Stil nur einmal", () => {
    expect(
      zaehle(html, '<link rel="stylesheet" href="/website/auswahl.css">'),
    ).toBe(1);
    expect(
      zaehle(html, '<link rel="stylesheet" href="/website/formular.css">'),
    ).toBe(1);
    expect(html).toContain('<script type="module" src="/website/formular.js">');
  });

  test("ohne Skript: natives Auswahlfeld und Textfeld mit Format und Grenzen", () => {
    expect(html).toMatch(/<select[^>]*class="eingabe bf-auswahl"/);
    expect(html).toContain("Format: TT.MM.JJJJ");
    expect(html).toContain('data-min="2010-01-01"');
    expect(html).toContain('data-max="2024-12-31"');
  });

  test("die Hülle geschützter Seiten bringt den Stil für nachgeladene Formulare mit", () => {
    const h = rendereHuelle("/intern", kontext());
    expect(h).toContain('href="/website/auswahl.css"');
    expect(h).toContain('href="/website/formular.css"');
    expect(h).toContain('src="/website/formular.js"');
  });
});

describe("Skripte", () => {
  test("formular.js lädt das eigene Auswahlfeld und den Kalender", () => {
    const js = lies("formular.js");
    expect(js).toMatch(/^import "\.\/auswahl\.js";$/m);
    expect(js).toMatch(
      /import \{ datumVon, verbessereDatum \} from "\.\/datum\.js";/,
    );
    expect(js).toContain("verbessereDatum(f.eingabe, beschriftung(f))");
  });

  test("datum.js: kein HTML aus Text, kein style-Attribut (CSP)", () => {
    const js = ohneKommentare(lies("datum.js"));
    expect(js).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|\.style\b|setAttribute\("style"/,
    );
    // Keine Abhängigkeit von der Verwaltung
    expect(js).not.toContain("/admin/");
  });

  test("formular.css: Kalender aus Tokens, 44 px pro Tag, reduzierte Bewegung", () => {
    const css = lies("formular.css");
    expect(css).toContain(".bf-kalender");
    expect(css).toMatch(/\.bf-kalender-tag \{\s*min-height: 2\.75rem;/);
    expect(css).toContain("prefers-reduced-motion: no-preference");
    // Keine festen Farben (Kommentare nennen Issues wie «#887»)
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /#[0-9a-f]{3,6}\b/i,
    );
  });

  test("auswahl.css zeigt den Fehler an der Schaltfläche", () => {
    expect(lies("auswahl.css")).toContain('.aw-knopf[aria-invalid="true"]');
  });
});

// Eine kleine Attrappe mit den Attribut-Methoden des DOM
function element(attr: Record<string, string> = {}, extra: object = {}) {
  const a = new Map(Object.entries(attr));
  return {
    required: false,
    disabled: false,
    hasAttribute: (n: string) => a.has(n),
    getAttribute: (n: string) => a.get(n) ?? null,
    setAttribute: (n: string, w: string) => void a.set(n, w),
    removeAttribute: (n: string) => void a.delete(n),
    ...extra,
  };
}

describe("auswahl: Fehler des Formulars an der Schaltfläche (#887)", () => {
  test("aria-invalid und aria-describedby kommen dazu und gehen wieder weg", () => {
    const select = element({ "aria-describedby": "f-h" }, { required: true });
    const knopf = element();
    spiegle(select, knopf);
    expect(knopf.getAttribute("aria-describedby")).toBe("f-h");
    expect(knopf.getAttribute("aria-required")).toBe("true");
    expect(knopf.hasAttribute("aria-invalid")).toBe(false);

    // formular.js meldet einen Fehler
    select.setAttribute("aria-invalid", "true");
    select.setAttribute("aria-describedby", "f-h f-f");
    spiegle(select, knopf);
    expect(knopf.getAttribute("aria-invalid")).toBe("true");
    expect(knopf.getAttribute("aria-describedby")).toBe("f-h f-f");

    // und löscht ihn wieder
    select.removeAttribute("aria-invalid");
    select.removeAttribute("aria-describedby");
    spiegle(select, knopf);
    expect(knopf.hasAttribute("aria-invalid")).toBe(false);
    expect(knopf.hasAttribute("aria-describedby")).toBe(false);
  });

  test("gesperrt folgt dem Feld", () => {
    const select = element({}, { disabled: true });
    const knopf = element();
    spiegle(select, knopf);
    expect(knopf.disabled).toBe(true);
  });

  test("der Beobachter achtet auf alle gespiegelten Attribute", () => {
    const js = lies("auswahl.js");
    expect(js).toContain(
      'attributeFilter: ["disabled", "required", ...GESPIEGELT]',
    );
    expect(js).toMatch(
      /GESPIEGELT = \["aria-describedby", "aria-invalid", "aria-required"\]/,
    );
  });
});

describe("datum: Lesen, Grenzen, Raster (#887)", () => {
  test("liest TT.MM.JJJJ und ISO, verwirft Tage, die es nicht gibt", () => {
    expect(datumVon("31.12.2026")).toBe("2026-12-31");
    expect(datumVon("1.2.2026")).toBe("2026-02-01");
    expect(datumVon("2026-12-31")).toBe("2026-12-31");
    expect(datumVon("29.02.2027")).toBeNull();
    expect(datumVon("29.02.2028")).toBe("2028-02-29");
    expect(datumVon("31.04.2026")).toBeNull();
    expect(datumVon("12/31/2026")).toBeNull();
    expect(zeigeDatum("2026-02-01")).toBe("01.02.2026");
  });

  test("Grenzen: der Kalender öffnet beim getippten Tag, sonst heute, immer innerhalb", () => {
    expect(klemme("2026-05-01", "2026-06-01", "2026-06-30")).toBe("2026-06-01");
    expect(klemme("2026-07-01", "2026-06-01", "2026-06-30")).toBe("2026-06-30");
    expect(klemme("2026-06-15", "", "")).toBe("2026-06-15");
    expect(startTag("15.06.2026", "", "", "2026-11-26")).toBe("2026-06-15");
    expect(startTag("Unsinn", "", "", "2026-11-26")).toBe("2026-11-26");
    expect(startTag("", "2010-01-01", "2024-12-31", "2026-11-26")).toBe(
      "2024-12-31",
    );
  });

  test("Monatsraster beginnt am Montag", () => {
    // 1. Dezember 2026 ist ein Dienstag
    const r = monatsRaster(2026, 12);
    expect(r[0]).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(r.every((z: unknown[]) => z.length === 7)).toBe(true);
    expect(r.flat().filter((t: number | null) => t !== null)).toHaveLength(31);
    // Februar 2027 beginnt am Montag und braucht genau vier Wochen
    expect(monatsRaster(2027, 2)).toHaveLength(4);
  });

  test("Tasten: Tage, Monate und Jahre über Grenzen hinweg", () => {
    expect(addiereTage("2026-12-31", 1)).toBe("2027-01-01");
    expect(addiereTage("2026-03-01", -1)).toBe("2026-02-28");
    expect(addiereMonate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addiereMonate("2026-03-15", -12)).toBe("2025-03-15");
  });
});
