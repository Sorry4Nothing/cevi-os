import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// Reine Browser-Module ohne Typen: Die Ansichten sind Funktionen von Daten zu Beschreibungen (h) und laufen ohne DOM
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as tm from "../public/website/tm.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as laden from "../public/website/laden.js";

// Lädeli im Browser (#566): Besucher sehen den Laden zum Ansehen, Warenkorb und Bestellen gibt es nur mit Konto
const html = tm.html as (d: unknown) => string;

const artikel = (extra: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Foulard",
  preisRappen: 2500,
  varianten: [] as string[],
  hinweis: "Aus Baumwolle",
  verfuegbar: true,
  bild: null,
  platz: 0,
  ...extra,
});
const zustand = (konto: string, a = artikel()) => ({
  artikel: new Map([[a.id, a]]),
  korb: [],
  grenzen: { positionen: 20, menge: 10 },
  uebergabearten: ["Abholung im Lädeli"],
  konto,
  pfad: "/ueber-uns/laedeli",
});
const wahl = (a = artikel()) => ({ artikel: a, variante: null, menge: 1 });

describe("Artikelfenster", () => {
  test("Besucher: Foto, Name, Preis und Beschreibung, dazu der Weg zur Anmeldung; kein Warenkorb, keine Menge", () => {
    const a = artikel();
    const s = html(laden.artikelView(a, wahl(a), zustand("aus", a)));
    expect(s).toContain("Foulard");
    expect(s).toContain("CHF 25.–");
    expect(s).toContain("Aus Baumwolle");
    expect(s).toContain("Zum Bestellen anmelden");
    expect(s).toContain("/anmelden?weiter=%2Fueber-uns%2Flaedeli");
    expect(s).not.toContain('data-aktion="dazu"');
    expect(s).not.toContain("laden-menge");
    expect(s).not.toContain("In den Warenkorb");
  });

  test("Besucher sehen die Grössen als Text, ohne Wahl", () => {
    const a = artikel({ varianten: ["S", "M"] });
    const s = html(laden.artikelView(a, wahl(a), zustand("aus", a)));
    expect(s).toContain("Grössen: S, M");
    expect(s).not.toContain('data-aktion="variante"');
  });

  test("angemeldet: Menge und «In den Warenkorb», kein Anmelde-Hinweis", () => {
    const a = artikel();
    const s = html(laden.artikelView(a, wahl(a), zustand("an", a)));
    expect(s).toContain('data-aktion="dazu"');
    expect(s).toContain("laden-menge");
    expect(s).not.toContain("Zum Bestellen anmelden");
  });

  test("Einheitsgrösse: keine Variantenwahl; mit Liste die Wahl", () => {
    const einheit = artikel();
    expect(
      html(laden.artikelView(einheit, wahl(einheit), zustand("an", einheit))),
    ).not.toContain('data-aktion="variante"');
    const liste = artikel({ varianten: ["S", "M"] });
    expect(
      html(laden.artikelView(liste, wahl(liste), zustand("an", liste))),
    ).toContain('data-aktion="variante"');
  });

  test("solange unklar ist, ob jemand angemeldet ist, zeigt es weder Bedienelemente noch Hinweis", () => {
    const a = artikel();
    const s = html(laden.artikelView(a, wahl(a), zustand("unbekannt", a)));
    expect(s).not.toContain('data-aktion="dazu"');
    expect(s).not.toContain("anmelden");
  });
});

describe("Kopf und Kachel", () => {
  test("der Hinweis für Besucher ist ein Link zur Anmeldung mit Rückweg", () => {
    const s = html(laden.anmeldeView(zustand("aus")));
    expect(s).toContain('href="/anmelden?weiter=%2Fueber-uns%2Flaedeli"');
    expect(s).toContain('data-aktion="anmelden"');
  });

  test("schnelles Hinzufügen bei Einheitsgrösse: ein Knopf ohne Varianten", () => {
    const s = html(laden.schnellView(artikel(), undefined));
    expect(s.match(/data-aktion="schnell"/g)).toHaveLength(1);
    expect(s).toContain("In den Warenkorb");
  });

  test("das Plus in der Kachel gibt es nur auf Geräten ohne Zeigen", () => {
    const css = readFileSync("public/website/laden.css", "utf8");
    const plus = css.match(/\.laden-plus \{[^}]*\}/)![0];
    expect(plus).toContain("display: none");
    expect(css).toMatch(
      /@media \(hover: none\) \{\s*\.laden-plus \{\s*display: grid/,
    );
  });
});
