import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  pruefeDokument,
  type Seitendokument,
} from "../src/website/dokument.js";
import {
  esc,
  keineDaten,
  rendereFehlerseite,
  rendereHuelle,
  rendereRobots,
  rendereSeite,
  rendereSitemap,
  type Daten,
  type Kontext,
} from "../src/website/rendern.js";

// Ein Muster, das in jedem Feld auffällt: Ein ungeprüftes «<» würde ein Element «x-boese» öffnen, «"» und «'» Attribute sprengen
const BOESE = `<x-boese a="1" b='2'>&amp;`;
const MASKIERT = "&lt;x-boese a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;amp;";

const id = () => randomUUID();
const b = (typ: string, daten: unknown, extra: object = {}) => ({
  id: id(),
  typ,
  daten,
  ...extra,
});
const dok = (titel: string, ...bausteine: unknown[]): Seitendokument => {
  const p = pruefeDokument({ v: 1, titel, bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const kontext = (daten: Daten = keineDaten(), extra: Partial<Kontext> = {}) =>
  ({
    abteilung: "Cevi Test",
    basisUrl: "https://www.example.org",
    navigation: [],
    daten,
    ...extra,
  }) satisfies Kontext;
const seite = (d: Seitendokument, daten?: Daten, pfad = "/seite") =>
  rendereSeite({ id: id(), pfad, dokument: d }, kontext(daten));

const zaehle = (text: string, teil: string) => text.split(teil).length - 1;

describe("Maskieren", () => {
  test("esc ersetzt alle fünf Zeichen", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("XSS: jede Zeichenkette erscheint maskiert", () => {
  test("in allen Textfeldern der Bausteine und der Daten", () => {
    const bild = id();
    const person = id();
    const tag = id();
    const daten: Daten = {
      ...keineDaten(),
      medien: new Map([
        [
          bild,
          {
            mimeTyp: "image/webp",
            groesse: 5,
            breite: 4,
            hoehe: 3,
            altText: BOESE,
          },
        ],
      ]),
      personen: new Map([[person, { name: BOESE, funktion: BOESE }]]),
      teams: new Map([
        [tag, { name: BOESE, mitglieder: [{ name: BOESE, funktion: BOESE }] }],
      ]),
    };
    const seiteId = id();
    const html = rendereSeite(
      {
        id: seiteId,
        pfad: "/seite",
        dokument: dok(
          // Der Titel darf Sonderzeichen haben, nicht aber Steuerzeichen
          BOESE,
          b("ueberschrift", { ebene: 2, text: BOESE }),
          b("text", {
            inhalt: [
              {
                typ: "absatz",
                inhalt: [
                  { text: BOESE },
                  {
                    text: BOESE,
                    fett: true,
                    kursiv: true,
                    link: "https://example.org/?a=1&b=2",
                  },
                ],
              },
              { typ: "liste", geordnet: true, eintraege: [[{ text: BOESE }]] },
            ],
          }),
          b("bild", { mediumId: bild, unterschrift: BOESE }),
          b("galerie", { bilder: [{ mediumId: bild, unterschrift: BOESE }] }),
          b("karten", {
            darstellung: "karten",
            eintraege: [
              { titel: BOESE, text: BOESE, link: "https://example.org/" },
            ],
          }),
          b("schaltflaeche", {
            darstellung: "schaltflaeche",
            beschriftung: BOESE,
            ziel: "https://example.org/",
          }),
          b("datei", {
            titel: BOESE,
            link: "https://cevi.sharepoint.com/x?a=1&b=2",
            typ: "<b>&",
          }),
          b("kontaktperson", { personId: person }),
          b("leitungsteam", { tagId: tag }),
          b("videolink", {
            art: "video",
            beschriftung: BOESE,
            url: "https://example.org/v",
          }),
        ),
      },
      {
        ...kontext(daten),
        abteilung: BOESE,
        navigation: [{ pfad: "/seite", titel: BOESE, kinder: [] }],
      },
    );
    expect(html).not.toContain("<x-boese");
    expect(html).not.toMatch(/\son\w+=/);
    // Titel (h1) und Titel-Tag, Abteilung (Kopf und Titel), Navigation, Überschrift, zwei Textabschnitte, Liste, zwei Unterschriften,
    // Alt-Text (Bild, Galerie), Karte (Titel, Text), Schaltfläche, Datei (Titel), Person (Name, Funktion), Team (Name, Funktion), Video
    expect(zaehle(html, MASKIERT)).toBeGreaterThanOrEqual(22);
    // Die Adresse mit «&» und «<» erscheint nur maskiert im Attribut
    expect(html).toContain('href="https://example.org/?a=1&amp;b=2"');
    expect(html).toContain('href="https://cevi.sharepoint.com/x?a=1&amp;b=2"');
    expect(html).toContain("(&lt;b&gt;&amp;)");
    void seiteId;
  });

  test("Stufenfakten (Bezeichnung und Wert)", () => {
    const sid = id();
    const daten: Daten = {
      ...keineDaten(),
      stufenfakten: new Map([[sid, [{ bezeichnung: BOESE, wert: BOESE }]]]),
    };
    const html = rendereSeite(
      { id: sid, pfad: "/s", dokument: dok("Titel", b("stufenfakten", {})) },
      kontext(daten),
    );
    expect(html).not.toContain("<x-boese");
    expect(zaehle(html, MASKIERT)).toBe(2);
  });

  test("ein Link ohne erlaubte Art wird nie zum Link", () => {
    // Am Schema vorbei, wie ein beschädigter Datensatz es täte
    const roh = {
      v: 1,
      titel: "T",
      bausteine: [
        {
          id: id(),
          typ: "text",
          sichtbarkeit: "erbt",
          daten: {
            inhalt: [
              {
                typ: "absatz",
                inhalt: [
                  { text: "a", link: "javascript:alert(1)" },
                  { text: "b", link: "data:text/html,x" },
                  { text: "c", link: "//example.org" },
                  { text: "d", link: 'https://example.org/"onmouseover="x' },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as Seitendokument;
    const html = rendereSeite(
      { id: id(), pfad: "/s", dokument: roh },
      kontext(),
    );
    expect(html).not.toContain('<a href="javascript');
    expect(html).not.toContain("data:text");
    expect(html).not.toContain("//example.org");
    expect(html).not.toContain("onmouseover");
    expect(html).toContain("<p>abcd</p>");
  });

  test("Seitenlinks und fremde https-Links: nur fremde bekommen rel", () => {
    const html = seite(
      dok(
        "T",
        b("schaltflaeche", {
          darstellung: "link",
          beschriftung: "Intern",
          ziel: "/stufen/woelfe#info",
        }),
        b("schaltflaeche", {
          darstellung: "link",
          beschriftung: "Extern",
          ziel: "https://example.org/x",
        }),
        b("schaltflaeche", {
          darstellung: "link",
          beschriftung: "Mail",
          ziel: "mailto:a@example.org",
        }),
      ),
    );
    expect(html).toContain(
      '<a href="/stufen/woelfe#info" class="verweis">Intern</a>',
    );
    expect(html).toContain(
      '<a href="https://example.org/x" rel="noopener noreferrer" class="verweis">Extern<span class="nur-sr"> (externe Seite)</span></a>',
    );
    // Nur der fremde Link trägt den Zusatz für Screenreader
    expect(zaehle(html, "(externe Seite)")).toBe(1);
    expect(html).toContain(
      '<a href="mailto:a@example.org" class="verweis">Mail</a>',
    );
  });
});

describe("Geschützte Bausteine", () => {
  const GEHEIM = "GEHEIMER-MARKER-TEXT";
  const medium = id();
  const person = id();
  const daten: Daten = {
    ...keineDaten(),
    medien: new Map([
      [
        medium,
        {
          mimeTyp: "image/webp",
          groesse: 5,
          breite: 4,
          hoehe: 3,
          altText: GEHEIM,
        },
      ],
    ]),
    personen: new Map([[person, { name: GEHEIM, funktion: GEHEIM }]]),
  };
  const engere = [{ art: "angemeldet" }, { art: "tags", tagIds: [id()] }];

  test.each(engere)(
    "Sichtbarkeit %j: nur ein leerer Platzhalter",
    (sichtbarkeit) => {
      const bausteine = [
        b("ueberschrift", { ebene: 2, text: GEHEIM }, { sichtbarkeit }),
        b(
          "text",
          { inhalt: [{ typ: "absatz", inhalt: [{ text: GEHEIM }] }] },
          { sichtbarkeit },
        ),
        b("bild", { mediumId: medium, unterschrift: GEHEIM }, { sichtbarkeit }),
        b("kontaktperson", { personId: person }, { sichtbarkeit }),
        b(
          "karten",
          { darstellung: "liste", eintraege: [{ titel: GEHEIM }] },
          { sichtbarkeit },
        ),
      ];
      const d = dok("Offen", ...bausteine);
      const html = seite(d, daten);
      expect(html).not.toContain(GEHEIM);
      expect(html).not.toContain(medium);
      expect(html).not.toContain(person);
      for (const baustein of d.bausteine) {
        // Nur die ID und der Hinweis mit dem Link zur Anmeldung, nie Typ oder Inhalt
        expect(html).toContain(
          `<div data-geschuetzt="${baustein.id}"><div class="schutzblock">`,
        );
      }
      expect(zaehle(html, 'href="/anmelden?weiter=%2Fseite"')).toBe(5);
      for (const baustein of d.bausteine) {
        expect(html).toContain(baustein.id);
      }
      expect(zaehle(html, "data-geschuetzt")).toBe(5);
    },
  );

  test("«oeffentlich» am Baustein und «erbt» erscheinen", () => {
    const html = seite(
      dok(
        "T",
        b(
          "text",
          { inhalt: [{ typ: "absatz", inhalt: [{ text: "sichtbar-1" }] }] },
          { sichtbarkeit: { art: "oeffentlich" } },
        ),
        b("text", {
          inhalt: [{ typ: "absatz", inhalt: [{ text: "sichtbar-2" }] }],
        }),
      ),
    );
    expect(html).toContain("sichtbar-1");
    expect(html).toContain("sichtbar-2");
    expect(html).not.toContain("data-geschuetzt");
  });
});

describe("Aufbau und Barrierefreiheit", () => {
  test("genau ein H1, Sprache, Sprunglink, main, Navigation mit aktueller Seite", () => {
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/stufen",
        dokument: dok("Stufen", b("ueberschrift", { ebene: 2, text: "A" })),
      },
      kontext(keineDaten(), {
        navigation: [
          {
            pfad: "/stufen",
            titel: "Stufen",
            kinder: [{ pfad: "/stufen/biber", titel: "Biber", kinder: [] }],
          },
        ],
      }),
    );
    expect(zaehle(html, "<h1>")).toBe(1);
    expect(html).toContain('<html lang="de-CH">');
    expect(html).toContain(
      '<a class="sprunglink" href="#inhalt">Zum Inhalt</a>',
    );
    expect(html).toContain('<main id="inhalt" tabindex="-1">');
    expect(html).toContain(
      '<nav class="hauptnav" aria-label="Hauptnavigation">',
    );
    expect(html).toContain('<a href="/stufen" aria-current="page">Stufen</a>');
    // Die Unterseiten stehen in der Unterleiste und im Menü am Handy
    expect(html).toContain(
      '<nav class="unterleiste" aria-label="Unterseiten von Stufen">',
    );
    // Dazu das Untermenü bei «Stufen» in der Leiste
    expect(zaehle(html, '<a href="/stufen/biber">Biber</a>')).toBe(3);
    expect(html).toContain('<details class="menue-mobil">');
    expect(html).toContain('<a class="anmelden" href="/anmelden">');
    expect(html).toContain(
      '<link rel="canonical" href="https://www.example.org/stufen">',
    );
  });

  test("kein Skript ausser theme.js, keine fremde Quelle, Meta-CSP", () => {
    const html = seite(dok("T", b("trenner", { art: "linie" })));
    // Das einzige Skript jeder Seite ist die eigene Datei für Hell und Dunkel (#550), nie inline
    expect(html).toContain('<script src="/website/theme.js"></script>');
    expect(
      html.replace('<script src="/website/theme.js"></script>', ""),
    ).not.toMatch(/<script|<iframe|<object|<embed|style=/i);
    expect(html).toContain("script-src &#39;self&#39;");
    expect(html).not.toContain("connect-src");
    expect(html).not.toMatch(
      /(?:src|href)="(?:https?:)?\/\/(?!www\.example\.org)/,
    );
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src &#39;none&#39;");
  });

  test("Überschriften springen höchstens eine Ebene tiefer", () => {
    const html = seite(
      dok(
        "T",
        b("ueberschrift", { ebene: 4, text: "a" }),
        b("ueberschrift", { ebene: 4, text: "b" }),
        b("ueberschrift", { ebene: 2, text: "c" }),
        b("ueberschrift", { ebene: 4, text: "d" }),
      ),
    );
    // h4 nach h1 wird h2; danach h4 nach h2 wird h3; h2 bleibt; h4 nach h2 wird h3
    expect(
      [...html.matchAll(/<h([234])(?: id="\w+")?>(\w)</g)].map(
        (m) => `${m[2]}${m[1]}`,
      ),
    ).toEqual(["a2", "b3", "c2", "d3"]);
  });

  test("jedes Bild hat ein alt-Attribut: dekorativ leer, sonst der Text; ohne öffentliches Medium entfällt es", () => {
    const mit = id();
    const deko = id();
    const fehlt = id();
    const daten: Daten = {
      ...keineDaten(),
      medien: new Map([
        [
          mit,
          {
            mimeTyp: "image/webp",
            groesse: 5,
            breite: 40,
            hoehe: 30,
            altText: "Zwei Kinder am Feuer",
          },
        ],
        [
          deko,
          {
            mimeTyp: "image/png",
            groesse: 5,
            breite: null,
            hoehe: null,
            altText: null,
          },
        ],
      ]),
    };
    const html = seite(
      dok(
        "T",
        // Ein erstes Bild wäre das Titelbild; die Bilder stehen darum nach einem Text
        b("text", { inhalt: [{ typ: "absatz", inhalt: [{ text: "Hallo" }] }] }),
        b("bild", { mediumId: mit }),
        b("bild", { mediumId: deko }),
        b("bild", { mediumId: fehlt }),
        b("galerie", { bilder: [{ mediumId: fehlt }] }),
      ),
      daten,
    );
    expect(html).toContain(
      `<img src="/api/v1/medien/${mit}" alt="Zwei Kinder am Feuer" width="40" height="30" decoding="async">`,
    );
    expect(html).toContain(
      `<img src="/api/v1/medien/${deko}" alt="" decoding="async">`,
    );
    expect(zaehle(html, "<img")).toBe(2);
    expect(zaehle(html, "<img") - zaehle(html, " alt=")).toBe(0);
    expect(html).not.toContain("galerie");
  });

  test("ein altes PDF-Medium als Bild erscheint nicht", () => {
    const pdf = id();
    const daten: Daten = {
      ...keineDaten(),
      medien: new Map([
        [
          pdf,
          {
            mimeTyp: "application/pdf",
            groesse: 3 * 1024 * 1024,
            breite: null,
            hoehe: null,
            altText: null,
          },
        ],
      ]),
    };
    const html = seite(dok("T", b("bild", { mediumId: pdf })), daten);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/v1/medien/");
  });

  test("eine Datei ist ein Link auf den Ablageort, mit Typ und Grösse, nie eingebettet (#428)", () => {
    const link = "https://cevi.sharepoint.com/sites/lager/Anmeldung.pdf";
    const html = seite(
      dok(
        "T",
        b("datei", {
          titel: "Anmeldung",
          link,
          typ: "PDF",
          groesse: 3 * 1024 * 1024,
        }),
        b("datei", { titel: "Nur Link", link }),
        b("datei", { titel: "Mit Typ", link, typ: "Excel" }),
        b("datei", { titel: "Mit Grösse", link, groesse: 1 }),
      ),
    );
    expect(html).toContain(
      `<p class="datei karte"><a href="${link}" rel="noopener noreferrer">Anmeldung<span class="nur-sr"> (externe Seite)</span></a> <span class="info">(PDF, 3.0 MB)</span></p>`,
    );
    expect(html).toContain(
      `<p class="datei karte"><a href="${link}" rel="noopener noreferrer">Nur Link<span class="nur-sr"> (externe Seite)</span></a></p>`,
    );
    expect(html).toContain(
      `>Mit Typ<span class="nur-sr"> (externe Seite)</span></a> <span class="info">(Excel)</span>`,
    );
    expect(html).toContain(
      `>Mit Grösse<span class="nur-sr"> (externe Seite)</span></a> <span class="info">(1 KB)</span>`,
    );
    // Nie das Medien-Muster, nie ein Download-Attribut, nie eingebettet
    expect(html).not.toContain("/api/v1/medien/");
    expect(html).not.toMatch(/\sdownload[\s>]/);
    expect(html).not.toMatch(/<(iframe|embed|object)/);
  });

  test("eine Datei mit unzulässigem Link wird nie zum Link, auch am Schema vorbei", () => {
    const roh = (link: string) =>
      ({
        v: 1,
        titel: "T",
        bausteine: [
          {
            id: id(),
            typ: "datei",
            sichtbarkeit: "erbt",
            daten: { titel: "Böse", link },
          },
        ],
      }) as unknown as Seitendokument;
    for (const link of [
      "javascript:alert(1)",
      "data:text/html,x",
      "http://cevi.sharepoint.com/x",
      "//cevi.sharepoint.com/x",
      "https://u:p@cevi.sharepoint.com/x",
      "/stufen/woelfe",
    ]) {
      const html = rendereSeite(
        { id: id(), pfad: "/s", dokument: roh(link) },
        kontext(),
      );
      expect(html, link).not.toContain("Böse");
      expect(html, link).not.toContain("onmouseover");
    }
    // Ein Anführungszeichen in der Adresse bricht das Attribut nie auf: Die URL-Norm kodiert es
    const html = rendereSeite(
      {
        id: id(),
        pfad: "/s",
        dokument: roh('https://cevi.sharepoint.com/"onmouseover="x'),
      },
      kontext(),
    );
    expect(html).toContain(
      'href="https://cevi.sharepoint.com/%22onmouseover=%22x"',
    );
    expect(html).not.toContain('"onmouseover');
  });

  test("Kontaktperson und Leitungsteam zeigen nur Name und Funktion", () => {
    const person = id();
    const tag = id();
    const daten: Daten = {
      ...keineDaten(),
      personen: new Map([
        [person, { name: "Wolke", funktion: "Stufenleitung" }],
      ]),
      teams: new Map([
        [
          tag,
          { name: "Team", mitglieder: [{ name: "Funke", funktion: null }] },
        ],
      ]),
    };
    const html = seite(
      dok(
        "T",
        // «zusatz» verlangt Telefon, E-Mail und Foto; sie erscheinen nie (Entscheid bis zur Einwilligungsfrage)
        b("kontaktperson", {
          personId: person,
          zusatz: ["telefon", "email", "foto"],
        }),
        b("leitungsteam", { tagId: tag, zusatz: ["telefon", "email", "foto"] }),
      ),
      daten,
    );
    expect(html).toContain(
      '<li class="person"><span class="ava" aria-hidden="true">W</span><div><span class="name">Wolke</span><span class="funktion">Stufenleitung</span></div></li>',
    );
    expect(html).toContain(
      '<li class="person"><span class="ava" aria-hidden="true">F</span><div><span class="name">Funke</span></div></li>',
    );
    expect(html).not.toMatch(/tel:|mailto:|<img/);
  });

  test("Terminliste und Stufenfakten ohne Daten ergeben nichts", () => {
    const html = seite(
      dok("T", b("terminliste", { anzahl: 3 }), b("stufenfakten", {})),
    );
    expect(html).toContain(
      '<div class="seitenband"><div class="wrap"><h1>T</h1></div></div>',
    );
    expect(html).not.toContain("sektion");
  });
});

describe("Fehlerseite, Sitemap, robots.txt", () => {
  test("404 mit H1, noindex und ohne canonical", () => {
    const html = rendereFehlerseite(kontext());
    expect(zaehle(html, "<h1>")).toBe(1);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain("canonical");
  });

  test("Sitemap nennt genau die übergebenen Seiten", () => {
    const xml = rendereSitemap("https://www.example.org", [
      { pfad: "/", geaendert: new Date("2027-01-02T10:00:00Z") },
      { pfad: "/a/b", geaendert: new Date("2027-03-04T10:00:00Z") },
    ]);
    expect(xml).toContain(
      "<loc>https://www.example.org/</loc><lastmod>2027-01-02</lastmod>",
    );
    expect(xml).toContain(
      "<loc>https://www.example.org/a/b</loc><lastmod>2027-03-04</lastmod>",
    );
    expect(zaehle(xml, "<url>")).toBe(2);
    expect(rendereSitemap("https://www.example.org", [])).not.toContain(
      "<url>",
    );
  });

  test("robots.txt sperrt nur API und Verwaltung", () => {
    expect(rendereRobots("https://www.example.org")).toBe(
      "User-agent: *\nDisallow: /api/\nDisallow: /admin\nSitemap: https://www.example.org/sitemap.xml\n",
    );
  });
});

describe("Logo, Umschalter und Karussell (#550)", () => {
  const medien = (n: number) => {
    const ids = Array.from({ length: n }, () => id());
    const daten: Daten = {
      ...keineDaten(),
      medien: new Map(
        ids.map((m, i) => [
          m,
          {
            mimeTyp: "image/webp",
            groesse: 5,
            breite: 16,
            hoehe: 9,
            altText: `Bild ${i + 1}`,
          },
        ]),
      ),
    };
    return { ids, daten };
  };

  test("ohne Logo steht die Wortmarke, mit Logo das Bild mit Alt-Text und der Name", () => {
    const d = dok("T", b("trenner", { art: "linie" }));
    const ohne = rendereSeite({ id: id(), pfad: "/x", dokument: d }, kontext());
    expect(ohne).toContain('<a class="marke" href="/"><b>CEVI</b>');
    const logo = id();
    const mit = rendereSeite(
      { id: id(), pfad: "/x", dokument: d },
      kontext(keineDaten(), {
        logo: { id: logo, altText: "Cevi", breite: 715, hoehe: 178 },
      }),
    );
    expect(mit).toContain(
      `<a class="marke marke--logo" href="/"><img class="logo" src="/api/v1/medien/${logo}" alt="Cevi" width="715" height="178"><span class="nur-sr">Test</span></a>`,
    );
    expect(mit).not.toContain("<b>CEVI</b>");
  });

  test("Umschalter: zwei Knöpfe nur mit Symbol, Name im aria-label, aria-pressed, ohne Skript verborgen", () => {
    const html = seite(dok("T", b("trenner", { art: "linie" })));
    expect(html).toMatch(
      /<div class="thema" role="group" aria-label="Darstellung" hidden>/,
    );
    expect(html).toContain(
      '<button type="button" data-thema="light" aria-pressed="false" aria-label="Hell"><svg',
    );
    expect(html).toContain(
      '<button type="button" data-thema="dark" aria-pressed="false" aria-label="Dunkel"><svg',
    );
    // Keine Option «System» und keine sichtbare Beschriftung
    expect(html).not.toContain('data-thema="system"');
    expect(html).not.toContain("<span>Hell</span>");
  });

  test("Fehler- und Anmeldeseiten tragen das Theme-Skript und den Umschalter", () => {
    const html = rendereFehlerseite(kontext());
    expect(html).toContain('<script src="/website/theme.js"></script>');
    expect(html).toContain('class="thema"');
  });

  test("Karussell (#559): Bildstreifen mit Gruppe, Alt-Texten, eigenem Stil und Skript", () => {
    const { ids, daten } = medien(3);
    const html = seite(
      dok("T", b("karussell", { bilder: ids.map((m) => ({ mediumId: m })) })),
      daten,
    );
    expect(html).toContain(
      '<div class="karussell" role="group" aria-roledescription="Karussell" aria-label="Bilder">',
    );
    // Der Streifen scrollt seitwärts und ist mit der Tastatur erreichbar
    expect(html).toContain('<ul class="folien" tabindex="0">');
    expect(zaehle(html, '<li class="folie">')).toBe(3);
    expect(html).toContain('alt="Bild 2"');
    // Platz für die Leiste des Skripts; ohne Skript steht dort die Anzahl
    expect(html).toContain('<p class="k-stand">3 Bilder</p>');
    expect(html).toContain(
      '<link rel="stylesheet" href="/website/karussell.css">',
    );
    expect(html).toContain(
      '<script src="/website/karussell.js" defer></script>',
    );
    // Kein Inline-Skript, nur die zwei eigenen Dateien; keine Knöpfe ohne Skript
    expect(zaehle(html, "<script")).toBe(2);
    expect(html).not.toContain('class="k-knoepfe"');
  });

  test("Karussell (#559): unter jedem Bild die Bildunterschrift, sonst der Alt-Text (für Screenreader nur einmal)", () => {
    const { ids, daten } = medien(3);
    const html = seite(
      dok(
        "T",
        b("karussell", {
          bilder: ids.map((m, i) => ({
            mediumId: m,
            ...(i === 0 && { unterschrift: "Im <Wald>" }),
          })),
        }),
      ),
      daten,
    );
    expect(html).toContain("<figcaption>Im &lt;Wald&gt;</figcaption>");
    expect(html).toContain(
      '<figcaption aria-hidden="true">Bild 2</figcaption>',
    );
    expect(zaehle(html, "<figcaption")).toBe(3);
  });

  test("Seiten ohne Karussell laden weder seinen Stil noch sein Skript; die Hülle lädt beides immer", () => {
    const ohne = seite(dok("T", b("trenner", { art: "linie" })));
    expect(ohne).not.toContain("karussell");
    const huelle = rendereHuelle("/x", kontext());
    expect(huelle).toContain('href="/website/karussell.css"');
    expect(huelle).toContain('src="/website/karussell.js" defer');
  });

  test("Karussell: ein Bild bleibt ein Bild, ohne Bild entfällt der Baustein", () => {
    const { ids, daten } = medien(3);
    const nurEines: Daten = {
      ...daten,
      medien: new Map([[ids[0]!, daten.medien.get(ids[0]!)!]]),
    };
    const bausteine = b("karussell", {
      bilder: ids.map((m) => ({ mediumId: m })),
    });
    const eines = seite(dok("T", bausteine), nurEines);
    expect(eines).toContain("<figure>");
    expect(eines).not.toContain('class="karussell"');
    expect(eines).not.toContain("karussell.");
    const keines = seite(dok("T", bausteine), keineDaten());
    expect(keines).not.toContain("<figure>");
    expect(keines).not.toContain("karussell.");
  });

  test("Karussell nur für Angemeldete: Platzhalter, kein Bild; Stil und Skript stehen bereit für das Nachladen", () => {
    const { ids, daten } = medien(3);
    const html = seite(
      dok(
        "T",
        b(
          "karussell",
          { bilder: ids.map((m) => ({ mediumId: m })) },
          { sichtbarkeit: { art: "angemeldet" } },
        ),
      ),
      daten,
    );
    expect(html).toContain("Nur angemeldet sichtbar");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="karussell"');
    expect(html).toContain('href="/website/karussell.css"');
    expect(html).toContain('src="/website/karussell.js" defer');
  });
});
