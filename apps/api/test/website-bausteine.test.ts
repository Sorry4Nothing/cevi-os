import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  MAX_ABSCHNITT_ZEICHEN,
  MAX_BAUSTEINE_PRO_SEITE,
  MAX_GALERIE_BILDER,
  MAX_KARTEN,
  MAX_LINK_LAENGE,
  MAX_LISTENEINTRAEGE,
  MAX_SEITENTITEL,
  MAX_TERMINE,
  MAX_TEXTBLOECKE,
  MAX_TEXT_ZEICHEN,
  MIN_TERMINE,
} from "../src/website/bausteine.js";
import {
  pruefeDokument,
  sammleVerweise,
  type Seitendokument,
} from "../src/website/dokument.js";

const id = () => randomUUID();
const dok = (...bausteine: unknown[]) => ({ v: 1, titel: "Wölfe", bausteine });
const b = (typ: string, daten: unknown, extra: object = {}) => ({
  id: id(),
  typ,
  daten,
  ...extra,
});
const absatz = (text: string, extra: object = {}) => ({
  typ: "absatz",
  inhalt: [{ text, ...extra }],
});

function gueltig(...bausteine: unknown[]): Seitendokument {
  const p = pruefeDokument(dok(...bausteine));
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
}
const fehler = (eingabe: unknown) => {
  const p = pruefeDokument(eingabe);
  return p.ok ? null : p.fehler;
};

// Ein gültiges Beispiel je Typ
const BEISPIELE: Record<string, unknown> = {
  ueberschrift: { ebene: 2, text: "Was wir tun" },
  text: { inhalt: [absatz("Hallo")] },
  bild: { mediumId: id(), unterschrift: "Waldspiel" },
  galerie: { bilder: [{ mediumId: id() }, { mediumId: id() }] },
  karten: {
    darstellung: "karten",
    eintraege: [
      { titel: "Bienli", text: "Ab 4 Jahren", link: "/stufen/bienli" },
    ],
  },
  schaltflaeche: {
    darstellung: "schaltflaeche",
    beschriftung: "Schnuppern",
    ziel: "/anlaesse/schnuppern",
  },
  datei: { mediumId: id(), beschriftung: "Packliste" },
  kontaktperson: { personId: id(), zusatz: ["telefon"] },
  leitungsteam: { tagId: id() },
  terminliste: { tagId: id(), anzahl: 5 },
  trenner: { art: "linie" },
  videolink: {
    art: "video",
    beschriftung: "Film zum Lager",
    url: "https://video.beispiel.ch/film",
  },
  stufenfakten: {},
};

