// Ladezustände der Website (#574): Skript für Bilder, Regeln des Stils, Frist für Abrufe, Ansage des Ladens.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
// Reine Browser-Module ohne Typen
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { holeMitFrist, FRIST_MS } from "../public/website/ui.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { ladeAnsage } from "../public/website/tm.js";

const lies = (n: string) =>
  readFileSync(new URL(`../public/website/${n}`, import.meta.url), "utf8");
const SKRIPT = lies("ladezustand.js");
const CSS = lies("website.css");

type Hoerer = (e: unknown) => void;

function bild(extra: Partial<Record<string, string>> = {}) {
  const attr = new Map<string, string>(
    Object.entries(extra) as [string, string][],
  );
  return {
    tagName: "IMG",
    complete: false,
    naturalWidth: 0,
    attr,
    animiert: 0,
    currentSrc: "/api/v1/medien/x",
    src: "/api/v1/medien/x",
    getAttribute: (n: string) => attr.get(n) ?? null,
    setAttribute: (n: string, w: string) => attr.set(n, w),
    removeAttribute: (n: string) => attr.delete(n),
    hasAttribute: (n: string) => attr.has(n),
    animate() {
      this.animiert++;
    },
  };
}

// Kleinste Umgebung, in der das Skript läuft
function lauf({ ruhig = false, dauer = 0 } = {}) {
  const dok = new Map<string, Hoerer[]>();
  const fenster = new Map<string, Hoerer[]>();
  const klassen = new Set<string>();
  const bilder: ReturnType<typeof bild>[] = [];
  const mitHoerer = (m: Map<string, Hoerer[]>) => (n: string, f: Hoerer) =>
    m.set(n, [...(m.get(n) ?? []), f]);
  runInNewContext(SKRIPT, {
    document: {
      documentElement: { classList: { add: (k: string) => klassen.add(k) } },
      images: bilder,
      addEventListener: mitHoerer(dok),
      querySelectorAll: () =>
        bilder.filter(
          (b) => b.hasAttribute("data-fehlt") && b.hasAttribute("data-quelle"),
        ),
    },
    window: {
      matchMedia: () => ({ matches: ruhig }),
      performance: {
        getEntriesByName: () => (dauer ? [{ duration: dauer }] : []),
      },
      addEventListener: mitHoerer(fenster),
    },
  });
  const sende = (m: Map<string, Hoerer[]>, n: string, e: unknown = {}) =>
    (m.get(n) ?? []).forEach((f) => f(e));
  return { klassen, bilder, dok, fenster, sende };
}

describe("ladezustand.js (Bilder)", () => {
  test("ein klassisches Skript ohne Module; die Klasse «ladebild» steht erst am Ende", () => {
    expect(SKRIPT).not.toMatch(/^\s*(import|export)\s/m);
    const l = lauf();
    expect(l.klassen.has("ladebild")).toBe(true);
  });

  test("load markiert das Bild; schnell (Cache) ohne Einblenden, langsam mit Einblenden, bei reduzierter Bewegung nie", () => {
    for (const [opt, erwartet] of [
      [{ dauer: 10 }, 0],
      [{ dauer: 900 }, 1],
      [{ dauer: 900, ruhig: true }, 0],
    ] as const) {
      const l = lauf(opt);
      const b = bild();
      l.sende(l.dok, "load", { target: b });
      expect(b.hasAttribute("data-da")).toBe(true);
      expect(b.animiert).toBe(erwartet);
    }
  });

  test("error tauscht die Quelle gegen das Zeichen und merkt sich die echte; ein zweiter Fehler des Zeichens ändert nichts", () => {
    const l = lauf();
    const b = bild({ src: "/api/v1/medien/abc" });
    l.sende(l.dok, "error", { target: b });
    expect(b.hasAttribute("data-fehlt")).toBe(true);
    expect(b.getAttribute("src")).toBe("/website/bild-fehlt.svg");
    expect(b.getAttribute("data-quelle")).toBe("/api/v1/medien/abc");
    l.sende(l.dok, "error", { target: b });
    l.sende(l.dok, "load", { target: b });
    expect(b.getAttribute("data-quelle")).toBe("/api/v1/medien/abc");
    // Das Zeichen zählt nicht als geladenes Bild
    expect(b.hasAttribute("data-da")).toBe(false);
  });

  test("wieder im Netz: nicht geladene Bilder bekommen ihre Quelle zurück", () => {
    const l = lauf();
    const b = bild({ src: "/api/v1/medien/abc" });
    l.bilder.push(b);
    l.sende(l.dok, "error", { target: b });
    l.sende(l.fenster, "online");
    expect(b.getAttribute("src")).toBe("/api/v1/medien/abc");
    expect(b.hasAttribute("data-fehlt")).toBe(false);
  });

  test("Bilder, die vor dem Skript fertig wurden, holt der Durchgang nach (nichts bleibt im Ladezustand)", () => {
    const l = lauf();
    const gut = Object.assign(bild({ src: "/a" }), {
      complete: true,
      naturalWidth: 100,
    });
    const kaputt = Object.assign(bild({ src: "/b" }), {
      complete: true,
      naturalWidth: 0,
    });
    const offen = bild({ src: "/c" });
    l.bilder.push(gut, kaputt, offen);
    l.sende(l.fenster, "load");
    expect(gut.hasAttribute("data-da")).toBe(true);
    expect(kaputt.hasAttribute("data-fehlt")).toBe(true);
    expect(
      offen.hasAttribute("data-da") || offen.hasAttribute("data-fehlt"),
    ).toBe(false);
  });
});

