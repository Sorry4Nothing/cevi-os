import { expect, test } from "vitest";
import { keineDaten, serialisiere } from "../src/website/rendern.js";
import { rendereLaden, type LadenArtikel } from "../src/website/laden.js";

// Lädeli (#629): Der Renderer zeigt nicht verfügbare Grössen durchgestrichen und mit Wort; das Skript liest den Namen aus data-name
const artikel = (extra: Partial<LadenArtikel> = {}): LadenArtikel => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Shirt",
  preisRappen: 2500,
  mediumId: null,
  varianten: ["S", "M", "L"],
  nichtVerfuegbar: [],
  hinweis: null,
  verfuegbar: true,
  ...extra,
});
const rendere = (a: LadenArtikel) => {
  const daten = {
    ...keineDaten(),
    laden: new Map([[a.id, a]]),
    ladenUebergabe: new Map([["Abholung im Lädeli", true as const]]),
  };
  return serialisiere(rendereLaden(daten, 2)!);
};

test("alle Grössen verfügbar: keine Durchstreichung, keine Notiz", () => {
  const s = rendere(artikel());
  expect(s).not.toContain("laden-variante--weg");
  expect(s).not.toContain("laden-weg-notiz");
  expect(s).toContain('<li data-name="S">S</li>');
});

test("eine Grösse nicht verfügbar: durchgestrichen, mit Wort für Hilfstechnik und sichtbarer Notiz; der Artikel bleibt verfügbar", () => {
  const s = rendere(artikel({ nichtVerfuegbar: ["S"] }));
  expect(s).toContain(
    '<li class="laden-variante--weg" data-name="S"><s>S</s><span class="nur-leser"> nicht verfügbar</span></li>',
  );
  expect(s).toContain('<li data-name="M">M</li>');
  expect(s).toContain('<p class="laden-weg-notiz">S nicht verfügbar</p>');
  expect(s).not.toContain("laden-artikel--weg");
});

test("alle Grössen nicht verfügbar: der Artikel ist es auch (Marke «Nicht verfügbar», keine zusätzliche Notiz)", () => {
  const s = rendere(
    artikel({ nichtVerfuegbar: ["S", "M", "L"], verfuegbar: false }),
  );
  expect(s).toContain("laden-artikel--weg");
  expect(s).toContain("Nicht verfügbar");
  expect(s).not.toContain("laden-weg-notiz");
});