describe("Seitendokument", () => {
  test("gültig: leere Seite und jeder Typ", () => {
    expect(pruefeDokument(dok()).ok).toBe(true);
    for (const [typ, daten] of Object.entries(BEISPIELE)) {
      expect(gueltig(b(typ, daten)).bausteine[0]!.typ).toBe(typ);
    }
  });

  test("Sichtbarkeit fehlt oder «erbt» heisst erbt; eigene Werte gelten", () => {
    const d = gueltig(
      b("trenner", { art: "abstand" }),
      b("trenner", { art: "abstand" }, { sichtbarkeit: "erbt" }),
      b("trenner", { art: "abstand" }, { sichtbarkeit: { art: "angemeldet" } }),
      b(
        "trenner",
        { art: "abstand" },
        { sichtbarkeit: { art: "tags", tagIds: [id()] } },
      ),
    );
    expect(d.bausteine.map((x) => x.sichtbarkeit)).toMatchObject([
      "erbt",
      "erbt",
      { art: "angemeldet" },
      { art: "tags" },
    ]);
  });

  test("abgelehnt: unbekannter Typ, fehlendes oder zusätzliches Feld", () => {
    expect(fehler(dok(b("html", { inhalt: "<b>x</b>" })))).not.toBeNull();
    expect(fehler(dok({ id: id(), typ: "trenner" }))).not.toBeNull();
    expect(fehler({ ...dok(), v: 2 })).not.toBeNull();
    expect(fehler({ ...dok(), extra: 1 })).not.toBeNull();
    expect(fehler({ titel: "x", bausteine: [] })).not.toBeNull();
    expect(
      fehler(dok({ ...b("trenner", { art: "linie" }), extra: 1 })),
    ).not.toBeNull();
    expect(
      fehler(dok(b("trenner", { art: "linie", extra: 1 }))),
    ).not.toBeNull();
    expect(fehler(dok(b("trenner", { art: "rot" })))).not.toBeNull();
    for (const falsch of [null, 1, "x", [], undefined]) {
      expect(fehler(falsch)).not.toBeNull();
    }
  });

  test("abgelehnt: ID keine UUID, doppelte ID", () => {
    expect(
      fehler(dok({ id: "1", typ: "trenner", daten: { art: "linie" } })),
    ).not.toBeNull();
    const eins = b("trenner", { art: "linie" });
    const f = fehler(dok(eins, { ...eins }));
    expect(f).toEqual([{ pfad: "bausteine.1.id", code: "custom" }]);
  });

  test("Grenzen: Titel, Anzahl Bausteine", () => {
    expect(
      pruefeDokument({ ...dok(), titel: "x".repeat(MAX_SEITENTITEL) }).ok,
    ).toBe(true);
    expect(
      fehler({ ...dok(), titel: "x".repeat(MAX_SEITENTITEL + 1) }),
    ).not.toBeNull();
    expect(fehler({ ...dok(), titel: "   " })).not.toBeNull();
    const viele = (n: number) =>
      dok(...Array.from({ length: n }, () => b("trenner", { art: "linie" })));
    expect(pruefeDokument(viele(MAX_BAUSTEINE_PRO_SEITE)).ok).toBe(true);
    expect(fehler(viele(MAX_BAUSTEINE_PRO_SEITE + 1))).not.toBeNull();
  });

  test("Fehler tragen nur Pfad und Code, nie Nutzerdaten", () => {
    const geheim = "GEHEIMER-WERT-4711";
    const f = fehler(
      dok(
        b("trenner", { art: geheim, [geheim]: geheim }),
        { id: id(), typ: geheim, daten: {} },
        b("schaltflaeche", {
          darstellung: "link",
          beschriftung: geheim,
          ziel: `javascript:${geheim}`,
        }),
      ),
    );
    expect(f).not.toBeNull();
    expect(JSON.stringify(f)).not.toContain(geheim);
    expect(f).toContainEqual({
      pfad: "bausteine.2.daten.ziel",
      code: "custom",
    });
    expect(f!.length).toBeLessThanOrEqual(20);
  });
});

describe("Überschrift", () => {
  test.each([2, 3, 4])("Ebene %i gültig", (ebene) => {
    expect(
      pruefeDokument(dok(b("ueberschrift", { ebene, text: "T" }))).ok,
    ).toBe(true);
  });
  test.each([1, 5, 0, "2", 2.5])("Ebene %s ungültig", (ebene) => {
    expect(fehler(dok(b("ueberschrift", { ebene, text: "T" })))).not.toBeNull();
  });
  test("Text: leer, nur Leerraum, Steuerzeichen, zu lang", () => {
    for (const text of ["", "   ", "a\u0000b", "a\nb", "x".repeat(201)]) {
      expect(fehler(dok(b("ueberschrift", { ebene: 2, text })))).not.toBeNull();
    }
    expect(
      pruefeDokument(
        dok(b("ueberschrift", { ebene: 2, text: "x".repeat(200) })),
      ).ok,
    ).toBe(true);
  });
});

