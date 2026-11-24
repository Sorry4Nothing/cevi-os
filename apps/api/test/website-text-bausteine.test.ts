import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import {
  MAX_ANTWORT_ZEICHEN,
  MAX_CHECKLISTE,
  MAX_FRAGEN,
  MAX_HINWEISBOX_ZEICHEN,
  MAX_SCHRITTE,
  MAX_TABELLE_SPALTEN,
  MAX_TABELLE_ZEILEN,
  MAX_ZELLE,
  MAX_ZITAT,
} from "../src/website/bausteine-text.js";
import { pruefeDokument, sammleVerweise } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereGeschuetzte,
  rendereSeite,
  type Daten,
  type HtmlKnoten,
  type Kontext,
} from "../src/website/rendern.js";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import { baueKnoten } from "../public/website/knoten.js";

// Bausteine «Text und Gestaltung» (#741): Schema mit Grenzen, Verweise, Renderer mit Maskierung, Zusammenspiel mit dem Skript für geschützte Bausteine

const id = () => randomUUID();
const b = (typ: string, daten: unknown, extra: object = {}) => ({
  id: id(),
  typ,
  daten,
  sichtbarkeit: "erbt",
  ...extra,
});
const absatz = (text: string, extra: object = {}) => ({
  typ: "absatz",
  inhalt: [{ text, ...extra }],
});
const dok = (...bausteine: unknown[]) => ({ v: 1, titel: "Seite", bausteine });
const fehler = (...bausteine: unknown[]) => {
  const p = pruefeDokument(dok(...bausteine));
  return p.ok ? null : p.fehler;
};
const gueltig = (...bausteine: unknown[]) => {
  const p = pruefeDokument(dok(...bausteine));
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};

const BEISPIELE = {
  hinweisbox: { art: "tipp", titel: "Schuhe", inhalt: [absatz("Wetterfest")] },
  zitat: {
    text: "Das war ein guter Tag.",
    person: "Mika",
    funktion: "Leitung",
    bild: id(),
  },
  fragen: {
    eintraege: [{ frage: "Wann?", antwort: [absatz("Am Samstag.")] }],
  },
  spalten: {
    links: { titel: "Links", inhalt: [absatz("a")] },
    rechts: { inhalt: [absatz("b")] },
  },
  bildneben: {
    mediumId: id(),
    seite: "rechts",
    titel: "Draussen",
    inhalt: [absatz("Text")],
    link: { beschriftung: "Mehr", ziel: "/ueber-uns" },
  },
  tabelle: {
    beschriftung: "Preise",
    kopf: ["Angebot", "Preis"],
    zeilen: [["Tag", "CHF 25.–"]],
    zeilenkopf: true,
  },
  schritte: {
    eintraege: [
      { titel: "Eins", text: "Text", beschriftung: "Hier", ziel: "/anmelden" },
      { titel: "Zwei" },
    ],
  },
  checkliste: {
    darstellung: "kaestchen",
    eintraege: [{ text: "Schlafsack" }],
  },
} as const;

