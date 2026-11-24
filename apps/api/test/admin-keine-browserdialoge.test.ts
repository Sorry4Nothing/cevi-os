import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

// Keine vom Browser gezeichneten Oberflächen (#699): kein alert/confirm/prompt, keine Validierungsblasen, keine nativen Datums-, Zeit- und Farbwähler, keine Datalist, keine Tooltips per title-Attribut, keine Frage «Seite verlassen?» ausser als letzte Rückfallebene.
// Die Prüfung liest alle Dateien unter public/ (Verwaltung, Website, öffentliche Seiten) und das Server-HTML in src/website; neue Dateien fallen von selbst hinein. Das Verhalten im Browser prüft die Skriptprobe in docs/barrierefreiheit.md, Abschnitt 71.

const WURZEL = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

function alle(ordner: string, endungen: string[]): string[] {
  const treffer: string[] = [];
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) treffer.push(...alle(pfad, endungen));
    else if (endungen.some((e) => name.endsWith(e))) treffer.push(pfad);
  }
  return treffer;
}

// Kommentare weg, damit eine Erklärung («kein confirm()») nicht als Aufruf zählt
function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, "$1");
}

const dateien = [
  ...alle(join(WURZEL, "public"), [".js", ".html"]),
  ...alle(join(WURZEL, "src", "website"), [".ts"]),
].map((pfad) => ({
  name: relative(WURZEL, pfad).replaceAll("\\", "/"),
  text: ohneKommentare(readFileSync(pfad, "utf8")),
}));

const finde = (muster: RegExp, nur?: (name: string) => boolean) =>
  dateien
    .filter((d) => (nur ? nur(d.name) : true))
    .flatMap((d) =>
      [...d.text.matchAll(muster)].map((t) => `${d.name}: ${t[0].trim()}`),
    );

const oeffentlich = (name: string) => name.startsWith("public/");