describe("Text (Rich Text als Knoten)", () => {
  const text = (...inhalt: unknown[]) => dok(b("text", { inhalt }));

  test("gültig: Absatz mit Marken, geordnete und ungeordnete Liste", () => {
    const p = pruefeDokument(
      text(
        {
          typ: "absatz",
          inhalt: [
            { text: "fett", fett: true },
            { text: " und " },
            { text: "kursiv", kursiv: true, fett: true },
            { text: "Link", link: "https://www.beispiel.ch/a?b=1#c" },
            { text: "Seite", link: "/stufen/woelfe#treffpunkt" },
            { text: "Mail", link: "mailto:info@beispiel.invalid" },
            { text: "Tel", link: "tel:+41000000000" },
          ],
        },
        {
          typ: "liste",
          geordnet: true,
          eintraege: [[{ text: "eins" }], [{ text: "zwei" }]],
        },
        { typ: "liste", geordnet: false, eintraege: [[{ text: "x" }]] },
      ),
    );
    expect(p.ok).toBe(true);
  });

  test("abgelehnt: HTML-Knoten, Marken und Felder ausserhalb des Katalogs", () => {
    for (const knoten of [
      { typ: "html", inhalt: "<script>alert(1)</script>" },
      { typ: "absatz", inhalt: [{ text: "x", stil: "color:red" }] },
      { typ: "absatz", inhalt: [{ text: "x", fett: false }] },
      { typ: "absatz", inhalt: [{ text: "x", link: "/a", onclick: "x()" }] },
      { typ: "absatz", inhalt: "Text ohne Abschnitte" },
      { typ: "absatz", inhalt: [] },
      { typ: "absatz", inhalt: [{ text: "" }] },
      { typ: "liste", geordnet: "ja", eintraege: [[{ text: "x" }]] },
      { typ: "liste", geordnet: true, eintraege: [] },
      // keine verschachtelten Listen
      {
        typ: "liste",
        geordnet: true,
        eintraege: [[{ typ: "liste", geordnet: true, eintraege: [] }]],
      },
      { typ: "absatz", inhalt: [{ text: "a\u0000b" }] },
      { typ: "absatz", inhalt: [{ text: "a\u0007b" }] },
    ]) {
      expect(fehler(text(knoten))).not.toBeNull();
    }
    expect(fehler(dok(b("text", { inhalt: [] })))).not.toBeNull();
    expect(fehler(dok(b("text", { inhalt: "<p>x</p>" })))).not.toBeNull();
    expect(fehler(dok(b("text", { html: "<p>x</p>" })))).not.toBeNull();
  });

  test("HTML und Skript als Text sind erlaubt, bleiben aber blosser Text", () => {
    // Der Renderer maskiert; das Schema darf Text nicht verändern oder ablehnen (z. B. «a < b»)
    const roh = `<img src=x onerror=alert(1)> a < b & "c"`;
    const d = gueltig(b("text", { inhalt: [absatz(roh)] }));
    const knoten = d.bausteine[0]!.daten as {
      inhalt: { inhalt: { text: string }[] }[];
    };
    expect(knoten.inhalt[0]!.inhalt[0]!.text).toBe(roh);
  });

  test("Grenzen: Abschnittslänge, Blockzahl, Listeneinträge, Gesamttext", () => {
    expect(
      pruefeDokument(text(absatz("x".repeat(MAX_ABSCHNITT_ZEICHEN)))).ok,
    ).toBe(true);
    expect(
      fehler(text(absatz("x".repeat(MAX_ABSCHNITT_ZEICHEN + 1)))),
    ).not.toBeNull();

    const bloecke = (n: number) => Array.from({ length: n }, () => absatz("x"));
    expect(pruefeDokument(text(...bloecke(MAX_TEXTBLOECKE))).ok).toBe(true);
    expect(fehler(text(...bloecke(MAX_TEXTBLOECKE + 1)))).not.toBeNull();

    const liste = (n: number) => ({
      typ: "liste",
      geordnet: false,
      eintraege: Array.from({ length: n }, () => [{ text: "x" }]),
    });
    expect(pruefeDokument(text(liste(MAX_LISTENEINTRAEGE))).ok).toBe(true);
    expect(fehler(text(liste(MAX_LISTENEINTRAEGE + 1)))).not.toBeNull();

    // Jeder Block für sich im Rahmen, zusammen über dem Gesamtlimit
    const gross = absatz("x".repeat(MAX_ABSCHNITT_ZEICHEN));
    const noetig = Math.ceil(MAX_TEXT_ZEICHEN / MAX_ABSCHNITT_ZEICHEN);
    expect(pruefeDokument(text(...Array(noetig).fill(gross))).ok).toBe(true);
    expect(fehler(text(...Array(noetig + 1).fill(gross)))).not.toBeNull();
  });

  test("Tief verschachtelte Eingabe wird abgelehnt, ohne zu stürzen", () => {
    let tief: unknown = { text: "x" };
    for (let i = 0; i < 5000; i++) tief = { inhalt: [tief] };
    expect(fehler(text(tief))).not.toBeNull();
  });
});

