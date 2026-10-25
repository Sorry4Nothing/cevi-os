import { farben } from "../src/ui/tokens";

type Farbe = keyof typeof farben.hell;

// Relative Leuchtdichte nach WCAG 2.2
function leuchtdichte(hex: string) {
  const kanal = (wert: number) => {
    const c = wert / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * kanal(n >> 16) +
    0.7152 * kanal((n >> 8) & 0xff) +
    0.0722 * kanal(n & 0xff)
  );
}

function kontrast(a: string, b: string) {
  const [heller, dunkler] = [leuchtdichte(a), leuchtdichte(b)].sort(
    (x, y) => y - x,
  );
  return (heller + 0.05) / (dunkler + 0.05);
}

// Jedes Paar, das in src/ui zusammen vorkommt; alles kann auch in einer Karte stehen
const paare: [Farbe, Farbe, number, string][] = [
  ["text", "hintergrund", 4.5, "Überschrift, Text, Eingabe, gedrückter Button"],
  ["text", "flaeche", 4.5, "Karte, Offline-Meldung, gedrückte Zeile"],
  ["textLeise", "hintergrund", 4.5, "Zweitzeile, Platzhalter, Badge neutral"],
  ["textLeise", "flaeche", 4.5, "dasselbe in einer Karte"],
  ["aufAkzent", "akzent", 4.5, "Button, gewählte Antwort"],
  ["fehler", "hintergrund", 4.5, "Fehlertext, Fehlerrand, Badge negativ"],
  ["fehler", "flaeche", 4.5, "dasselbe in einer Karte"],
  ["erfolg", "hintergrund", 4.5, "Badge positiv"],
  ["erfolg", "flaeche", 4.5, "dasselbe in einer Karte"],
  ["rand", "hintergrund", 3, "Rand von Textfeld und offener Antwort"],
  ["rand", "flaeche", 3, "dasselbe in einer Karte"],
  ["akzent", "hintergrund", 3, "Button, gewählte Antwort, Fokusrand"],
  ["akzent", "flaeche", 3, "dasselbe in einer Karte"],
];

test("die Formel trifft bekannte Werte", () => {
  expect(kontrast("#000000", "#FFFFFF")).toBe(21);
  expect(kontrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
});

test("jedes Farb-Token kommt in einem Paar vor", () => {
  expect(new Set(paare.flatMap(([vorne, hinten]) => [vorne, hinten]))).toEqual(
    new Set(Object.keys(farben.hell)),
  );
});

describe.each(["hell", "dunkel"] as const)("Modus %s", (modus) => {
  // Abgerundet, damit der Titel nie mehr verspricht, als die Prüfung zeigt
  const zeilen = paare.map(
    ([vorne, hinten, minimum, wo]) =>
      [
        vorne,
        hinten,
        wo,
        Math.floor(
          kontrast(farben[modus][vorne], farben[modus][hinten]) * 100,
        ) / 100,
        minimum,
      ] as const,
  );

  test.each(zeilen)(
    "%s auf %s (%s): %s:1, mindestens %s:1",
    (vorne, hinten, _wo, _wert, minimum) => {
      expect(
        kontrast(farben[modus][vorne], farben[modus][hinten]),
      ).toBeGreaterThanOrEqual(minimum);
    },
  );
});
