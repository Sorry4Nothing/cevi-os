import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  keineDaten,
  PFAD_ABTEILUNGSLEITUNG,
  rendereAnmeldung,
  rendereHuelle,
  rendereSeite,
  type Daten,
  type Kontext,
} from "../src/website/rendern.js";
import {
  rendereFehlerseite,
  rendereServerfehler,
  rendereWartung,
  stimmungsbild,
} from "../src/website/fehlerseiten.js";
import { HINWEIS_STIL, HINWEISSEITE } from "../src/website/sperre.js";

// Design «Cevi Web» (#529): Hülle, Seitentypen, Fehlerseiten, Stilvorlage
const CSS = readFileSync(
  new URL("../public/website/website.css", import.meta.url),
  "utf8",
);

// Tokens und Schrift (#578): gemeinsam mit der Verwaltung
const TOKENS = readFileSync(
  new URL("../public/website/tokens.css", import.meta.url),
  "utf8",
);

// Die klassischen Skripte im <head>: Darstellung (#550) und Ladezustand der Bilder (#574)
const THEMA_SKRIPT =
  '<script src="/website/theme.js"></script>\n<script src="/website/ladezustand.js"></script>';
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
      html.indexOf("<header"),
    );
    expect(zaehle(html, "<h1")).toBe(1);
    expect(zaehle(html, "<main ")).toBe(1);
    expect(html).toContain('<footer class="fuss">');
    expect(html).toContain('<a href="/datenschutz-website">Datenschutz</a>');
  });

  test("Marke: «Cevi» steht im Logo, nicht zweimal", () => {
    expect(html).toContain(
      '<a class="marke" href="/"><b>CEVI</b><span>Beispielstadt</span></a>',
    );
  });

  test("Menü am Handy ohne Skript: details, und es gibt kein Skript und keinen Inline-Stil", () => {
    expect(html).toContain('<details class="menue-mobil">');
    // Einzige Skripte: das Menü und das Konto-Menü (Verbesserungen) und theme.js, nie inline
    expect(html.replace(THEMA_SKRIPT, "")).not.toMatch(
      /<script(?![^>]* src="\/website\/(?:menue|konto-menue)\.js")|style=|<style/i,
    );
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

  test("Startseite: Text und Schaltflächen bilden das Teaser-Feld über dem Titelbild, mit dem einzigen H1", () => {
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
    expect(html).toContain('<section class="teaser teaser--ueber-bild"');
    expect(html).toContain('<h1 id="h1">Spiel und Natur</h1>');
    expect(zaehle(html, "<h1")).toBe(1);
    // Nur die erste Schaltfläche ist rot
    expect(html).toContain('href="/kontakt" class="btn p gross"');
    expect(html).toContain('href="/termine" class="btn s gross"');
    expect(html).toContain('<h2 id="stufen">Stufen</h2>');
    // Der Teaser steht vor dem übrigen Inhalt
    expect(html.indexOf("teaser")).toBeLessThan(
      html.indexOf('<h2 id="stufen">Stufen'),
    );
  });

  test("Startseite ohne Text und Schaltfläche: gewöhnlicher Seitentitel", () => {
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/",
        dokument: dok("Start", b("ueberschrift", { ebene: 2, text: "A" })),
      },
      kontext(),
    );
    expect(html).not.toContain('class="teaser');
    expect(html).toContain(
      '<div class="seitenband"><div class="wrap"><h1>Start</h1></div></div>',
    );
  });

  test("Stufenseite: Text und Bild vor den Samstagsangaben der Stufen stehen links, die Felder rechts", () => {
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
    expect(html.indexOf("<aside")).toBeLessThan(
      html.indexOf('<h2 id="team">Team'),
    );
    expect(html).toContain(
      '<div class="fakt"><dt>Zeit</dt><dd>14:00 bis 17:00 Uhr</dd></div>',
    );
  });

  test("Mitnehmen (#645): Liste mit maskierten Einträgen, sonst ein Text in Lesegrösse", () => {
    const seiteId = id();
    const mitnehmen = (f: object) =>
      rendereSeite(
        {
          id: seiteId,
          pfad: "/stufen/woelfe",
          dokument: dok("Wölfe", b("stufenfakten", {})),
        },
        kontext({
          ...keineDaten(),
          stufenfakten: new Map([
            [
              seiteId,
              [{ bezeichnung: "Mitnehmen", wert: "w", lang: true, ...f }],
            ],
          ]),
        }),
      );
    const liste = mitnehmen({ liste: ["Kluft", "<b>Hut</b>"] });
    expect(liste).toContain(
      '<div class="fakt fakt--lang"><dt>Mitnehmen</dt><dd><ul class="mitnehmen" role="list"><li>Kluft</li><li>&lt;b&gt;Hut&lt;/b&gt;</li></ul></dd></div>',
    );
    expect(liste).not.toContain("<b>Hut");
    const text = mitnehmen({ wert: "Warme Kleidung & Trinkflasche" });
    expect(text).toContain(
      '<div class="fakt fakt--lang"><dt>Mitnehmen</dt><dd>Warme Kleidung &amp; Trinkflasche</dd></div>',
    );
    expect(text).not.toContain("mitnehmen");
  });

  test("Samstagsangaben der Stufen ohne Text davor: keine zweite Spalte", () => {
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

describe("Fehler- und Wartungsseiten (#567)", () => {
  const mitSeiten = (): Kontext => ({
    ...kontext(),
    navigation: [
      { pfad: "/", titel: "Start", kinder: [] },
      {
        pfad: "/mitmachen",
        titel: "Mitmachen",
        kinder: [
          { pfad: "/mitmachen/gruppen", titel: "Unsere Gruppen", kinder: [] },
        ],
      },
    ],
  });

  test("404: ein H1, die Hauptaktion zur Startseite, Tafeln als Ziele statt des Menüs, noindex", () => {
    const html = rendereFehlerseite(mitSeiten());
    expect(zaehle(html, "<h1")).toBe(1);
    expect(html).toContain("<h1>Falsch abgebogen.</h1>");
    expect(html).toContain("Diese Seite gibt es nicht.");
    expect(html).toContain(
      '<div class="knopfreihe aktionen"><a class="btn p gross" href="/">Zur Startseite</a></div>',
    );
    expect(html).not.toContain("Hauptpunkte");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('href="/website/fehler.css"');
    expect(html).toContain("Fehler 404");
    // Die Ziele: die Seite der Gruppen (auch aus einem Untermenü) und die Termine; ohne E-Mail kein Kontakt
    expect(html).toContain('<nav aria-label="Wohin jetzt?">');
    expect(html).toContain('<div class="wegweiser">');
    expect(html).toContain(
      '<a class="tafel" href="/mitmachen/gruppen"><span class="tafel-ziel">Unsere Gruppen</span>',
    );
    expect(html).toContain('<a class="tafel" href="/termine">');
    expect(zaehle(html, 'class="tafel"')).toBe(2);
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("<img");
  });

  test("404: mit E-Mail der Abteilung eine Tafel «Schreib uns», mit Stimmungsbild ein Bild ohne Alt-Text", () => {
    const k = mitSeiten();
    const id = "00000000-0000-7000-8000-000000000001";
    const daten = {
      ...keineDaten(),
      kontakt: { email: "info@example.org" },
      medien: new Map([
        [
          id,
          {
            mimeTyp: "image/webp",
            groesse: 1,
            breite: 1600,
            hoehe: 900,
            altText: "Gruppe unterwegs",
          },
        ],
      ]),
    };
    const html = rendereFehlerseite(
      { ...k, daten },
      {
        id,
        breite: 1600,
        hoehe: 900,
      },
    );
    expect(html).toContain(
      '<a class="tafel" href="mailto:info@example.org"><span class="tafel-ziel">Schreib uns</span>',
    );
    expect(html).toContain(
      `<img class="irr-bild" src="/api/v1/medien/${id}" alt="" width="1600" height="900" decoding="async">`,
    );
  });

  test("Stimmungsbild: der erste Baustein der Startseite, wenn er ein öffentliches Bild ist", () => {
    const id = "00000000-0000-7000-8000-000000000001";
    const daten = {
      ...keineDaten(),
      medien: new Map([
        [
          id,
          {
            mimeTyp: "image/webp",
            groesse: 1,
            breite: 1,
            hoehe: 1,
            altText: null,
          },
        ],
      ]),
    };
    const bild = (sichtbarkeit: "erbt" | { art: "angemeldet" }) =>
      ({
        titel: "Start",
        bausteine: [
          {
            id: "00000000-0000-7000-8000-00000000000a",
            typ: "bild",
            sichtbarkeit,
            tags: [],
            daten: { mediumId: id },
          },
        ],
      }) as unknown as Parameters<typeof stimmungsbild>[0];
    expect(stimmungsbild(bild("erbt"), daten)).toEqual({
      id,
      breite: 1,
      hoehe: 1,
    });
    expect(stimmungsbild(bild({ art: "angemeldet" }), daten)).toBeUndefined();
    expect(stimmungsbild(bild("erbt"), keineDaten())).toBeUndefined();
    expect(stimmungsbild(undefined, daten)).toBeUndefined();
  });

  test("500: ohne Skript und ohne Bild, «Nochmals versuchen» ist ein Link auf dieselbe Adresse, nur das Logo im Kopf", () => {
    const html = rendereServerfehler(kontext());
    expect(zaehle(html, "<h1")).toBe(1);
    expect(html).toContain("Bei uns ist etwas schiefgegangen");
    expect(html).toContain('href="">');
    expect(html).toContain("Nochmals versuchen");
    expect(html).toContain('<a class="tafel" href="/">');
    expect(html).toContain("Fehler 500");
    expect(html.replace(THEMA_SKRIPT, "")).not.toMatch(/<script/);
    expect(html).not.toContain("/api/");
    expect(html).not.toContain('class="leiste"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  test("Wartung: «Wir sind gleich wieder da.», ein Schild ohne Link, Fehler 503", () => {
    const html = rendereWartung(kontext());
    expect(zaehle(html, "<h1")).toBe(1);
    expect(html).toContain("Wir sind gleich wieder da.");
    expect(html).toContain('<span class="tafel tafel--schild">');
    expect(html).toContain('<div class="wegweiser">');
    expect(html).toContain("Fehler 503");
    expect(html).not.toContain("/api/");
    expect(html).not.toContain('class="leiste"');
  });

  test("Sperrseite: neutral, mit Tag und Nacht, ohne Skript, Inline-Stil und fremde Adresse", () => {
    expect(HINWEIS_STIL).toContain("prefers-color-scheme: dark");
    expect(HINWEISSEITE).toContain("Vorübergehend nicht erreichbar");
    expect(HINWEISSEITE).toContain(
      '<link rel="stylesheet" href="/gesperrt.css">',
    );
    expect(HINWEISSEITE).toContain('<a href="">Nochmals versuchen</a>');
    // Der Weg für Berechtigte (#803): ein einfacher Link, nur dieser Verweis ausser der eigenen Seite
    expect(HINWEISSEITE).toContain(
      '<a class="anmelden" href="/anmelden?weiter=%2Fadmin%23system%2Fplattform">Für Berechtigte: Anmelden</a>',
    );
    expect(
      [...HINWEISSEITE.matchAll(/href="([^"]*)"/g)].map((m) => m[1]),
    ).toEqual([
      "/gesperrt.css",
      "",
      "/anmelden?weiter=%2Fadmin%23system%2Fplattform",
    ]);
    // Neutral: kein Wort zu Anlass, Sperre, Daten oder Panne
    expect(HINWEISSEITE).not.toMatch(
      /sperre|daten|panne|vorfall|sicherheit|angriff/i,
    );
    expect(HINWEISSEITE + HINWEIS_STIL).not.toMatch(
      /<script|<style|style=|https?:\/\//,
    );
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
    // Menü, Konto-Menü, theme.js, ladezustand.js und anmelden.js, alle eigene Dateien
    expect(zaehle(html, "<script")).toBe(5);
    expect(html).toContain('src="/website/anmelden.js"');
  });

  test("«Abteilungsleitung» im Hinweis zum Passwort ist ein Link auf die Seite der Abteilungsleitung, im selben Tab (#882)", () => {
    expect(PFAD_ABTEILUNGSLEITUNG).toBe("/ueber-uns/al");
    expect(html).toContain(
      'Passwort vergessen? Wende dich an die <a href="/ueber-uns/al">Abteilungsleitung</a>.',
    );
  });
});

describe("Stilvorlage", () => {
  test("Tag und Nacht, reduzierte Bewegung, erzwungene Farben", () => {
    expect(CSS).toContain("@media (prefers-color-scheme: dark)");
    expect(CSS).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(CSS).toContain("@media (forced-colors: active)");
    // Beide Werte der Markenfarben als Text: Rot in der Nacht heller (die Tokens stehen in tokens.css, #578)
    expect(TOKENS).toContain("@media (prefers-color-scheme: dark)");
    expect(TOKENS).toMatch(/--primary-text: #d50038/);
    expect(TOKENS).toMatch(/--primary-text: #ff7a93/);
  });

  test("Mitnehmen (#645): Lesegrösse und normale Stärke, höchstens zwei Spalten, Haken gezeichnet ohne Bild", () => {
    const regel = (wahl: string) => {
      const von = CSS.indexOf(`
${wahl} {`);
      return von < 0 ? "" : CSS.slice(von, CSS.indexOf("}", von));
    };
    const lang = regel(".fakten.karte .fakt--lang dd");
    expect(lang).toContain("font-weight: 400");
    expect(lang).toContain("font-size: 1.125rem");
    const liste = regel(".mitnehmen");
    expect(liste).toContain("list-style: none");
    expect(liste).toContain("column-count: 2");
    expect(regel(".mitnehmen li::before")).toContain(
      "border-width: 0 2px 2px 0",
    );
  });

  test("nichts von aussen: keine Adresse, kein @import, keine Daten-URL; url() nur für die eigene Schrift", () => {
    expect(CSS).not.toMatch(/https?:\/\/|@import/);
    expect(TOKENS).not.toMatch(/https?:\/\/|@import/);
    expect([...CSS.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1])).toEqual([]);
    // Die Schrift steht in tokens.css mit relativer Adresse: gilt neben /website/ und neben /admin/
    expect([...TOKENS.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1])).toEqual([
      '"archivo-latin.woff2"',
    ]);
  });

  test("Farben nur als Token ausserhalb der Token-Blöcke", () => {
    const ausserhalb = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /:root[^{]*\{[^}]*\}/g,
      "",
    );
    // Erlaubt: Systemfarben der erzwungenen Farben (CanvasText) und transparent
    expect(ausserhalb).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ausserhalb).not.toMatch(/rgba?\(/);
  });

  test("Bewegung nur unter no-preference: kein animation und kein transition ausserhalb", () => {
    // Jeder Block der obersten Ebene, der nur ohne «Bewegung reduzieren» gilt (auch «screen and …»)
    const ohne = CSS.replace(
      /@media (screen and )?\(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g,
      "",
    );
    // Einzige Ausnahme (#574): bei reduzierter Bewegung hält eine Animation von 0.01 s die Skelette 150 ms zurück; sie bewegt nichts
    const reduziert = [
      ...ohne.matchAll(
        /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/g,
      ),
    ].map((m) => m[0]);
    expect(reduziert.length).toBeGreaterThan(0);
    for (const block of reduziert) {
      for (const z of block.match(/animation:.*/g) ?? []) {
        expect(z).toMatch(/^animation: skelett-(ein|grund) 0\.01s /);
      }
    }
    const rest = reduziert.reduce((t, bl) => t.replace(bl, ""), ohne);
    expect(rest).not.toMatch(/animation:|transition:/);
  });

  test("Bewegung hat eine Kurve und zwei Dauern als Tokens; Einblenden beim Scrollen nur, wo der Browser es kann", () => {
    expect(TOKENS).toMatch(/--kurve: cubic-bezier\(/);
    expect(TOKENS).toMatch(/--dauer: 0\.2s/);
    expect(TOKENS).toMatch(/--dauer-lang: 0\.5s/);
    expect(CSS).toContain("@supports (animation-timeline: view())");
  });
});