describe("Links", () => {
  const ziel = (z: string) =>
    dok(
      b("schaltflaeche", { darstellung: "link", beschriftung: "Los", ziel: z }),
    );
  const textlink = (z: string) =>
    dok(b("text", { inhalt: [absatz("x", { link: z })] }));
  const kartenlink = (z: string) =>
    dok(
      b("karten", {
        darstellung: "liste",
        eintraege: [{ titel: "t", link: z }],
      }),
    );
  const videolink = (u: string) =>
    dok(b("videolink", { art: "video", beschriftung: "v", url: u }));

  const GUT = [
    "https://www.beispiel.ch",
    "https://www.beispiel.ch/pfad/seite.pdf?a=1&b=2#anker",
    "https://sub.beispiel.ch:8443/x",
    "/",
    "/stufen",
    "/stufen/woelfe",
    "/stufen/woelfe#treffpunkt",
    "mailto:info@beispiel.invalid",
    "tel:+41000000000",
    "tel:0000000000",
  ];
  const BOESE = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://www.beispiel.ch/x",
    "//evil.example/x",
    "///evil.example",
    "\\\\evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "http://www.beispiel.ch",
    "HTTP://www.beispiel.ch",
    "https:www.beispiel.ch",
    "https:/www.beispiel.ch",
    "https:\\\\www.beispiel.ch",
    "https://user:pw@www.beispiel.ch",
    "https://www.beispiel.ch@evil.example.ch",
    "https://localhost/x",
    "https://www.beispiel.ch/a\\b",
    "https://www.beispiel.ch/a\u0085b",
    "https://",
    "https:///x",
    "https://www.beispiel.ch/<script>",
    'https://www.beispiel.ch/"onmouseover="x',
    "https://www.beispiel.ch/ x",
    "stufen/woelfe",
    "../stufen",
    "/../stufen",
    "/Stufen",
    "/stufen//woelfe",
    "/stufen/",
    "/stufen?x=1",
    "/stufen#<b>",
    "#anker",
    "?x=1",
    "",
    "mailto:",
    "mailto:keine-adresse",
    "mailto:a@b.ch?subject=x",
    "mailto:a@b.ch,c@d.ch",
    "tel:",
    "tel:abc",
    "tel:+41 00 000",
    "tel:+41;ext=1",
    "ftp://x.ch",
    "ws://x.ch",
    "x".repeat(MAX_LINK_LAENGE + 1),
    `https://www.beispiel.ch/${"a".repeat(MAX_LINK_LAENGE)}`,
  ];

  test.each(GUT)("gültig im Text, Schaltfläche: %s", (z) => {
    expect(pruefeDokument(textlink(z)).ok).toBe(true);
    expect(pruefeDokument(ziel(z)).ok).toBe(true);
  });
  test.each(BOESE)("abgelehnt in jedem Linkfeld: %j", (z) => {
    expect(fehler(textlink(z))).not.toBeNull();
    expect(fehler(ziel(z))).not.toBeNull();
    expect(fehler(kartenlink(z))).not.toBeNull();
    expect(fehler(videolink(z))).not.toBeNull();
  });

  test("Karten: nur https und Seiten, kein mailto und tel", () => {
    expect(pruefeDokument(kartenlink("https://www.beispiel.ch")).ok).toBe(true);
    expect(pruefeDokument(kartenlink("/stufen")).ok).toBe(true);
    expect(fehler(kartenlink("mailto:info@beispiel.invalid"))).not.toBeNull();
    expect(fehler(kartenlink("tel:+41000000000"))).not.toBeNull();
  });
  test("Video und Social: nur https", () => {
    expect(pruefeDokument(videolink("https://video.beispiel.ch/x")).ok).toBe(
      true,
    );
    for (const z of [
      "/stufen",
      "mailto:info@beispiel.invalid",
      "tel:+41000000000",
    ]) {
      expect(fehler(videolink(z))).not.toBeNull();
    }
  });
});