describe("keine Browserdialoge", () => {
  test("die Prüfung sieht die Verwaltung, die Website und das Server-HTML", () => {
    expect(dateien.some((d) => d.name === "public/admin/fluss.js")).toBe(true);
    expect(dateien.some((d) => d.name === "public/website/anmeldung.js")).toBe(
      true,
    );
    expect(dateien.some((d) => d.name === "src/website/rendern.ts")).toBe(true);
  });

  test("kein alert, confirm oder prompt, auch nicht über window, globalThis oder eckige Klammern", () => {
    expect(
      finde(
        /(?<![\w$.])(alert|confirm|prompt)\s*\(|\b(?:window|globalThis|self|top|parent)\s*(?:\.|\?\.)\s*(?:alert|confirm|prompt)\b|\[\s*["'`](?:alert|confirm|prompt)["'`]\s*\]/g,
      ),
    ).toEqual([]);
    // Auch nicht in Attributen wie onclick="confirm(…)"
    expect(
      finde(/\bon\w+\s*=\s*["'][^"']*\b(?:alert|confirm|prompt)\b/g),
    ).toEqual([]);
  });

  test("keine Validierungsblasen: weder reportValidity noch setCustomValidity", () => {
    expect(finde(/\b(?:reportValidity|setCustomValidity)\b/g)).toEqual([]);
  });

  test("jedes Formular hat novalidate; die Fehler stehen am Feld", () => {
    const ohne: string[] = [];
    for (const d of dateien) {
      // Skript: el("form", { … }) oder h("form", { … })
      for (const t of d.text.matchAll(/\b(?:el|h)\(\s*["']form["']\s*,/g)) {
        const rest = d.text.slice(t.index, t.index + 500);
        if (!/novalidate/i.test(rest))
          ohne.push(`${d.name}: ${rest.slice(0, 60)}`);
      }
      // HTML: <form …>
      for (const t of d.text.matchAll(/<form\b[^>]*>/gi)) {
        if (!/novalidate/i.test(t[0])) ohne.push(`${d.name}: ${t[0]}`);
      }
      for (const t of d.text.matchAll(/createElement\(\s*["']form["']\s*\)/g)) {
        ohne.push(`${d.name}: ${t[0]} (novalidate fehlt)`);
      }
    }
    expect(ohne).toEqual([]);
  });

  test("keine nativen Wähler und Listen: date, time, datetime-local, month, week, color, number, datalist", () => {
    expect(
      finde(
        /\btype\s*[:=]\s*["'](?:date|time|datetime-local|month|week|color|number)["']|<datalist\b|\bdatalist\b|\blist\s*:\s*["']/gi,
      ),
    ).toEqual([]);
  });

  test("ein Dateifeld bleibt unsichtbar (nur-leser, datei-eingabe); der Auslöser ist ein eigener Knopf", () => {
    const sichtbar: string[] = [];
    for (const d of dateien) {
      for (const t of d.text.matchAll(/\btype\s*:\s*["']file["']/g)) {
        const umfeld = d.text.slice(t.index, t.index + 300);
        if (!/nur-leser|datei-eingabe/.test(umfeld)) {
          sichtbar.push(`${d.name}: ${umfeld.slice(0, 80)}`);
        }
      }
    }
    expect(sichtbar).toEqual([]);
    expect(finde(/<input\b[^>]*type=["']file["']/gi)).toEqual([]);
  });

  test("kein data-nativ: jedes select wird das eigene Auswahlfeld", () => {
    expect(finde(/data-nativ/g, (n) => !n.endsWith("auswahl.js"))).toEqual([]);
    expect(
      readFileSync(join(WURZEL, "public/admin/index.html"), "utf8"),
    ).toContain('src="/admin/auswahl.js"');
  });

  test("keine Tooltips des Browsers: kein title-Attribut ausser am Rahmen der Vorschau (iframe braucht einen Namen)", () => {
    const erlaubt = new Set(["public/admin/website-editor.js"]);
    const funde = [
      // Eigenschaft in einer Beschreibung: { title: "…" }, setAttribute("title", …)
      ...finde(
        /(?<![\w$.])title\s*:\s*\S[^\n]*|setAttribute\(\s*["']title["']|(?<!\bdoc(?:ument)?)\.title\s*=[^=][^\n]*/g,
        (n) => oeffentlich(n) && !erlaubt.has(n),
      ),
      // HTML: <a title="…">
      ...finde(/<[a-z][^>]*\stitle\s*=/gi),
      // title in einer SVG: zeigt der Browser als Tooltip
      ...finde(/<svg\b[\s\S]{0,400}?<title\b/gi),
    ];
    expect(funde).toEqual([]);
    // Den Hinweis liefert tipp.js (data-tipp): ein Element, ein Text, role="tooltip"
    expect(
      readFileSync(join(WURZEL, "public/admin/tipp.js"), "utf8"),
    ).toContain('role", "tooltip"');
  });

  test("beforeunload nur als Rückfallebene beim Schliessen und Neuladen: eine Stelle, ungespeichert.js", () => {
    const stellen = dateien
      .filter((d) => /beforeunload|onunload/i.test(d.text))
      .map((d) => d.name);
    expect(stellen).toEqual(["public/admin/ungespeichert.js"]);
    const wache = readFileSync(
      join(WURZEL, "public/admin/ungespeichert.js"),
      "utf8",
    );
    // Der Dialog des Browsers erscheint nur mit echten Änderungen
    expect(wache).toMatch(
      /addEventListener\("beforeunload"[\s\S]{0,200}?if \(!hatUngespeichertes\(\)\) return;/,
    );
    // Menü, Link und Zurück fragen mit der eigenen Zeile, bevor es zum Browser kommt
    expect(wache).toContain('"hashchange"');
    expect(wache).toContain('a[href^="#"]');
    expect(wache).toContain("Bleiben");
    expect(wache).toContain("Verwerfen und gehen");
  });

  test("admin.js lädt den Wächter vor jeder Navigation", () => {
    const admin = readFileSync(join(WURZEL, "public/admin/admin.js"), "utf8");
    const erste = admin.match(/^import\s.*$/m)?.[0];
    expect(erste).toBe('import "./ungespeichert.js";');
  });

  test("jede Speicherleiste meldet sich beim Wächter an", () => {
    const hilfen = readFileSync(
      join(WURZEL, "public/admin/kalenderhilfen.js"),
      "utf8",
    );
    const leiste = hilfen.slice(
      hilfen.indexOf("export function speicherLeiste"),
    );
    expect(leiste).toContain("schuetze({");
  });
});
