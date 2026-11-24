import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Kopf der Verwaltung (#669): «Zur Website», «Mein Konto» und «Abmelden» stehen im Konto-Menü unter dem Profil, wie im Kopf der Website; das Logo führt zur Website, «Verwaltung» zur Übersicht
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

test("das Konto-Menü hat «Zur Website», «Mein Konto» und «Abmelden» in dieser Reihenfolge, als Offenlegungsmenü ohne ARIA-«menu»", () => {
  const rahmen = lies("rahmen.js");
  const menue = rahmen.slice(rahmen.indexOf("function erstelleKontoMenue"));
  const website = menue.indexOf('"Zur Website"');
  const konto = menue.indexOf('"Mein Konto"');
  // Der Knopf wird oben angelegt und steht als letzter Eintrag in der Liste
  expect(menue).toContain('"Abmelden"');
  const abmelden = menue.indexOf('el("li", {}, abmelden)');
  expect(website).toBeGreaterThan(0);
  expect(konto).toBeGreaterThan(website);
  expect(abmelden).toBeGreaterThan(konto);
  expect(menue).toContain('el("a", { href: "/" }, icon("website")');
  expect(menue).toContain('href: "#konto"');
  expect(menue).toContain('"details"');
  expect(menue).not.toContain('role: "menu');
  // Name für Screenreader beginnt mit «Konto: » und enthält den sichtbaren Namen
  expect(menue).toContain('el("span", { class: "nur-leser" }, "Konto: ")');
  // Tastatur: Pfeile, Pos1, Ende, Esc mit Fokus zurück, Verlassen und Klick daneben schliessen
  for (const teil of [
    '"ArrowDown"',
    '"ArrowUp"',
    '"Escape"',
    '"Home"',
    '"End"',
    '"focusout"',
  ]) {
    expect(menue).toContain(teil);
  }
});

test("in der Leiste stehen nur noch Suchen, das Profil-Menü und der Umschalter; kein eigener Knopf «Abmelden» oder «Zur Website»", () => {
  const rahmen = lies("rahmen.js");
  const kopf = rahmen.slice(rahmen.indexOf("export function logozeile"));
  expect(kopf).not.toContain('"Abmelden"');
  expect(kopf).not.toContain("Zur Website");
  expect(rahmen).not.toContain("zur-website");
  expect(rahmen).not.toContain("bereichswahl-website");
});

test("das Logo führt zur Website, «Verwaltung» zur Übersicht; beide mit Namen und Hinweis", () => {
  const rahmen = lies("rahmen.js");
  expect(rahmen.match(/href: "\/",/g)).toHaveLength(2);
  expect(rahmen).not.toMatch(/class: "marke[^}]*href: "#"/);
  expect(rahmen).toContain('"aria-label": "Cevi: zur Website"');
  expect(rahmen).toContain(`"data-tipp": "Zur Website"`);
  expect(rahmen).toMatch(
    /class: "bereichname",\s*href: "#",\s*"data-tipp": "Zur Übersicht der Verwaltung"/,
  );
});

test("Ziele mindestens 44 px; unter 1100 px bleibt nur das Bild als Knopf des Menüs", () => {
  const css = lies("geruest.css");
  expect(css).toMatch(/\.konto \{[^}]*min-height: 2\.75rem/);
  expect(css).toMatch(/\.konto-liste button \{[^}]*min-height: 2\.75rem/);
  expect(css).toMatch(/a\.bereichname \{[^}]*min-height: 2\.75rem/);
  expect(css).toMatch(
    /@media \(max-width: 1100px\) \{[^@]*\.konto \.i \{\s*display: none/,
  );
  // Erzwungene Farben und Bewegung
  expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.konto-tafel/);
});