describe("Bild, Galerie, Datei (Verweis auf ein Medium)", () => {
  test("Bild ohne Medium oder mit eigenem Alt-Text im Baustein ist abgelehnt", () => {
    expect(fehler(dok(b("bild", {})))).not.toBeNull();
    expect(fehler(dok(b("bild", { mediumId: "kein-uuid" })))).not.toBeNull();
    // Der Alt-Text gehört ans Medium, nicht an den Baustein
    expect(
      fehler(dok(b("bild", { mediumId: id(), altText: "x" }))),
    ).not.toBeNull();
    expect(
      fehler(dok(b("bild", { mediumId: id(), url: "https://x.ch/a.png" }))),
    ).not.toBeNull();
    expect(
      fehler(dok(b("datei", { mediumId: id(), url: "https://x.ch/a.pdf" }))),
    ).not.toBeNull();
    expect(fehler(dok(b("datei", {})))).not.toBeNull();
  });
  test("Galerie: leer, zu gross, Fremdfeld", () => {
    const galerie = (n: number) => ({
      bilder: Array.from({ length: n }, () => ({ mediumId: id() })),
    });
    expect(fehler(dok(b("galerie", galerie(0))))).not.toBeNull();
    expect(
      pruefeDokument(dok(b("galerie", galerie(MAX_GALERIE_BILDER)))).ok,
    ).toBe(true);
    expect(
      fehler(dok(b("galerie", galerie(MAX_GALERIE_BILDER + 1)))),
    ).not.toBeNull();
    expect(
      fehler(dok(b("galerie", { bilder: [{ mediumId: id(), alt: "x" }] }))),
    ).not.toBeNull();
  });
});

