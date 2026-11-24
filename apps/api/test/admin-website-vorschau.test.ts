import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { bausteinSchema, type Baustein } from "../src/website/bausteine.js";
import {
  BEISPIEL_SEITE_ID,
  beispielDaten,
  platzhalterBilder,
  rendereBausteinVorschau,
} from "../src/website/vorschau.js";

// Vorschau der Bausteine im Katalog und im Editor (#739): der Vertrag der Katalogeinträge (gruppe, beispiel) und Quelltext-Prüfungen der Bedienung.
// Das Verhalten im Browser prüft die Skriptprobe in docs/barrierefreiheit.md, Abschnitt «Bausteine: Vorschau».
type Modul = Record<string, unknown>;
type Eintrag = {
  typ: string;
  name: string;
  gruppe?: string;
  beschreibung: string;
  neu: () => unknown;
  beispiel?: () => unknown;
};
let felder: Modul;
const lade = (name: string) =>
  import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  felder = await lade("website-felder.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

describe("Katalog: gruppe und beispiel je Eintrag", () => {
  test("jeder Eintrag hat eine bekannte Gruppe und Beispieldaten", () => {
    const katalog = felder.KATALOG as Eintrag[];
    const gruppen = felder.GRUPPEN as string[];
    expect(gruppen).toEqual([
      "Text",
      "Bilder und Medien",
      "Karten und Listen",
      "Handlung",
      "Personen",
      "Dynamisch",
      "Gestaltung",
    ]);
    expect(katalog.length).toBeGreaterThan(20);
    const ohne = katalog.filter(
      (e) =>
        !gruppen.includes(e.gruppe ?? "") || typeof e.beispiel !== "function",
    );
    expect(ohne.map((e) => `${e.typ} ${e.name}`)).toEqual([]);
  });

  test("jedes Beispiel erfüllt das Schema des Bausteins und der Renderer der Website zeigt etwas: ohne Datenbank, nur Platzhalter", () => {
    const katalog = felder.KATALOG as Eintrag[];
    const bausteine: Baustein[] = [];
    for (const e of katalog) {
      const p = bausteinSchema.safeParse({
        id: crypto.randomUUID(),
        typ: e.typ,
        daten: e.beispiel!(),
        sichtbarkeit: "erbt",
      });
      expect(p.success, `${e.typ} ${e.name}`).toBe(true);
      if (p.success) bausteine.push(p.data);
    }
    const daten = beispielDaten([{ v: 1, titel: "Vorschau", bausteine }]);
    const ersatz = platzhalterBilder(daten);
    const leer: string[] = [];
    for (const [i, b] of bausteine.entries()) {
      const v = rendereBausteinVorschau(b, daten, BEISPIEL_SEITE_ID, ersatz);
      if (!v.html) leer.push(`${b.typ} ${katalog[i]!.name}`);
      else {
        // Eine eigene Seite: nie Skript, nie ein Medium der Datenbank, nie ein Link mit Ziel
        expect(v.html).not.toContain("<script");
        expect(v.html).not.toContain("/api/v1/medien/");
        expect(v.html).not.toMatch(/<a\b[^>]*\shref=/);
      }
    }
    expect(leer).toEqual([]);
  });

  test("ein Eintrag ohne eindeutigen Namen gibt es nicht (Typ und Darstellung)", () => {
    const namen = (felder.KATALOG as Eintrag[]).map((e) => e.name);
    expect(new Set(namen).size).toBe(namen.length);
  });
});

describe("Vorschau im Rahmen", () => {
  const js = quelle("website-vorschau.js");

  test("der Rahmen läuft ohne Skript: nur sandbox allow-same-origin, nie innerHTML", () => {
    // Ohne Kommentare: Sie dürfen erklären, was fehlt
    const code = js.replace(/\/\/[^\n]*/g, "");
    expect(code).toContain('sandbox: "allow-same-origin"');
    expect(code).not.toContain("allow-scripts");
    expect(code).not.toContain("allow-top-navigation");
    expect(code).not.toContain("allow-forms");
    expect(code).not.toMatch(/innerHTML|insertAdjacentHTML|document.write/);
    expect(code).toContain("srcdoc");
    expect(code).toContain("/bausteine/vorschau");
  });

  test("die Vorschau im Editor ist aufklappbar mit aria-expanded und aria-controls, die Liste kennt die offenen Vorschauen", () => {
    expect(js).toContain('"aria-expanded"');
    expect(js).toContain('"aria-controls"');
    expect(js).toContain("Vorschau zeigen");
    expect(js).toContain("Vorschau verbergen");
    // Eine Fehlermeldung hat «Nochmals versuchen», eine Ladeanzeige eine Statusregion
    expect(js).toContain("Nochmals versuchen");
    expect(js).toContain('role: "status"');
    const editor = quelle("website-editor.js");
    expect(editor).toContain("bausteinVorschau(k, b, bezeichnung)");
    expect(editor).toContain("vorschauOffen: new Set()");
  });

  test("der Katalog: Kacheln in Gruppen, Suche, Pfeiltasten, Skeleton, ohne Vorschau bleibt jede Kachel wählbar", () => {
    const js2 = quelle("website-bausteine.js");
    for (const taste of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
      expect(js2).toContain(taste);
    }
    expect(js2).toContain("vorschauSkelett()");
    expect(js2).toContain("Keine Vorschau");
    expect(js2).toContain("Du kannst trotzdem einen Baustein wählen.");
    expect(js2).toContain('"aria-pressed"');
    // Roving tabindex: Nur eine Kachel ist per Tab erreichbar
    expect(js2).toContain("tabIndex = 0");
    // Die Vorschau in der Kachel ist nur Bild: inert und für Screenreader verborgen, der Knopf trägt den Namen
    expect(js2).toContain('inert: true, "aria-hidden": "true"');
  });

  test("Stil: Bewegung nur mit prefers-reduced-motion: no-preference, kein style-Attribut im Markup, Fokus an der ganzen Kachel", () => {
    const css = quelle("website.css");
    const bewegung = css.match(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.ws-kachel \{[^}]*\}/,
    );
    expect(bewegung?.[0]).toContain("transition");
    // Ausserhalb dieses Blocks hat die Kachel keine Bewegung
    const kachel = css.slice(
      css.indexOf(".ws-kachel {"),
      css.indexOf(".ws-kachel[hidden]"),
    );
    expect(kachel).not.toContain("transition");
    expect(css).toContain(".ws-kachel:has(.ws-kachel-knopf:focus-visible)");
    expect(css).toContain("outline: 3px solid var(--akzent)");
    expect(alleQuellen()).not.toMatch(/setAttribute\(\s*["']style["']/);
  });
});

function alleQuellen() {
  return (
    quelle("website-vorschau.js") +
    quelle("website-bausteine.js") +
    quelle("website-editor.js")
  );
}
