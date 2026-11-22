import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereAnmeldung,
  rendereFehlerseite,
  rendereHuelle,
  rendereSeite,
  rendereServerfehler,
  rendereWartung,
  type Daten,
  type Kontext,
} from "../src/website/rendern.js";
import { HINWEISSEITE } from "../src/website/sperre.js";

// Design «Cevi Web» (#529): Hülle, Seitentypen, Fehlerseiten, Stilvorlage
const CSS = readFileSync(
  new URL("../public/website/website.css", import.meta.url),
  "utf8",
);

const id = () => randomUUID();
const b = (typ: string, daten: unknown, extra: object = {}) => ({
  id: id(),
  typ,
  daten,
  ...extra,
});
const dok = (titel: string, ...bausteine: unknown[]) => {
  const p = pruefeDokument({ v: 1, titel, bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const text = (t: string) =>
  b("text", { inhalt: [{ typ: "absatz", inhalt: [{ text: t }] }] });
const kontext = (daten: Daten = keineDaten()): Kontext => ({
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [
    { pfad: "/", titel: "Start", kinder: [] },
    {
      pfad: "/stufen",
      titel: "Stufen",
      kinder: [{ pfad: "/stufen/woelfe", titel: "Wölfe", kinder: [] }],
    },
  ],
  daten,
});
const zaehle = (t: string, teil: string) => t.split(teil).length - 1;

describe("Hülle", () => {
  const html = rendereSeite(
    { id: id(), pfad: "/stufen", dokument: dok("Stufen", text("Hallo")) },
    kontext(),
  );

  test("Sprunglink zuerst, ein H1, ein main, Fusszeile mit Datenschutz", () => {
    expect(html.indexOf('class="sprunglink"')).toBeLessThan(
      html.indexOf("<header>"),
    );
    expect(zaehle(html, "<h1")).toBe(1);
    expect(zaehle(html, "<main ")).toBe(1);
    expect(html).toContain('<footer class="fuss">');
    expect(html).toContain('<a href="/datenschutz">Datenschutz</a>');
  });

  test("Marke: «Cevi» steht im Logo, nicht zweimal", () => {
    expect(html).toContain(
      '<a class="marke" href="/"><b>CEVI</b><span>Beispielstadt</span></a>',
    );
  });

  test("Menü am Handy ohne Skript: details, und es gibt kein Skript und keinen Inline-Stil", () => {
    expect(html).toContain('<details class="menue-mobil">');
    expect(html).not.toMatch(/<script|style=|<style/i);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  test("aktueller Bereich: Oberseite aria-current=true, Unterleiste mit den Unterseiten", () => {
    expect(html).toContain('<a href="/stufen" aria-current="page">');
    const unterwegs = rendereSeite(
      {
        id: id(),
        pfad: "/stufen/woelfe",
        dokument: dok("Wölfe", text("x")),
      },
      kontext(),
    );
    expect(unterwegs).toContain('<a href="/stufen" aria-current="true">');
    expect(unterwegs).toContain(
      '<a href="/stufen/woelfe" aria-current="page">',
    );
    expect(unterwegs).toContain(
      '<nav class="unterleiste" aria-label="Unterseiten von Stufen">',
    );
  });
});

describe("Startseite und Stufenseite", () => {
  const medium = id();
  const daten: Daten = {
    ...keineDaten(),
    medien: new Map([
      [
        medium,
        {
          mimeTyp: "image/jpeg",
          groesse: 10,
          breite: 10,
          hoehe: 10,
          altText: "Kinder im Wald",
        },
      ],
    ]),
  };

  test("Startseite: Foto, Text und Schaltflächen bilden das Teaser-Feld mit dem einzigen H1", () => {
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/",
        dokument: dok(
          "Spiel und Natur",
          b("bild", { mediumId: medium }),
          text("Komm vorbei."),
          b("schaltflaeche", {
            darstellung: "schaltflaeche",
            beschriftung: "Schnuppern",
            ziel: "/kontakt",
          }),
          b("schaltflaeche", {
            darstellung: "schaltflaeche",
            beschriftung: "Termine",
            ziel: "/termine",
          }),
          b("ueberschrift", { ebene: 2, text: "Stufen" }),
        ),
      },
      kontext(daten),
    );
    expect(html).toContain('<section class="teaser"');
    expect(html).toContain('<h1 id="h1">Spiel und Natur</h1>');
    expect(zaehle(html, "<h1")).toBe(1);
    // Nur die erste Schaltfläche ist rot
    expect(html).toContain('href="/kontakt" class="btn p gross"');
    expect(html).toContain('href="/termine" class="btn s gross"');
    expect(html).toContain("<h2>Stufen</h2>");
    // Der Teaser steht vor dem übrigen Inhalt
    expect(html.indexOf("teaser")).toBeLessThan(html.indexOf("<h2>Stufen"));
  });

  test("Startseite ohne Foto, Text und Schaltfläche: gewöhnlicher Seitenkopf", () => {
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/",
        dokument: dok("Start", b("ueberschrift", { ebene: 2, text: "A" })),
      },
      kontext(),
    );
    expect(html).not.toContain('class="teaser');
    expect(html).toContain('<div class="seitenkopf"><h1>Start</h1></div>');
  });

  test("Stufenseite: Text und Bild vor den Stufenfeldern stehen links, die Felder rechts", () => {
    const seiteId = id();
    const d: Daten = {
      ...daten,
      stufenfakten: new Map([
        [seiteId, [{ bezeichnung: "Zeit", wert: "14:00 bis 17:00 Uhr" }]],
      ]),
    };
    const html = rendereSeite(
      {
        id: seiteId,
        pfad: "/stufen/woelfe",
        dokument: dok(
          "Wölfe",
          text("Willkommen"),
          b("bild", { mediumId: medium }),
          b("stufenfakten", {}),
          b("ueberschrift", { ebene: 2, text: "Team" }),
        ),
      },
      kontext(d),
    );
    expect(html).toContain('<div class="zweispalten">');
    expect(html).toContain('<aside aria-label="Das Wichtigste">');
    const links = html.slice(
      html.indexOf('<div class="spalte">'),
      html.indexOf("<aside"),
    );
    expect(links).toContain("Willkommen");
    expect(links).toContain("<img");
    expect(html.indexOf("<aside")).toBeLessThan(html.indexOf("<h2>Team"));
    expect(html).toContain(
      '<div class="fakt"><dt>Zeit</dt><dd>14:00 bis 17:00 Uhr</dd></div>',
    );
  });

  test("Stufenfelder ohne Text davor: keine zweite Spalte", () => {
    const seiteId = id();
    const d: Daten = {
      ...keineDaten(),
      stufenfakten: new Map([[seiteId, [{ bezeichnung: "Zeit", wert: "x" }]]]),
    };
    const html = rendereSeite(
      {
        id: seiteId,
        pfad: "/stufen/woelfe",
        dokument: dok("Wölfe", b("stufenfakten", {})),
      },
      kontext(d),
    );
    expect(html).not.toContain("zweispalten");
    expect(html).toContain('<dl class="fakten karte">');
  });
});

describe("Geschützter Baustein und Hülle (W10)", () => {
  test("Platzhalter: Hinweis und Link zur Anmeldung mit Rückweg, kein Inhalt", () => {
    const geheim = "GEHEIM-1234";
    const baustein = b(
      "text",
      { inhalt: [{ typ: "absatz", inhalt: [{ text: geheim }] }] },
      { sichtbarkeit: { art: "angemeldet" } },
    );
    const html = rendereSeite(
      { id: id(), pfad: "/stufen", dokument: dok("Stufen", baustein) },
      kontext(),
    );
    expect(html).not.toContain(geheim);
    expect(html).toContain("Nur angemeldet sichtbar");
    expect(html).toContain("Dieser Teil ist nur für angemeldete Personen.");
    expect(html).toContain('href="/anmelden?weiter=%2Fstufen"');
    // Das Skript läuft nur wegen des Platzhalters, und es ist nie inline
    expect(html).toContain(
      '<script type="module" src="/website/geschuetzt.js">',
    );
  });

  test("Hülle: Titel «Geschützte Seite», Hinweis, noindex", () => {
    const html = rendereHuelle("/intern", kontext());
    expect(html).toContain("<h1>Geschützte Seite</h1>");
    expect(html).toContain("Diese Seite ist nur für angemeldete Personen.");
    expect(html).toContain('href="/anmelden?weiter=%2Fintern"');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("data-huelle");
  });
});

describe("Fehler- und Wartungsseiten (W4)", () => {
  test("404: ein H1, Weg zur Startseite, die Hauptpunkte, noindex", () => {
    const html = rendereFehlerseite(kontext());
    expect(zaehle(html, "<h1")).toBe(1);
    expect(html).toContain("Diese Seite gibt es nicht.");
    expect(html).toContain(
      '<a class="btn p gross" href="/">Zur Startseite</a>',
    );
    expect(html).toContain('<nav aria-label="Hauptpunkte"');
    expect(html).toContain("Fehler 404");
  });

  test("500: ohne Skript, «Nochmals versuchen» ist ein Link auf dieselbe Adresse, nur das Logo im Kopf", () => {
    const html = rendereServerfehler(kontext());
    expect(zaehle(html, "<h1")).toBe(1);
    expect(html).toContain("Bei uns ist etwas schiefgegangen.");
    expect(html).toContain('href="">');
    expect(html).toContain("Nochmals versuchen");
    expect(html).toContain("Fehler 500");
    expect(html).not.toMatch(/<script|<button/);
    expect(html).not.toContain('class="leiste"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  test("Wartung: «Wir sind gleich wieder da.», Fehler 503", () => {
    const html = rendereWartung(kontext());
    expect(zaehle(html, "<h1")).toBe(1);
    expect(html).toContain("Wir sind gleich wieder da.");
    expect(html).toContain("Fehler 503");
    expect(html).not.toContain('class="leiste"');
  });

  test("Sperrseite: neutral, mit Tag und Nacht, ohne Skript und fremde Adresse", () => {
    expect(HINWEISSEITE).toContain("prefers-color-scheme: dark");
    expect(HINWEISSEITE).toContain("Vorübergehend nicht erreichbar");
    expect(HINWEISSEITE).not.toMatch(/<script|https?:\/\//);
  });
});

describe("Anmeldeseite (W9)", () => {
  const html = rendereAnmeldung(kontext());

  test("Felder mit Beschriftung und autocomplete, Passwort zeigen mit aria-pressed", () => {
    expect(html).toContain('<label for="benutzername">Benutzername</label>');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain(
      'aria-pressed="false" aria-label="Passwort anzeigen"',
    );
    // Kein name-Attribut: Das Formular sendet nichts von selbst
    expect(html).not.toMatch(/<input[^>]*\sname=/);
  });

  test("ohne Skript: Hinweis im noscript; ein H1; nur eigenes Skript", () => {
    expect(html).toContain("<noscript>");
    expect(zaehle(html, "<h1")).toBe(1);
    expect(zaehle(html, "<script")).toBe(1);
    expect(html).toContain('src="/website/anmelden.js"');
  });
});

describe("Stilvorlage", () => {
  test("Tag und Nacht, reduzierte Bewegung, erzwungene Farben", () => {
    expect(CSS).toContain("@media (prefers-color-scheme: dark)");
    expect(CSS).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(CSS).toContain("@media (forced-colors: active)");
    // Beide Werte der Markenfarben als Text: Rot in der Nacht heller
    expect(CSS).toMatch(/--primary-text: #d50038/);
    expect(CSS).toMatch(/--primary-text: #ff7a93/);
  });

  test("nichts von aussen: keine Adresse, kein @import, keine Daten-URL", () => {
    expect(CSS).not.toMatch(/https?:\/\/|@import|url\(/);
  });

  test("Farben nur als Token ausserhalb der Token-Blöcke", () => {
    const ausserhalb = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /:root\s*\{[^}]*\}/g,
      "",
    );
    // Erlaubt: Systemfarben der erzwungenen Farben (CanvasText) und transparent
    expect(ausserhalb).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ausserhalb).not.toMatch(/rgba?\(/);
  });

  test("Bewegung nur unter no-preference: kein animation ausserhalb", () => {
    const ohne = CSS.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/,
      "",
    );
    expect(ohne).not.toMatch(/animation:/);
  });
});