describe("Karten, Termin-Liste, Kontakt, Leitungsteam, übrige", () => {
  test("Karten: Darstellung, Menge, Titel", () => {
    const karten = (n: number) => ({
      darstellung: "karten",
      eintraege: Array.from({ length: n }, () => ({ titel: "t" })),
    });
    expect(fehler(dok(b("karten", karten(0))))).not.toBeNull();
    expect(pruefeDokument(dok(b("karten", karten(MAX_KARTEN)))).ok).toBe(true);
    expect(fehler(dok(b("karten", karten(MAX_KARTEN + 1))))).not.toBeNull();
    expect(
      fehler(
        dok(
          b("karten", { darstellung: "raster", eintraege: [{ titel: "t" }] }),
        ),
      ),
    ).not.toBeNull();
    expect(
      fehler(
        dok(b("karten", { darstellung: "liste", eintraege: [{ titel: "" }] })),
      ),
    ).not.toBeNull();
    expect(
      fehler(
        dok(
          b("karten", {
            darstellung: "liste",
            eintraege: [{ titel: "t", html: "x" }],
          }),
        ),
      ),
    ).not.toBeNull();
  });

  test("Termin-Liste: Anzahl von 3 bis 10, Tag optional", () => {
    expect(
      pruefeDokument(dok(b("terminliste", { anzahl: MIN_TERMINE }))).ok,
    ).toBe(true);
    expect(
      pruefeDokument(
        dok(b("terminliste", { anzahl: MAX_TERMINE, tagId: id() })),
      ).ok,
    ).toBe(true);
    for (const anzahl of [
      MIN_TERMINE - 1,
      MAX_TERMINE + 1,
      4.5,
      "5",
      undefined,
    ]) {
      expect(fehler(dok(b("terminliste", { anzahl })))).not.toBeNull();
    }
    expect(
      fehler(dok(b("terminliste", { anzahl: 5, tagId: "x" }))),
    ).not.toBeNull();
  });

  test("Kontaktperson und Leitungsteam: Verweis, Zusatz wählbar, standardmässig keiner", () => {
    const k = gueltig(b("kontaktperson", { personId: id() })).bausteine[0]!;
    expect((k.daten as { zusatz: string[] }).zusatz).toEqual([]);
    expect(
      pruefeDokument(
        dok(
          b("leitungsteam", {
            tagId: id(),
            zusatz: ["telefon", "email", "foto"],
          }),
        ),
      ).ok,
    ).toBe(true);
    expect(fehler(dok(b("kontaktperson", {})))).not.toBeNull();
    expect(
      fehler(dok(b("kontaktperson", { personId: id(), zusatz: ["adresse"] }))),
    ).not.toBeNull();
    expect(
      fehler(
        dok(
          b("kontaktperson", {
            personId: id(),
            zusatz: ["telefon", "telefon"],
          }),
        ),
      ),
    ).not.toBeNull();
    // Name und Funktion stehen nicht im Baustein, sie kommen von der Person
    expect(
      fehler(dok(b("kontaktperson", { personId: id(), name: "x" }))),
    ).not.toBeNull();
    expect(fehler(dok(b("leitungsteam", {})))).not.toBeNull();
  });

  test("Stufenfakten haben keine eigenen Daten", () => {
    expect(
      fehler(dok(b("stufenfakten", { treffpunkt: "Wald" }))),
    ).not.toBeNull();
    expect(fehler(dok({ id: id(), typ: "stufenfakten" }))).not.toBeNull();
  });

  test("Sichtbarkeit: Tag-Menge geprüft wie im Fundament", () => {
    const mit = (sichtbarkeit: unknown) =>
      dok(b("trenner", { art: "linie" }, { sichtbarkeit }));
    expect(fehler(mit("oeffentlich"))).not.toBeNull();
    expect(fehler(mit({ art: "geheim" }))).not.toBeNull();
    expect(fehler(mit({ art: "tags", tagIds: ["x"] }))).not.toBeNull();
    const t = id();
    expect(fehler(mit({ art: "tags", tagIds: [t, t] }))).not.toBeNull();
    expect(fehler(mit({ art: "oeffentlich", tagIds: [t] }))).not.toBeNull();
  });
});

