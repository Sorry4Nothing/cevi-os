import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Rückmeldungen nach einer Aktion auf der Website sind Toasts (#762, docs/website-design.md «Rückmeldungen»). Dieser Test hält neue Kästen draussen:
// Wer in public/website/*.js ein Band mit role «alert» oder ein Erfolgsband (art «ok») anlegt, muss es in ERLAUBT mit Grund eintragen, sonst gehört die Meldung in toast.js.
const ORDNER = new URL("../public/website/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const dateien = readdirSync(ORDNER).filter((n) => n.endsWith(".js"));
const lies = (name: string) => readFileSync(join(ORDNER, name), "utf8");
// Kommentare weg: Eine Erklärung zählt nicht als Aufruf
const ohneKommentare = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\'"`])\/\/[^\n]*/g, "$1");

// Was ein Kasten im Inhalt ist: ein Band oder Zustand mit role «alert», ein Erfolgsband
const KASTEN =
  /rolle: "alert"|role: "alert"|"role",\s*"alert"|art: "ok"|class="band ok"|band ok/g;

// Datei → Zahl der erlaubten Treffer und warum (Feldfehler, Zusammenfassung, Lade- und Leerzustände, dauerhafte Seitenzustände, Entscheidungen)
const ERLAUBT: Record<string, [number, string]> = {
  "anlass.js": [
    1,
    "dauerhafter Zustand des Anlasses: «Du bist angemeldet.» mit Verweis, kein Ergebnis einer Aktion",
  ],
  "anmelden.js": [
    2,
    "Fehlerzusammenfassung der Anmeldung (fehlende Angaben) und «Benutzername oder Passwort stimmen nicht» am Formular",
  ],
  "anmeldung.js": [
    3,
    "Fehlerzusammenfassung beim Absenden, Zustand «schon angemeldet» (Seite statt Formular) und «Server antwortet nicht» mit «Nochmals senden»",
  ],
  "fotos.js": [1, "Ladefehler der Alben mit «Nochmals versuchen»"],
  "geschuetzt.js": [
    1,
    "Ladefehler des geschützten Inhalts mit «Nochmals versuchen»",
  ],
  "laden.js": [
    3,
    "Meldungen am Warenkorb (Preis, Verfügbarkeit, Mindestbestellung: die Person ändert den Korb) in Korb und Übersicht, Ladefehler der Bestellungen mit «Nochmals versuchen»",
  ],
  "termin.js": [
    1,
    "dauerhafter Zustand des Termins: «Du bist angemeldet.» mit Verweis",
  ],
  "termine-link.js": [
    1,
    "Ladefehler des Kalender-Links (der Kasten bleibt benutzbar)",
  ],
  "tm.js": [1, "Fehlerzustand einer Seite mit «Nochmals versuchen»"],
  "vorschlag.js": [
    2,
    "Fehlerzusammenfassung beim Absenden und «Server antwortet nicht» mit «Nochmals senden»",
  ],
};

// Aktionen, die etwas ändern, melden das Ergebnis über toast.js. Diese Dateien rufen schreibend auf und haben einen Grund, es nicht direkt zu tun.
const OHNE_TOAST_IMPORT: Record<string, string> = {
  "konto-menue.js":
    "lädt toast.js erst bei Bedarf (import()), damit Seiten ohne Aktion kein Byte dafür laden",
};

describe("Website: Rückmeldungen sind Toasts (#762)", () => {
  test("keine Kästen für Aktionsergebnisse ausser den erlaubten", () => {
    const treffer: Record<string, number> = {};
    for (const name of dateien) {
      if (name === "toast.js") continue;
      const n = ohneKommentare(lies(name)).match(KASTEN)?.length ?? 0;
      if (n > 0) treffer[name] = n;
    }
    const erlaubt = Object.fromEntries(
      Object.entries(ERLAUBT).map(([k, [n]]) => [k, n]),
    );
    // Bei einer Abweichung: Ergebnis einer Aktion gehört in toast(); bleibt es ein Zustand, in ERLAUBT mit Grund eintragen
    expect(treffer).toEqual(erlaubt);
    for (const [, grund] of Object.values(ERLAUBT)) {
      expect(grund.length).toBeGreaterThan(20);
    }
  });

  test("kein eigenes Snackbar- oder Meldungsfeld im Menü", () => {
    for (const name of dateien) {
      expect(ohneKommentare(lies(name)), name).not.toMatch(/["' ]snack["' ]/);
    }
    const css = readdirSync(ORDNER)
      .filter((n) => n.endsWith(".css"))
      .map((n) => lies(n))
      .join("\n");
    expect(css).not.toContain(".snack");
    expect(css).not.toContain(".konto-meldung");
  });

  test("jede Datei, die schreibend aufruft, meldet über toast.js", () => {
    const schreibend = /method(e)?: "(POST|PUT|PATCH|DELETE)"/;
    const ohne: string[] = [];
    for (const name of dateien) {
      const text = ohneKommentare(lies(name));
      if (!schreibend.test(text)) continue;
      if (/from "\.\/toast\.js"/.test(text)) continue;
      if (name in OHNE_TOAST_IMPORT) {
        expect(text).toContain('import("./toast.js")');
        continue;
      }
      ohne.push(name);
    }
    expect(ohne).toEqual([]);
  });

  test("Dauer, Stapel, Live-Regionen und Bedienung stehen in toast.js", () => {
    const t = lies("toast.js");
    expect(t).toContain("export const ERFOLG_MS = 4000;");
    expect(t).toContain("export const FEHLER_MS = 8000;");
    expect(t).toContain("export const MAX = 3;");
    // höflich für Erfolg und Info, bestimmt nur für Fehler (WCAG 4.1.3)
    expect(t).toContain('setAttribute("aria-live", "polite")');
    expect(t).toContain('setAttribute("aria-live", "assertive")');
    expect(t).toMatch(/art === "fehler" \? bestimmt : hoeflich/);
    // Pause bei Zeiger und Fokus (WCAG 2.2.1), Schliessen-Knopf, Esc
    for (const e of ["mouseenter", "focusin", "mouseleave", "focusout"]) {
      expect(t).toContain(`"${e}"`);
    }
    expect(t).toContain('"Schliessen"');
    expect(t).toContain('"Escape"');
    // Ohne innerHTML, ohne Abhängigkeit, ohne Abruf
    expect(ohneKommentare(t)).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|fetch\(|localStorage/,
    );
    expect(t).not.toMatch(/^import /m);
  });

  test("Stil: eine feste Stelle, Tag und Nacht aus den Tokens, Bewegung nur erlaubt, erzwungene Farben", () => {
    const css = lies("website.css");
    const abschnitt = css.slice(css.indexOf("/* ===== Toasts (#762)"));
    expect(abschnitt).toContain("position: fixed;");
    expect(abschnitt).toContain("var(--inverse-surface)");
    expect(abschnitt).toContain("var(--error-container)");
    expect(abschnitt).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*toast-ein/,
    );
    expect(abschnitt).toContain("@media (forced-colors: active)");
    // Keine Farbwerte im Stil des Toasts
    expect(abschnitt.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /#[0-9a-f]{3,8}\b/i,
    );
    // 44 px Zielgrösse für «Schliessen»
    expect(abschnitt).toContain("width: 2.75rem;");
  });

  test("Seiten laden toast.js nie selbst: nur Skripte mit Aktionen holen es", () => {
    // toast.js ist keine Seite und kein klassisches Skript im head; die Seiten laden es nur über ihre Module
    const rendern = readFileSync(
      new URL("../src/website/rendern.ts", import.meta.url),
      "utf8",
    );
    expect(rendern).not.toContain("toast.js");
  });
});