describe("Schema der Bausteine «Text und Gestaltung»", () => {
  test.each(Object.entries(BEISPIELE))(
    "%s: ein gültiges Beispiel wird angenommen, ein unbekanntes Feld nicht",
    (typ, daten) => {
      expect(fehler(b(typ, daten))).toBeNull();
      expect(fehler(b(typ, { ...daten, extra: 1 }))).not.toBeNull();
    },
  );

  test("bestehende Dokumente bleiben gültig: die Version bleibt 1, ein Dokument ohne die neuen Typen ändert sich nicht", () => {
    const altes = dok(
      b("text", { inhalt: [absatz("Hallo")] }),
      b("trenner", { art: "linie" }),
    );
    const p = pruefeDokument(altes);
    expect(p.ok).toBe(true);
    expect(p.ok && p.dokument.v).toBe(1);
  });

  test("Sichtbarkeit und ID gelten auch hier", () => {
    const d = gueltig(b("zitat", { text: "x" }));
    expect(d.bausteine[0]?.sichtbarkeit).toBe("erbt");
    expect(
      fehler({ ...b("zitat", { text: "x" }), id: "keine-id" }),
    ).not.toBeNull();
  });

  describe("Hinweisbox", () => {
    test("Art aus der Liste, Text nötig und begrenzt", () => {
      for (const art of ["info", "tipp", "wichtig", "achtung"]) {
        expect(
          fehler(b("hinweisbox", { art, inhalt: [absatz("x")] })),
        ).toBeNull();
      }
      expect(
        fehler(b("hinweisbox", { art: "rot", inhalt: [absatz("x")] })),
      ).not.toBeNull();
      expect(
        fehler(b("hinweisbox", { art: "info", inhalt: [] })),
      ).not.toBeNull();
      expect(
        fehler(
          b("hinweisbox", {
            art: "info",
            inhalt: [absatz("x".repeat(MAX_HINWEISBOX_ZEICHEN + 1))],
          }),
        ),
      ).not.toBeNull();
      expect(
        fehler(
          b("hinweisbox", {
            art: "info",
            inhalt: Array.from({ length: 13 }, () => absatz("x")),
          }),
        ),
      ).not.toBeNull();
    });

    test("Links im Text nur als Seite, https, mailto oder tel", () => {
      const mit = (link: string) =>
        b("hinweisbox", {
          art: "info",
          inhalt: [absatz("Hier", { link })],
        });
      expect(fehler(mit("https://www.example.org/x"))).toBeNull();
      expect(fehler(mit("/anmelden"))).toBeNull();
      for (const schlecht of [
        "javascript:alert(1)",
        "data:text/html,x",
        "//example.org",
        "http://example.org",
      ]) {
        expect(fehler(mit(schlecht)), schlecht).not.toBeNull();
      }
    });
  });

  describe("Zitat", () => {
    test("Text nötig und begrenzt, Bild eine ID, keine Steuerzeichen", () => {
      expect(fehler(b("zitat", { text: "" }))).not.toBeNull();
      expect(
        fehler(b("zitat", { text: "x".repeat(MAX_ZITAT + 1) })),
      ).not.toBeNull();
      expect(fehler(b("zitat", { text: "x".repeat(MAX_ZITAT) }))).toBeNull();
      expect(
        fehler(b("zitat", { text: "x", bild: "kein-uuid" })),
      ).not.toBeNull();
      expect(fehler(b("zitat", { text: "a\u0000b" }))).not.toBeNull();
      expect(fehler(b("zitat", { text: "x", person: "" }))).not.toBeNull();
    });
  });

  describe("Fragen und Antworten", () => {
    const frage = (antwort: unknown) => ({ frage: "F", antwort });
    test("mindestens eine, höchstens MAX_FRAGEN, Antwort nötig und begrenzt", () => {
      expect(fehler(b("fragen", { eintraege: [] }))).not.toBeNull();
      expect(
        fehler(
          b("fragen", {
            eintraege: Array.from({ length: MAX_FRAGEN }, () =>
              frage([absatz("a")]),
            ),
          }),
        ),
      ).toBeNull();
      expect(
        fehler(
          b("fragen", {
            eintraege: Array.from({ length: MAX_FRAGEN + 1 }, () =>
              frage([absatz("a")]),
            ),
          }),
        ),
      ).not.toBeNull();
      expect(fehler(b("fragen", { eintraege: [frage([])] }))).not.toBeNull();
      expect(
        fehler(
          b("fragen", {
            eintraege: [frage([absatz("x".repeat(MAX_ANTWORT_ZEICHEN + 1))])],
          }),
        ),
      ).not.toBeNull();
      expect(
        fehler(
          b("fragen", { eintraege: [{ frage: "", antwort: [absatz("a")] }] }),
        ),
      ).not.toBeNull();
    });
  });

  describe("Zwei Spalten", () => {
    test("beide Spalten brauchen einen Text", () => {
      expect(
        fehler(b("spalten", { links: { inhalt: [absatz("a")] } })),
      ).not.toBeNull();
      expect(
        fehler(
          b("spalten", {
            links: { inhalt: [absatz("a")] },
            rechts: { inhalt: [] },
          }),
        ),
      ).not.toBeNull();
    });
  });

  describe("Bild neben Text", () => {
    test("Bild nötig, Seite aus der Liste, Link nur mit beiden Angaben und erlaubtem Ziel", () => {
      const ok = BEISPIELE.bildneben;
      expect(
        fehler(b("bildneben", { ...ok, mediumId: undefined })),
      ).not.toBeNull();
      expect(fehler(b("bildneben", { ...ok, seite: "oben" }))).not.toBeNull();
      expect(
        fehler(b("bildneben", { ...ok, link: { beschriftung: "Mehr" } })),
      ).not.toBeNull();
      expect(
        fehler(
          b("bildneben", {
            ...ok,
            link: { beschriftung: "Mehr", ziel: "javascript:alert(1)" },
          }),
        ),
      ).not.toBeNull();
      expect(fehler(b("bildneben", { ...ok, link: undefined }))).toBeNull();
    });
  });

  describe("Tabelle", () => {
    const tabelle = (daten: object) =>
      b("tabelle", { ...BEISPIELE.tabelle, ...daten });
    test("zwei bis sechs Spalten, eine bis vierzig Zeilen", () => {
      expect(fehler(tabelle({ kopf: ["A"], zeilen: [["1"]] }))).not.toBeNull();
      const sieben = Array.from({ length: MAX_TABELLE_SPALTEN + 1 }, () => "x");
      expect(
        fehler(tabelle({ kopf: sieben, zeilen: [sieben] })),
      ).not.toBeNull();
      const sechs = sieben.slice(1);
      expect(fehler(tabelle({ kopf: sechs, zeilen: [sechs] }))).toBeNull();
      expect(fehler(tabelle({ zeilen: [] }))).not.toBeNull();
      const viele = Array.from({ length: MAX_TABELLE_ZEILEN + 1 }, () => [
        "a",
        "b",
      ]);
      expect(fehler(tabelle({ zeilen: viele }))).not.toBeNull();
      expect(fehler(tabelle({ zeilen: viele.slice(1) }))).toBeNull();
    });

    test("jede Zeile hat so viele Zellen wie die Kopfzeile", () => {
      const f = fehler(
        tabelle({
          zeilen: [
            ["a", "b"],
            ["a", "b", "c"],
          ],
        }),
      );
      expect(f).toEqual([
        { pfad: "bausteine.0.daten.zeilen.1", code: "custom" },
      ]);
      expect(
        fehler(tabelle({ kopf: ["A", "B", "C"], zeilen: [["a", "b"]] })),
      ).not.toBeNull();
      expect(fehler(tabelle({ zeilen: [["nur eine"]] }))).not.toBeNull();
    });

    test("leere Zellen sind erlaubt, lange und Steuerzeichen nicht; die Kopfzelle braucht Text", () => {
      expect(fehler(tabelle({ zeilen: [["", ""]] }))).toBeNull();
      expect(
        fehler(tabelle({ zeilen: [["x".repeat(MAX_ZELLE + 1), "b"]] })),
      ).not.toBeNull();
      expect(fehler(tabelle({ zeilen: [["a\u0007", "b"]] }))).not.toBeNull();
      expect(fehler(tabelle({ kopf: ["", "B"] }))).not.toBeNull();
    });

    test("zeilenkopf ist ein Wahrheitswert und gilt ohne Angabe als falsch", () => {
      expect(fehler(tabelle({ zeilenkopf: "ja" }))).not.toBeNull();
      const d = gueltig(
        b("tabelle", { kopf: ["A", "B"], zeilen: [["1", "2"]] }),
      ).bausteine[0]!;
      expect(d.typ === "tabelle" && d.daten.zeilenkopf).toBe(false);
    });
  });

  describe("Schritte", () => {
    test("Beschriftung und Ziel gehören zusammen, das Ziel ist ein erlaubter Link, höchstens MAX_SCHRITTE", () => {
      const mit = (e: object) =>
        b("schritte", { eintraege: [{ titel: "T", ...e }] });
      expect(fehler(mit({ ziel: "/anmelden" }))).not.toBeNull();
      expect(fehler(mit({ beschriftung: "Hier" }))).not.toBeNull();
      expect(
        fehler(mit({ beschriftung: "Hier", ziel: "javascript:alert(1)" })),
      ).not.toBeNull();
      expect(
        fehler(mit({ beschriftung: "Hier", ziel: "https://www.example.org/" })),
      ).toBeNull();
      const viele = (n: number) =>
        b("schritte", {
          eintraege: Array.from({ length: n }, () => ({ titel: "T" })),
        });
      expect(fehler(viele(MAX_SCHRITTE))).toBeNull();
      expect(fehler(viele(MAX_SCHRITTE + 1))).not.toBeNull();
      expect(fehler(viele(0))).not.toBeNull();
    });
  });

  describe("Checkliste", () => {
    test("Darstellung aus der Liste, Punkte nötig und höchstens MAX_CHECKLISTE", () => {
      const mit = (daten: object) =>
        b("checkliste", { ...BEISPIELE.checkliste, ...daten });
      expect(fehler(mit({ darstellung: "kreis" }))).not.toBeNull();
      expect(fehler(mit({ eintraege: [] }))).not.toBeNull();
      expect(fehler(mit({ eintraege: [{ text: "" }] }))).not.toBeNull();
      expect(
        fehler(
          mit({
            eintraege: Array.from({ length: MAX_CHECKLISTE + 1 }, () => ({
              text: "x",
            })),
          }),
        ),
      ).not.toBeNull();
    });
  });
});