describe("sammleVerweise", () => {
  test("findet Medien, Tags, Personen und Seiten ohne Doppelte", () => {
    const [m1, m2, m3, t1, t2, t3, p1] = Array.from({ length: 7 }, id);
    const d = gueltig(
      b("bild", { mediumId: m1 }),
      b("bild", { mediumId: m1 }),
      b("galerie", { bilder: [{ mediumId: m2 }] }),
      b("datei", { mediumId: m3 }),
      b("leitungsteam", { tagId: t1 }),
      b("terminliste", { tagId: t2, anzahl: 3 }),
      b("terminliste", { anzahl: 3 }),
      b("kontaktperson", { personId: p1 }),
      b(
        "trenner",
        { art: "linie" },
        { sichtbarkeit: { art: "tags", tagIds: [t3, t1] } },
      ),
      b("schaltflaeche", {
        darstellung: "link",
        beschriftung: "a",
        ziel: "/stufen/woelfe#x",
      }),
      b("karten", {
        darstellung: "liste",
        eintraege: [
          { titel: "t", link: "/stufen/woelfe" },
          { titel: "u", link: "https://www.beispiel.ch" },
        ],
      }),
      b("text", {
        inhalt: [
          absatz("x", { link: "/ueber-uns" }),
          {
            typ: "liste",
            geordnet: false,
            eintraege: [
              [
                { text: "y", link: "mailto:a@b.ch" },
                { text: "z", link: "/" },
              ],
            ],
          },
        ],
      }),
      b("stufenfakten", {}),
    );
    const v = sammleVerweise(d);
    expect(new Set(v.medien)).toEqual(new Set([m1, m2, m3]));
    expect(v.medien).toHaveLength(3);
    expect(new Set(v.tags)).toEqual(new Set([t1, t2, t3]));
    expect(v.tags).toHaveLength(3);
    expect(v.personen).toEqual([p1]);
    expect(new Set(v.seiten)).toEqual(
      new Set(["/stufen/woelfe", "/ueber-uns", "/"]),
    );
    expect(v.seiten).toHaveLength(3);
  });

  test("leeres Dokument hat keine Verweise", () => {
    expect(sammleVerweise(gueltig())).toEqual({
      medien: [],
      tags: [],
      personen: [],
      seiten: [],
    });
  });

  // Eigenschaftstest ohne Zusatzpaket: Zufallsdokumente mit festem Startwert; die erwarteten Verweise entstehen beim Bauen, unabhängig vom Sammler
  test("Eigenschaft: jede Referenz eines Zufallsdokuments wird gefunden", () => {
    let seed = 20261122;
    const zufall = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const waehle = <T>(a: readonly T[]) => a[Math.floor(zufall() * a.length)]!;
    const SEITEN = [
      "/",
      "/stufen",
      "/stufen/woelfe",
      "/anlaesse/sommerlager-2027",
      "/ueber-uns",
    ];

    for (let lauf = 0; lauf < 200; lauf++) {
      const erwartet = {
        medien: new Set<string>(),
        tags: new Set<string>(),
        personen: new Set<string>(),
        seiten: new Set<string>(),
      };
      const medium = () => {
        const x = id();
        erwartet.medien.add(x);
        return x;
      };
      const tag = () => {
        const x = id();
        erwartet.tags.add(x);
        return x;
      };
      const seitenLink = () => {
        const s = waehle(SEITEN);
        erwartet.seiten.add(s);
        return zufall() < 0.5 ? s : `${s}#anker`;
      };
      const sicht = () => {
        const r = zufall();
        if (r < 0.5) return {};
        if (r < 0.75) return { sichtbarkeit: { art: "angemeldet" } };
        return { sichtbarkeit: { art: "tags", tagIds: [tag(), tag()] } };
      };
      const bausteine = Array.from(
        { length: Math.floor(zufall() * 15) },
        () => {
          switch (Math.floor(zufall() * 9)) {
            case 0:
              return b("bild", { mediumId: medium() }, sicht());
            case 1:
              return b(
                "galerie",
                {
                  bilder: Array.from(
                    { length: 1 + Math.floor(zufall() * 4) },
                    () => ({ mediumId: medium() }),
                  ),
                },
                sicht(),
              );
            case 2:
              return b("datei", { mediumId: medium() }, sicht());
            case 3: {
              const p = id();
              erwartet.personen.add(p);
              return b("kontaktperson", { personId: p }, sicht());
            }
            case 4:
              return b("leitungsteam", { tagId: tag() }, sicht());
            case 5:
              return b(
                "terminliste",
                zufall() < 0.5 ? { anzahl: 4 } : { anzahl: 4, tagId: tag() },
                sicht(),
              );
            case 6:
              return b(
                "schaltflaeche",
                { darstellung: "link", beschriftung: "x", ziel: seitenLink() },
                sicht(),
              );
            case 7:
              return b(
                "karten",
                {
                  darstellung: "liste",
                  eintraege: [
                    { titel: "a", link: seitenLink() },
                    { titel: "b" },
                  ],
                },
                sicht(),
              );
            default:
              return b(
                "text",
                {
                  inhalt: [
                    absatz("x", { link: seitenLink() }),
                    {
                      typ: "liste",
                      geordnet: true,
                      eintraege: [[{ text: "y", link: seitenLink() }]],
                    },
                  ],
                },
                sicht(),
              );
          }
        },
      );
      const v = sammleVerweise(gueltig(...bausteine));
      expect(new Set(v.medien)).toEqual(erwartet.medien);
      expect(new Set(v.tags)).toEqual(erwartet.tags);
      expect(new Set(v.personen)).toEqual(erwartet.personen);
      expect(new Set(v.seiten)).toEqual(erwartet.seiten);
      // ohne Doppelte
      expect(v.medien).toHaveLength(erwartet.medien.size);
      expect(v.seiten).toHaveLength(erwartet.seiten.size);
    }
  });
});
