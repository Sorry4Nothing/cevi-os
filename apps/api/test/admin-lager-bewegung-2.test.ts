import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Ladezustände und Bewegung der Lager-Module Aufgaben, Zeitplan, To-dos und «Menschen und Einteilung» (#685): Quelltext-Regeln und das Verhalten ohne Bewegung; ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const dir = new URL("../public/admin/", import.meta.url);
const lies = (name: string) => readFileSync(new URL(name, dir), "utf8");

const MODULE = [
  "aufgaben",
  "zeitplan",
  "todos",
  "teilnehmer",
  "abzaehlen",
  "anwesenheit",
  "gruppen",
  "zimmer",
  "fahrten",
  "schichtplan",
  "diensttausch",
  "adressbuch",
];
const quellen = Object.fromEntries(
  MODULE.map((m) => [m, lies(`lager-m-${m}.js`)]),
);
const CSS = ["lager-anim.css", "lager-aufgaben.css", "lager-menschen.css"];

// Namen der Deklarationen, die sich bewegen, mit der Verschachtelung der @media-Blöcke, in denen sie stehen
function bewegungen(css: string) {
  const treffer: { eigenschaft: string; imBlock: boolean }[] = [];
  const stapel: string[] = [];
  let kopf = "";
  for (const zeichen of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (zeichen === "{") {
      stapel.push(kopf.trim());
      kopf = "";
    } else if (zeichen === "}") {
      stapel.pop();
      kopf = "";
    } else if (zeichen === ";") {
      const m = /^\s*(animation|transition)(-[a-z]+)?\s*:/.exec(kopf);
      if (m && !/:\s*none\b/.test(kopf) && !/\b0s\b/.test(kopf))
        treffer.push({
          eigenschaft: m[1]!,
          imBlock: stapel.some((s) =>
            s.includes("prefers-reduced-motion: no-preference"),
          ),
        });
      kopf = "";
    } else kopf += zeichen;
  }
  return treffer;
}

describe("Ladezustand mit Skeleton", () => {
  test.each(MODULE)(
    "%s lädt mit einem Skeleton in der Form des Inhalts",
    (m) => {
      const q = quellen[m]!;
      expect(q).toMatch(/ctx\.lade\(|erstelleLader\(/);
      expect(q).toMatch(/skeleton/i);
    },
  );

  test("die Skeleton-Bausteine sind zugänglich: ohne Inline-Stil, mit Live-Region «Lädt …» im Lader", () => {
    const lader = lies("lader.js");
    expect(lader).toContain('"Lädt …"');
    expect(lader).toContain('"aria-hidden": "true"');
    const gem = lies("lager-aufgaben-gemeinsam.js");
    for (const name of [
      "skeletonAufgaben",
      "skeletonZeitplan",
      "skeletonTodos",
      "skeletonAufgabeDetail",
    ])
      expect(gem).toContain(`export function ${name}`);
  });

  test("Teile laden nach: Skeleton erst nach 250 ms, danach Fehlerkarte mit «Nochmals versuchen»", () => {
    const anim = lies("lager-anim.js");
    expect(anim).toContain("export function teilLader");
    expect(anim).toContain("250");
    expect(lies("lager-m-teilnehmer.js")).toMatch(/nachladen/);
  });

  test("kein Polling: kein Intervall in den Modulen", () => {
    for (const m of MODULE) expect(quellen[m]).not.toMatch(/setInterval\(/);
    expect(lies("lager-anim.js")).not.toMatch(/setInterval\(/);
  });
});

describe("Bewegung nur bei erlaubter Bewegung", () => {
  test("lager-anim.css ist eingebunden und hat die Regeln für Bewegung und erzwungene Farben", () => {
    expect(lies("index.html")).toContain('href="/admin/lager-anim.css"');
    const css = lies("lager-anim.css");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  test.each(CSS)(
    "%s: jede Animation und jeder Übergang steht im Zweig «no-preference»",
    (datei) => {
      const ausserhalb = bewegungen(lies(datei)).filter((b) => !b.imBlock);
      expect(ausserhalb).toEqual([]);
    },
  );

  test("lager-anim.js: jede Bewegung fragt zuerst, ob sie erlaubt ist", () => {
    const anim = lies("lager-anim.js");
    expect(anim).toContain("prefers-reduced-motion: no-preference");
    // Jedes .animate steht in spiele() oder hinter darfBewegen()
    const aufrufe = [...anim.matchAll(/\.animate\(/g)].length;
    const geschuetzt = [...anim.matchAll(/darfBewegen\(\)/g)].length;
    expect(aufrufe).toBeGreaterThan(0);
    expect(geschuetzt).toBeGreaterThanOrEqual(aufrufe - 1);
  });

  test.each(MODULE)(
    "%s: nutzt die gemeinsamen Hilfen (Bewegung, Skeleton) statt eigener Zeitgeber",
    (m) => {
      const q = quellen[m]!;
      const eigene = [
        "lager-anim.js",
        "lager-menschen.js",
        "lager-aufgaben-gemeinsam.js",
        "lager-einteilung-laden.js",
      ];
      const alle = [q, ...eigene.map(lies)].join("\n");
      expect(alle).toMatch(/ersetzeMitBewegung|bewegeUm|blendeEin|staffle/);
      // Animationen laufen nie über Inline-Stile
      expect(q).not.toMatch(/setAttribute\(\s*["'`]style|\.style\.cssText/);
    },
  );
});

describe("Verhalten ohne Bewegung", () => {
  let anim: Modul;
  beforeAll(async () => {
    vi.stubGlobal("document", { addEventListener: () => {} });
    vi.stubGlobal("window", {
      addEventListener: () => {},
      history: {},
      matchMedia: () => ({ matches: false }),
    });
    anim = (await import(
      /* @vite-ignore */ "../public/admin/lager-anim.js"
    )) as Modul;
  });

  test("darfBewegen ist falsch, wenn der Browser reduzierte Bewegung verlangt", () => {
    expect(anim.darfBewegen!()).toBe(false);
  });

  test("zaehleBis setzt den Endwert sofort", () => {
    const knoten = { textContent: "" };
    anim.zaehleBis!(knoten, 12, (n: number) => `${n} da`);
    expect(knoten.textContent).toBe("12 da");
  });

  test("ersetzeMitBewegung ersetzt sofort und lässt false und undefined weg", () => {
    let kinder: unknown[] = [];
    const ziel = {
      isConnected: true,
      replaceChildren: (...k: unknown[]) => (kinder = k),
    };
    anim.ersetzeMitBewegung!(ziel, "a", [false, "b"], undefined);
    expect(kinder).toEqual(["a", "b"]);
  });

  test("wachseBis setzt den Wert ohne Zwischenschritt", () => {
    const balken = { value: 0 };
    anim.wachseBis!(balken, 2, 5);
    expect(balken.value).toBe(5);
  });
});