describe("Verweise der Bausteine «Text und Gestaltung»", () => {
  test("Medien und Seiten, auf die sie zeigen, kommen in die Verweisprüfung", () => {
    const zitatBild = id();
    const bildnebenBild = id();
    const d = gueltig(
      b("zitat", { text: "x", bild: zitatBild }),
      b("bildneben", {
        mediumId: bildnebenBild,
        seite: "links",
        inhalt: [absatz("Text", { link: "/lager" })],
        link: { beschriftung: "Mehr", ziel: "/ueber-uns#team" },
      }),
      b("hinweisbox", {
        art: "info",
        inhalt: [absatz("Siehe", { link: "/anmelden" })],
      }),
      b("fragen", {
        eintraege: [
          { frage: "F", antwort: [absatz("A", { link: "/preise" })] },
        ],
      }),
      b("spalten", {
        links: { inhalt: [absatz("a", { link: "/links" })] },
        rechts: { inhalt: [absatz("b", { link: "https://www.example.org/" })] },
      }),
      b("schritte", {
        eintraege: [{ titel: "T", beschriftung: "Los", ziel: "/schritt" }],
      }),
    );
    const v = sammleVerweise(d);
    expect(new Set(v.medien)).toEqual(new Set([zitatBild, bildnebenBild]));
    expect(new Set(v.seiten)).toEqual(
      new Set([
        "/lager",
        "/ueber-uns",
        "/anmelden",
        "/preise",
        "/links",
        "/schritt",
      ]),
    );
  });

  test("Tabelle und Checkliste verweisen auf nichts", () => {
    const v = sammleVerweise(
      gueltig(
        b("tabelle", BEISPIELE.tabelle),
        b("checkliste", BEISPIELE.checkliste),
      ),
    );
    expect(v).toEqual({ medien: [], tags: [], personen: [], seiten: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const kontext = (daten: Daten = keineDaten()): Kontext => ({
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten,
});
const seite = (d: ReturnType<typeof dok>, daten?: Daten) =>
  rendereSeite(
    { id: id(), pfad: "/seite", dokument: d as never },
    kontext(daten),
  );
const mitBild = (
  mediumId: string,
  altText: string | null = "Kinder im Wald",
) => {
  const daten = keineDaten();
  (daten.medien as Map<string, unknown>).set(mediumId, {
    mimeTyp: "image/webp",
    groesse: 1,
    breite: 1264,
    hoehe: 948,
    altText,
  });
  return daten;
};
const h2 = (t: string) => b("ueberschrift", { ebene: 2, text: t });

describe("Renderer der Bausteine «Text und Gestaltung»", () => {
  test("Hinweisbox: das Wort der Art steht immer da, das Zeichen ist verborgen, Text wird maskiert", () => {
    const html = seite(
      dok(
        b("hinweisbox", {
          art: "achtung",
          titel: "<script>alert(1)</script>",
          inhalt: [absatz('<img src=x onerror="a">')],
        }),
      ),
    );
    expect(html).toContain('class="hinweisbox hinweisbox--achtung"');
    expect(html).toContain('<p class="hb-art">Achtung</p>');
    expect(html).toContain(
      '<span class="hb-zeichen" aria-hidden="true"></span>',
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    for (const [art, wort] of [
      ["info", "Info"],
      ["tipp", "Tipp"],
      ["wichtig", "Wichtig"],
    ]) {
      const h = seite(dok(b("hinweisbox", { art, inhalt: [absatz("x")] })));
      expect(h).toContain(`<p class="hb-art">${wort}</p>`);
    }
  });

  test("Zitat: Anführungszeichen der Schweiz, Person und Funktion, Foto nur mit Bild, leerer Alt-Text bei gleichem Namen", () => {
    const mid = id();
    const ohne = seite(dok(b("zitat", { text: "Es war schön." })));
    expect(ohne).toContain("<blockquote");
    expect(ohne).toContain("«Es war schön.»");
    expect(ohne).not.toContain("figcaption");

    const mit = seite(
      dok(
        b("zitat", {
          text: "Gut <b>so</b>",
          person: "Mika",
          funktion: "Leitung",
          bild: mid,
        }),
      ),
      mitBild(mid, "Mika"),
    );
    expect(mit).toContain("«Gut &lt;b&gt;so&lt;/b&gt;»");
    expect(mit).toContain('<strong class="zitat-name">Mika</strong>');
    expect(mit).toContain('<span class="funktion">Leitung</span>');
    expect(mit).toContain(`src="/api/v1/medien/${mid}"`);
    expect(mit).toMatch(
      /class="zitat-foto"[^>]*alt=""|alt=""[^>]*class="zitat-foto"/,
    );

    const anders = seite(
      dok(b("zitat", { text: "x", person: "Mika", bild: mid })),
      mitBild(mid, "Mika am Feuer"),
    );
    expect(anders).toContain('alt="Mika am Feuer"');

    // Ein Medium, das es nicht gibt, lässt nur das Foto weg
    const fehlt = seite(
      dok(b("zitat", { text: "x", person: "Mika", bild: id() })),
    );
    expect(fehlt).not.toContain('<img class="zitat-foto"');
    expect(fehlt).toContain("Mika");
  });

  test("Fragen: details mit summary, eigene Anker je Frage, nichts ist von Anfang an offen, Text maskiert", () => {
    const html = seite(
      dok(
        h2("Fragen"),
        b("fragen", {
          eintraege: [
            { frage: "Wann ist Anmeldeschluss?", antwort: [absatz("Bald.")] },
            {
              frage: "Wann ist Anmeldeschluss?",
              antwort: [absatz("Auch bald.")],
            },
            { frage: "<b>Was</b> kostet es?", antwort: [absatz("<i>x</i>")] },
          ],
        }),
      ),
    );
    expect(html).toContain('<div class="fragen">');
    expect(html).toContain(
      '<details class="frage" id="wann-ist-anmeldeschluss"><summary>Wann ist Anmeldeschluss?</summary>',
    );
    expect(html).toContain('id="wann-ist-anmeldeschluss-2"');
    expect(html).toContain("&lt;b&gt;Was&lt;/b&gt; kostet es?");
    expect(html).not.toContain("<details open");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).not.toContain("<i>x</i>");
    // Der Anker einer Überschrift und der einer Frage kollidieren nicht
    const doppelt = seite(
      dok(
        h2("Preise"),
        b("fragen", {
          eintraege: [{ frage: "Preise", antwort: [absatz("x")] }],
        }),
      ),
    );
    expect(doppelt).toContain('<h2 id="preise">');
    expect(doppelt).toContain('<details class="frage" id="preise-2">');
  });

  test("Zwei Spalten: zwei Spalten, Titel eine Ebene unter dem letzten, der Abschnitt nimmt die ganze Breite", () => {
    const html = seite(
      dok(
        h2("Wir"),
        b("spalten", {
          links: { titel: "Kinder", inhalt: [absatz("a")] },
          rechts: { inhalt: [absatz("b")] },
        }),
      ),
    );
    expect(html).toContain('<div class="zwei-spalten">');
    expect((html.match(/class="zs-spalte"/g) ?? []).length).toBe(2);
    expect(html).toContain('<h3 class="titel">Kinder</h3>');
    expect(html).toMatch(/sektion--breit/);
  });

  test("Bild neben Text: Seite als Klasse, Alt-Text vom Medium, ohne Medium steht der Text allein, nur die erste Schaltfläche der Seite ist rot", () => {
    const m1 = id();
    const m2 = id();
    const daten = mitBild(m1, "Zelt im Wald");
    (daten.medien as Map<string, unknown>).set(
      m2,
      (daten.medien as Map<string, unknown>).get(m1),
    );
    const bt = (mediumId: string, seiteWahl: string) =>
      b("bildneben", {
        mediumId,
        seite: seiteWahl,
        titel: "Titel",
        inhalt: [absatz("Text")],
        link: { beschriftung: "Mehr", ziel: "/mehr" },
      });
    const html = seite(
      dok(h2("Draussen"), bt(m1, "rechts"), bt(m2, "links")),
      daten,
    );
    expect(html).toContain("bildneben bildneben--rechts");
    expect(html).toContain("bildneben bildneben--links");
    expect(html).toContain('alt="Zelt im Wald"');
    expect(html).toContain('<h3 class="titel">Titel</h3>');
    expect(html).toContain('class="btn p gross"');
    expect(html).toContain('class="btn s gross"');
    expect((html.match(/class="btn p gross"/g) ?? []).length).toBe(1);

    const ohne = seite(dok(h2("Draussen"), bt(id(), "links")));
    expect(ohne).toContain("bildneben--ohne-bild");
    expect(ohne).not.toContain("<figure");
    expect(ohne).toContain("<p>Text</p>");
  });

  test("Tabelle: Beschriftung, Kopf mit scope, Zeilenkopf, Zahlenspalten rechtsbündig, scrollbare Fläche mit Namen und Tastatur, Zellen maskiert", () => {
    const html = seite(
      dok(
        b("tabelle", {
          beschriftung: "Preise & Zeiten",
          kopf: ["Angebot", "Preis", "Zeit"],
          zeilen: [
            ["<b>Tag</b>", "CHF 25.–", "9 bis 17 Uhr"],
            ["Woche", "1'250", ""],
          ],
          zeilenkopf: true,
        }),
      ),
    );
    expect(html).toContain(
      '<div class="tabelle-rahmen" role="region" aria-label="Preise &amp; Zeiten" tabindex="0">',
    );
    expect(html).toContain("<caption>Preise &amp; Zeiten</caption>");
    expect(html).toContain('<th scope="col">Angebot</th>');
    expect(html).toContain('<th scope="col" class="tab-zahl">Preis</th>');
    expect(html).toContain('<th scope="row">&lt;b&gt;Tag&lt;/b&gt;</th>');
    expect(html).toContain('<td class="tab-zahl">CHF 25.–</td>');
    expect(html).toContain("<td>9 bis 17 Uhr</td>");
    expect(html).not.toContain("<b>Tag</b>");
    // Die Spalte «Zeit» besteht nicht aus Zahlen
    expect(html).not.toContain('<td class="tab-zahl">9 bis');

    const einfach = seite(
      dok(
        b("tabelle", {
          kopf: ["A", "B"],
          zeilen: [["1", "2"]],
          zeilenkopf: false,
        }),
      ),
    );
    expect(einfach).toContain('aria-label="Tabelle"');
    expect(einfach).not.toContain("<caption>");
    expect(einfach).not.toContain('scope="row"');
    // Ohne Zeilenkopf sind auch Zahlen der ersten Spalte Zahlen
    expect(einfach).toContain('<td class="tab-zahl">1</td>');
  });

  test("Schritte: geordnete Liste mit Rolle, Titel, Text und Link; ein ungültiger Link bleibt Text", () => {
    const html = seite(
      dok(
        b("schritte", {
          eintraege: [
            {
              titel: "Anmelden",
              text: "Mit <b>Konto</b>",
              beschriftung: "Zur Anmeldung",
              ziel: "/anmelden",
            },
            { titel: "Warten" },
          ],
        }),
      ),
    );
    expect(html).toContain('<ol class="schritte" role="list">');
    expect((html.match(/class="schritt"/g) ?? []).length).toBe(2);
    expect(html).toContain('<p class="titel">Anmelden</p>');
    expect(html).toContain("Mit &lt;b&gt;Konto&lt;/b&gt;");
    expect(html).toContain(
      '<a href="/anmelden" class="verweis">Zur Anmeldung</a>',
    );

    // Der Renderer prüft den Link ein zweites Mal: Schreibt ihn jemand am Schema vorbei, entsteht kein Link
    const schlecht = seite(
      dok(
        b("schritte", {
          eintraege: [
            { titel: "X", beschriftung: "Klick", ziel: "javascript:alert(1)" },
          ],
        }),
      ),
    );
    expect(schlecht).not.toContain("javascript:");
    expect(schlecht).toContain("Klick");
  });

  test("Checkliste: Darstellung als Klasse, Zeichen sind verborgen, Titel eine Ebene unter dem letzten", () => {
    const html = seite(
      dok(
        h2("Packen"),
        b("checkliste", {
          titel: "Rucksack",
          darstellung: "haken",
          eintraege: [{ text: "Schlafsack" }, { text: "<u>Mütze</u>" }],
        }),
      ),
    );
    expect(html).toContain('<div class="checkliste checkliste--haken">');
    expect(html).toContain('<h3 class="titel">Rucksack</h3>');
    expect(
      (html.match(/class="cl-zeichen" aria-hidden="true"/g) ?? []).length,
    ).toBe(2);
    expect(html).toContain(
      '<span class="cl-text">&lt;u&gt;Mütze&lt;/u&gt;</span>',
    );
    expect(
      seite(
        dok(
          b("checkliste", {
            darstellung: "kaestchen",
            eintraege: [{ text: "x" }],
          }),
        ),
      ),
    ).toContain("checkliste--kaestchen");
  });

  test("ein geschützter Baustein steht nie im HTML der Seite, nur ein Platzhalter", () => {
    const html = seite(
      dok(
        b("zitat", { text: "Geheim" }, { sichtbarkeit: { art: "angemeldet" } }),
      ),
    );
    expect(html).not.toContain("Geheim");
    expect(html).toContain("Nur angemeldet sichtbar");
  });

  test("kein Skript, kein style-Attribut, keine Handler: die Aufklappliste und die Tabelle brauchen keines", () => {
    const html = seite(
      dok(
        h2("Alles"),
        ...Object.entries(BEISPIELE).map(([typ, daten]) => b(typ, daten)),
      ),
      mitBild(BEISPIELE.zitat.bild),
    );
    const inhalt = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(inhalt).not.toMatch(/<script/);
    expect(inhalt).not.toMatch(/\sstyle=/);
    expect(inhalt).not.toMatch(/\son[a-z]+=/);
  });
});

// Eine kleine Attrappe des DOM wie in website-skripte.test.ts: Was knoten.js erzeugt, ohne Browser
type Attrappe = {
  name?: string;
  attrs?: Record<string, string>;
  kinder?: Attrappe[];
  text?: string;
};
function attrappe() {
  const knoten = (name: string) => ({
    name,
    attrs: {} as Record<string, string>,
    kinder: [] as unknown[],
    setAttribute(n: string, w: string) {
      this.attrs[n] = w;
    },
    appendChild(k: unknown) {
      this.kinder.push(k);
      return k;
    },
  });
  return {
    createElement: (t: string) => knoten(t),
    createTextNode: (t: string) => ({ text: t }),
  };
}
const zaehleElemente = (k: HtmlKnoten): number =>
  typeof k === "string"
    ? 0
    : 1 + (k.kinder ?? []).reduce((n, x) => n + zaehleElemente(x), 0);
const zaehleBauteile = (k: Attrappe): number =>
  k.name === undefined
    ? 0
    : 1 + (k.kinder ?? []).reduce((n, x) => n + zaehleBauteile(x), 0);
const alleAttribute = (k: HtmlKnoten): string[] =>
  typeof k === "string"
    ? []
    : [
        ...Object.keys(k.attr ?? {}).map((n) => `${k.tag}.${n}`),
        ...(k.kinder ?? []).flatMap(alleAttribute),
      ];
const gebaute = (k: Attrappe): string[] => [
  ...Object.keys(k.attrs ?? {}).map((n) => `${k.name}.${n}`),
  ...(k.kinder ?? []).flatMap(gebaute),
];

describe("geschützte Bausteine: knoten.js kennt alles, was die Renderer liefern", () => {
  test.each(Object.entries(BEISPIELE))(
    "%s: kein Element und kein Attribut fällt weg (ausser dem Anker)",
    (typ, daten) => {
      const mid = id();
      const d = JSON.parse(JSON.stringify(daten));
      if (d.mediumId) d.mediumId = mid;
      if (d.bild) d.bild = mid;
      const dokument = gueltig(
        h2("Eins"),
        b(typ, d, { sichtbarkeit: { art: "angemeldet" } }),
      );
      const [k] = rendereGeschuetzte(
        dokument,
        id(),
        mitBild(mid),
        (x) => x.typ === typ,
      );
      expect(k).toBeDefined();
      const roh = JSON.parse(JSON.stringify(k!.knoten)) as HtmlKnoten;
      const gebaut = baueKnoten(attrappe(), roh) as unknown as Attrappe;
      expect(gebaut).not.toBeNull();
      expect(zaehleBauteile(gebaut)).toBe(zaehleElemente(roh));
      const fehlend = alleAttribute(roh).filter(
        (a) => !gebaute(gebaut).includes(a) && !a.endsWith(".id"),
      );
      expect(fehlend).toEqual([]);
    },
  );

  test("Rolle, Tastatur und Name der scrollbaren Tabelle nehmen nur die vorgesehenen Elemente an", () => {
    const k = (tag: string, attr: Record<string, string | true>) =>
      (baueKnoten(attrappe(), { tag, attr, kinder: [] }) as unknown as Attrappe)
        .attrs;
    expect(
      k("div", { role: "region", tabindex: "0", "aria-label": "T" }),
    ).toEqual({
      role: "region",
      tabindex: "0",
      "aria-label": "T",
    });
    expect(k("div", { role: "button" })).toEqual({});
    expect(k("div", { tabindex: "5" })).toEqual({});
    expect(k("a", { tabindex: "0", "aria-label": "x" })).toEqual({});
    expect(k("th", { scope: "row" })).toEqual({ scope: "row" });
    expect(k("th", { scope: "evil" })).toEqual({});
    expect(k("td", { scope: "col" })).toEqual({});
    expect(k("ol", { role: "list" })).toEqual({ role: "list" });
  });
});

describe("Stil und Editor", () => {
  const lies = (pfad: string) =>
    readFileSync(new URL(pfad, import.meta.url), "utf8");
  const css = lies("../public/website/website.css");

  test("der Stil kennt jede Klasse der Renderer und nutzt nur Tokens und Mass", () => {
    // Ab dem Kommentar, der den Abschnitt eröffnet, ohne Kommentare (sie nennen die Nummer des Issues)
    const start = css.lastIndexOf(
      "/*",
      css.indexOf("Text und Gestaltung (#741)"),
    );
    // Bis zum nächsten Abschnitt der Datei (spätere Abschnitte anderer Bausteine gehören nicht dazu)
    const ende = css.indexOf("/* ===== ", start + 10);
    const abschnitt = css
      .slice(start, ende === -1 ? undefined : ende)
      .replace(/\/\*[^]*?\*\//g, "");
    for (const klasse of [
      ".hinweisbox",
      ".hinweisbox--tipp",
      ".hinweisbox--wichtig",
      ".hinweisbox--achtung",
      ".hb-zeichen",
      ".zitat",
      ".zitat-foto",
      ".fragen",
      ".frage summary",
      ".zwei-spalten",
      ".bildneben--rechts",
      ".bildneben--ohne-bild",
      ".tabelle-rahmen",
      ".texttabelle .tab-zahl",
      ".schritte",
      ".schritt::before",
      ".checkliste--haken",
      ".cl-zeichen",
    ]) {
      expect(abschnitt, klasse).toContain(klasse);
    }
    // Farben nur als var(--token), nie als Hex; keine fremden Adressen
    expect(abschnitt).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(abschnitt).not.toMatch(/url\(/);
    // Bewegung nur ohne «Bewegung reduzieren»
    const uebergaenge = [...abschnitt.matchAll(/transition:/g)].length;
    expect(uebergaenge).toBe(1);
    expect(abschnitt).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.frage summary::after\s*\{\s*transition:/,
    );
  });

  test("der Editor kennt jeden Typ, und jeder Katalogeintrag trägt Gruppe und Beispiel", () => {
    const text = lies("../public/admin/website-felder-text.js");
    const felder = lies("../public/admin/website-felder.js");
    expect(felder).toContain("...TEXT_TYPEN,");
    expect(felder).toContain("...TEXT_KATALOG,");
    for (const typ of Object.keys(BEISPIELE)) {
      expect(text, typ).toContain(`typ: "${typ}"`);
      expect(text, typ).toMatch(new RegExp(`\\n  ${typ}: \\{\\n    name:`));
    }
    expect((text.match(/gruppe: "/g) ?? []).length).toBe(8);
    expect((text.match(/beispiel: \(\) =>/g) ?? []).length).toBe(8);
    // keine Browserdialoge, kein innerHTML
    for (const verboten of ["alert(", "confirm(", "prompt(", "innerHTML"]) {
      expect(text, verboten).not.toContain(verboten);
    }
  });
});

// Die Dateien der Verwaltung laufen im Browser; für den Import genügt eine Attrappe von window und document, gezeichnet wird hier nichts
async function ladeEditor() {
  vi.stubGlobal("window", { addEventListener() {}, location: { hash: "" } });
  vi.stubGlobal("document", { addEventListener() {} });
  // @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
  return (await import("../public/admin/website-felder.js")) as {
    KATALOG: {
      typ: string;
      name: string;
      gruppe?: string;
      beschreibung: string;
      neu: () => Record<string, unknown>;
      beispiel?: () => Record<string, unknown>;
    }[];
    TYPEN: Record<
      string,
      {
        name: string;
        kurz: (d: unknown, k: unknown) => string;
        pruefe: (d: unknown, k: unknown) => [string, string][];
      }
    >;
    medienIds: (d: unknown) => string[];
    feldName: (pfad: string) => string;
  };
}
const GRUPPEN = [
  "Text",
  "Bilder und Medien",
  "Karten und Listen",
  "Handlung",
  "Personen",
  "Dynamisch",
  "Gestaltung",
];

describe("Editor: Katalog und Prüfung der Bausteine «Text und Gestaltung»", async () => {
  const editor = await ladeEditor();
  const meine = editor.KATALOG.filter((e) => e.typ in BEISPIELE);
  const k = {
    medien: new Map(),
    personNamen: new Map(),
    tagNamen: new Map(),
    altText: () => "Alt",
  };

  test("alle acht stehen im Katalog, mit Gruppe, Beschreibung und Beispiel", () => {
    expect(meine.map((e) => e.typ).sort()).toEqual(
      Object.keys(BEISPIELE).sort(),
    );
    for (const e of meine) {
      expect(GRUPPEN, e.typ).toContain(e.gruppe);
      expect(e.beschreibung.length, e.typ).toBeGreaterThan(10);
      expect(typeof e.beispiel, e.typ).toBe("function");
      expect(e.name).toBe(editor.TYPEN[e.typ]!.name);
    }
  });

  test.each(Object.keys(BEISPIELE))(
    "%s: das Beispiel besteht die Prüfung des Editors und die des Servers, ein neuer, leerer Baustein nicht",
    (typ) => {
      const e = meine.find((x) => x.typ === typ)!;
      const beispiel = JSON.parse(JSON.stringify(e.beispiel!()));
      expect(editor.TYPEN[typ]!.pruefe(beispiel, k)).toEqual([]);
      expect(editor.TYPEN[typ]!.kurz(beispiel, k)).not.toBe("");
      expect(fehler(b(typ, beispiel))).toBeNull();
      // Neu: Der Editor verlangt, was fehlt, bevor er übernimmt
      expect(editor.TYPEN[typ]!.pruefe(e.neu(), k).length, typ).toBeGreaterThan(
        0,
      );
      expect(() => editor.TYPEN[typ]!.kurz(e.neu(), k)).not.toThrow();
    },
  );

  test("das Beispiel zeigt in der Vorschau etwas, auch ohne Bild und ohne Daten", () => {
    for (const e of meine) {
      const d = JSON.parse(JSON.stringify(e.beispiel!()));
      const html = seite(dok(b(e.typ, d)));
      expect(html, e.typ).toMatch(
        /hinweisbox|zitat|fragen|zwei-spalten|bildneben|tabelle|schritte|checkliste/,
      );
    }
  });

  test("Fehler vom Server finden ihren Namen: jedes Feld der neuen Bausteine hat einen", () => {
    for (const pfad of [
      "daten.art",
      "daten.eintraege.0.frage",
      "daten.eintraege.0.antwort",
      "daten.links.inhalt",
      "daten.rechts.inhalt",
      "daten.kopf.1",
      "daten.zeilen.2",
      "daten.person",
      "daten.seite",
    ]) {
      expect(editor.feldName(pfad), pfad).not.toBe("Die Eingabe");
    }
  });

  test("Bilder des Zitats und von «Bild neben Text» werden mit den Angaben der Medien abgerufen", () => {
    const a = id();
    const c = id();
    const ids = editor.medienIds({
      bausteine: [
        { typ: "zitat", daten: { text: "x", bild: a } },
        { typ: "bildneben", daten: { mediumId: c } },
      ],
    });
    expect(new Set(ids)).toEqual(new Set([a, c]));
  });
});