describe("Stil der Ladezustände (website.css)", () => {
  const abschnitt = CSS.slice(CSS.indexOf("Ladezustände (#574)"));

  test("Bilder werden nur mit der Klasse «ladebild» (Skript läuft) oder in der Grossansicht verborgen: ohne Skript bleiben sie sichtbar", () => {
    const regeln = [
      ...abschnitt
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{[^{}]*object-position: -9999px/g),
    ];
    expect(regeln.length).toBeGreaterThan(0);
    for (const [, sel] of regeln) {
      for (const teil of sel!.split(/,\s*\n/).map((t) => t.trim())) {
        expect(teil).toMatch(
          /^(html\.ladebild img|\.lk-figur img\[data-laedt\])/,
        );
      }
    }
  });

  test("Skelett-Farben nur aus den Tokens der Website; der Schimmer nur ohne reduzierte Bewegung, die Verzögerung von 150 ms gilt immer", () => {
    expect(abschnitt).toContain("var(--skeleton)");
    expect(abschnitt).toContain("var(--skeleton-highlight)");
    expect(abschnitt).toContain("--skelett-verzoegerung: 0.15s");
    const schimmer = abschnitt.indexOf("animation: skelett-schimmer");
    const keine = abschnitt.indexOf(
      "@media (prefers-reduced-motion: no-preference)",
    );
    const reduziert = abschnitt.indexOf(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(keine).toBeGreaterThan(-1);
    expect(schimmer).toBeGreaterThan(keine);
    expect(schimmer).toBeLessThan(reduziert);
    const ende = abschnitt.indexOf("\n}\n", reduziert);
    const block = abschnitt.slice(reduziert, ende);
    expect(block).not.toMatch(/skelett-schimmer/);
  });

  test("nicht geladene Bilder: Rand gestrichelt (nicht nur Farbe), erzwungene Farben behalten einen Rand", () => {
    expect(abschnitt).toMatch(/img\[data-fehlt\][^}]*outline: 1px dashed/);
    expect(abschnitt).toMatch(
      /@media \(forced-colors: active\)[\s\S]*outline: 1px solid GrayText/,
    );
  });

  test("das Zeichen für fehlende Bilder ist eine eigene Datei ohne Skript und ohne fremde Adresse", () => {
    const svg = lies("bild-fehlt.svg");
    expect(svg).not.toMatch(/<script|href=|https?:\/\/(?!www\.w3\.org)/);
  });
});

describe("Seitenwechsel als View Transition (#574)", () => {
  test("nur ohne reduzierte Bewegung; der Kopf hat eine eigene Gruppe und steht still", () => {
    const i = CSS.indexOf("@view-transition");
    expect(i).toBeGreaterThan(-1);
    // Es gibt genau eine Regel, und sie steht in einem Block für «Bewegung erlaubt»
    expect(CSS.match(/@view-transition/g)).toHaveLength(1);
    const davor = CSS.slice(0, i);
    const block = davor.lastIndexOf(
      "@media (prefers-reduced-motion: no-preference)",
    );
    expect(block).toBeGreaterThan(
      davor.lastIndexOf(
        String.fromCharCode(10) + "}" + String.fromCharCode(10),
      ),
    );
    expect(CSS).toMatch(/navigation: auto/);
    expect(CSS).toMatch(/[.]kopf [{]\s*view-transition-name: kopf;/);
  });
});

describe("Frist und Ansage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("ein Abruf, der nicht antwortet, bricht nach der Frist ab (nichts bleibt für immer im Ladezustand)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_u: string, o: { signal: AbortSignal }) =>
        new Promise((_, nein) =>
          o.signal.addEventListener("abort", () =>
            nein(new Error("abgebrochen")),
          ),
        ),
    );
    const p = holeMitFrist("/x");
    const ergebnis = expect(p).rejects.toThrow("abgebrochen");
    await vi.advanceTimersByTimeAsync(FRIST_MS + 1);
    await ergebnis;
  });

  test("eine schnelle Antwort braucht keine Ansage; eine langsame wird einmal angesagt und danach geleert", () => {
    vi.useFakeTimers();
    const region = { textContent: "" };
    const doc = { getElementById: () => region };
    const schnell = ladeAnsage(doc, "Wird geladen.");
    vi.advanceTimersByTime(300);
    schnell();
    vi.advanceTimersByTime(2000);
    expect(region.textContent).toBe("");
    const langsam = ladeAnsage(doc, "Wird geladen.");
    vi.advanceTimersByTime(800);
    expect(region.textContent).toBe("Wird geladen.");
    langsam();
    expect(region.textContent).toBe("");
  });
});
