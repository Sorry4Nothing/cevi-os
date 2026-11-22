import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { bausteinSchema, MERKMAL_SYMBOLE } from "../src/website/bausteine.js";
import { pruefeDokument, sammleVerweise } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereSeite,
  type Daten,
  type Kontext,
} from "../src/website/rendern.js";

// Gestaltung der Website (#555): Abschnitte über die ganze Breite, Merkmale, Stufenkarten, Aufruf, Kontaktkarte, Umschalter

const id = () => randomUUID();
const b = (typ: string, daten: unknown) => ({
  id: id(),
  typ,
  daten,
  sichtbarkeit: "erbt",
});
const dok = (titel: string, ...bausteine: unknown[]) => {
  const p = pruefeDokument({ v: 1, titel, bausteine });
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const absatz = (t: string) =>
  b("text", { inhalt: [{ typ: "absatz", inhalt: [{ text: t }] }] });
const h2 = (t: string) => b("ueberschrift", { ebene: 2, text: t });
const kontext = (daten: Daten = keineDaten()): Kontext => ({
  abteilung: "Cevi Beispielstadt",
  basisUrl: "https://www.example.org",
  navigation: [],
  daten,
});
const seite = (d: ReturnType<typeof dok>, daten?: Daten, pfad = "/seite") =>
  rendereSeite({ id: id(), pfad, dokument: d }, kontext(daten));
const zaehle = (t: string, teil: string) => t.split(teil).length - 1;
const bild = (altText: string | null = "Kinder im Wald") => ({
  mimeTyp: "image/webp",
  groesse: 1,
  breite: 1264,
  hoehe: 948,
  altText,
});

describe("Abschnitte über die ganze Breite", () => {
  const abschnitte = (html: string) =>
    [...html.matchAll(/<section class="sektion ([^"]*)"/g)].map((m) => m[1]);

  test("jede Überschrift der Ebene 2 beginnt einen Abschnitt; Text auf Text bleibt auf der Fläche und trennt sich mit einer Linie", () => {
    const html = seite(
      dok(
        "T",
        h2("Eins"),
        absatz("a"),
        h2("Zwei"),
        absatz("b"),
        h2("Drei"),
        absatz("c"),
      ),
    );
    expect(abschnitte(html)).toEqual([
      "sektion--flaeche sektion--text",
      "sektion--flaeche sektion--folge sektion--text",
      "sektion--flaeche sektion--folge sektion--text",
    ]);
    // Der Inhalt steht in der fliessenden Spalte, der Hintergrund liegt ausserhalb
    expect(html).toMatch(/<section class="sektion[^"]*">\n<div class="wrap">/);
  });

  test("der Ton wechselt, wo die Art wechselt: Bildkarten heben sich ab, nach einem Band beginnt die Fläche neu", () => {
    const termine = b("terminliste", { anzahl: 3 });
    const stufen = () =>
      b("karten", {
        darstellung: "stufen",
        eintraege: [{ titel: "A" }],
      });
    const html = seite(
      dok(
        "T",
        absatz("Einstieg"),
        h2("Merkmale"),
        b("karten", { darstellung: "merkmale", eintraege: [{ titel: "A" }] }),
        h2("Gruppen"),
        stufen(),
        b("aufruf", { titel: "Los", beschriftung: "Los", ziel: "/los" }),
        termine,
        h2("Text"),
        absatz("x"),
        h2("Noch mehr Gruppen"),
        stufen(),
      ),
      { ...keineDaten(), termine: new Map([[termine.id, []]]) },
    );
    expect(abschnitte(html)).toEqual([
      "sektion--flaeche sektion--text sektion--einstieg",
      "sektion--flaeche sektion--folge sektion--text",
      "sektion--toenung sektion--breit",
      "sektion--aufruf",
      "sektion--flaeche sektion--terminliste",
      "sektion--flaeche sektion--folge sektion--text",
      "sektion--toenung sektion--breit",
    ]);
  });

  test("Merkmale stehen als Zeilen neben dem Titel, Bildkarten unter dem Titel über die ganze Breite; ein kurzer Text davor gehört zum Titel", () => {
    const html = seite(
      dok(
        "T",
        h2("Karten"),
        absatz("Lead"),
        b("karten", {
          darstellung: "merkmale",
          eintraege: [{ titel: "A" }],
        }),
        h2("Stufen"),
        absatz("Lead 2"),
        b("karten", { darstellung: "stufen", eintraege: [{ titel: "B" }] }),
      ),
    );
    expect(abschnitte(html)).toEqual([
      "sektion--flaeche sektion--text",
      "sektion--toenung sektion--breit",
    ]);
    // Der Lead steht im Kopf des Abschnitts, nicht bei den Karten
    expect(html).toMatch(
      /<div class="sektion-kopf">\n<h2 id="karten">Karten<\/h2>\n<div class="text lesetext"><p>Lead<\/p><\/div>\n<\/div>\n<div class="sektion-rumpf">\n<ul class="merkmale">/,
    );
    expect(html).toMatch(
      /<div class="sektion-kopf">\n<h2 id="stufen">Stufen<\/h2>\n<div class="text lesetext"><p>Lead 2<\/p><\/div>\n<\/div>\n<div class="sektion-rumpf">\n<ul class="stufenkarten">/,
    );
  });

  test("Hinweis und Aufruf sind eigene Bänder, Termine und Kontaktkarte eigene Abschnitte", () => {
    const termine = b("terminliste", { anzahl: 3 });
    const html = seite(
      dok(
        "T",
        b("hinweis", { text: "Anmeldung offen" }),
        b("aufruf", {
          titel: "Schnuppern",
          beschriftung: "Anmelden",
          ziel: "/mitmachen",
        }),
        termine,
      ),
      { ...keineDaten(), termine: new Map([[termine.id, []]]) },
    );
    expect(html).toContain('<section class="sektion sektion--hinweis">');
    expect(html).toContain('<section class="sektion sektion--aufruf">');
    expect(html).toContain("sektion--terminliste");
  });

  test("nach der Kontaktkarte folgende Bausteine bis zur nächsten Überschrift bleiben in ihrem Abschnitt", () => {
    const html = seite(
      dok(
        "T",
        b("kontaktkarte", { titel: "Fragen?" }),
        absatz("Weitere Links"),
        h2("Danach"),
      ),
      {
        ...keineDaten(),
        kontakt: { email: "info@example.org" },
      },
    );
    const abschnitt = html.split('<section class="sektion ')[1]!;
    expect(abschnitt).toContain("Weitere Links");
    expect(abschnitt).not.toContain("Danach");
  });

  test("die Spalte ist fliessend und bis 1680 px breit, der Hintergrund geht bis zum Rand", () => {
    const css = readFileSync(
      new URL("../public/website/website.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.wrap \{\s*max-width: 105rem;/);
    expect(css).toContain("--rand: clamp(1rem, 4vw, 4.5rem)");
    expect(css).not.toMatch(/\.wrap \{\s*max-width: 76rem/);
  });
});

describe("Merkmale (Baustein «Karten»)", () => {
  test("Symbol, Titel und Text ohne Link; der Link der Eingabe erscheint nie", () => {
    const html = seite(
      dok(
        "T",
        h2("Das erwartet dich"),
        b("karten", {
          darstellung: "merkmale",
          eintraege: [
            {
              titel: "Lager",
              text: "Zweimal im Jahr.",
              symbol: "zelt",
              link: "/lager",
            },
            { titel: "Ohne Symbol" },
          ],
        }),
      ),
    );
    expect(html).toContain(
      '<ul class="merkmale"><li><span class="merkmal-symbol"><svg class="i"',
    );
    expect(html).toContain(
      '<h3 class="titel">Lager</h3><p>Zweimal im Jahr.</p>',
    );
    expect(html).toContain('<li><h3 class="titel">Ohne Symbol</h3></li>');
    expect(html).not.toContain('href="/lager"');
  });

  test("Schema: nur bekannte Symbole", () => {
    const ok = (symbol: string) =>
      bausteinSchema.safeParse(
        b("karten", {
          darstellung: "merkmale",
          eintraege: [{ titel: "A", symbol }],
        }),
      ).success;
    for (const s of MERKMAL_SYMBOLE) expect(ok(s)).toBe(true);
    expect(ok("<script>")).toBe(false);
    expect(ok("")).toBe(false);
  });
});

describe("Stufenkarten (Baustein «Karten»)", () => {
  const foto = id();
  const daten = (): Daten => ({
    ...keineDaten(),
    medien: new Map([[foto, bild("Gruppe im Wald")]]),
  });
  const eintraege = [
    {
      titel: "Stufe Bienli",
      alter: "Kindergarten bis 2. Klasse",
      text: "Mädchen und Jungs",
      link: "/gruppen/bienli",
      bild: foto,
    },
    { titel: "Stufe Ohne", alter: "Ältere" },
  ];
  const html = () =>
    seite(
      dok(
        "T",
        h2("Gruppen"),
        b("karten", { darstellung: "stufen", eintraege }),
      ),
      daten(),
    );

  test("Foto oben mit Alterschip, ein Link im Titel (er deckt per CSS die ganze Karte ab), kein Link sonst", () => {
    const h = html();
    expect(h).toContain(
      '<li class="stufe stufe--link"><div class="stufe-bild">',
    );
    expect(h).toContain(
      `<img src="/api/v1/medien/${foto}" alt="Gruppe im Wald"`,
    );
    expect(h).toContain(
      '<span class="alterschip">Kindergarten bis 2. Klasse</span>',
    );
    expect(h).toContain(
      '<h3 class="titel"><a href="/gruppen/bienli">Stufe Bienli</a></h3>',
    );
    // Genau ein Link je Karte; die Karte ohne Link hat keinen
    expect(zaehle(h, 'href="/gruppen/bienli"')).toBe(1);
    expect(h).toContain(
      '<li class="stufe"><div class="stufe-bild stufe-bild--leer">',
    );
    expect(h).toContain('<h3 class="titel">Stufe Ohne</h3>');
  });

  test("das Foto steht nie im Link und der Pfeil ist nur Zierde", () => {
    const h = html();
    expect(h).not.toMatch(/<a[^>]*>[^<]*<img/);
    expect(h).toContain('class="stufe-pfeil" aria-hidden="true"');
  });

  test("Schema: Foto ist eine Medien-ID, der Chip hat eine Obergrenze; das Foto zählt als Verweis", () => {
    const ok = (e: object) =>
      bausteinSchema.safeParse(
        b("karten", {
          darstellung: "stufen",
          eintraege: [{ titel: "A", ...e }],
        }),
      ).success;
    expect(ok({ bild: foto })).toBe(true);
    expect(ok({ bild: "kein-uuid" })).toBe(false);
    expect(ok({ alter: "x".repeat(41) })).toBe(false);
    const d = dok("T", b("karten", { darstellung: "stufen", eintraege }));
    expect(sammleVerweise(d).medien).toEqual([foto]);
    expect(sammleVerweise(d).seiten).toEqual(["/gruppen/bienli"]);
  });

  test("ein Foto, das kein Bild ist, entfällt: Fläche in der Farbe der Stufe", () => {
    const pdf = id();
    const h = seite(
      dok(
        "T",
        h2("G"),
        b("karten", {
          darstellung: "stufen",
          eintraege: [{ titel: "A", bild: pdf }],
        }),
      ),
      {
        ...keineDaten(),
        medien: new Map([[pdf, { ...bild(), mimeTyp: "application/pdf" }]]),
      },
    );
    expect(h).toContain("stufe-bild--leer");
    expect(h).not.toContain("<img");
  });
});

describe("Aufruf zum Handeln", () => {
  test("Titel, Text und eine weisse Schaltfläche; die Ebene folgt auf die letzte", () => {
    const html = seite(
      dok(
        "T",
        b("aufruf", {
          titel: "Schnuppern im Cevi",
          text: "Jederzeit möglich.",
          beschriftung: "Zur Anmeldung",
          ziel: "/mitmachen/anmeldung",
        }),
      ),
    );
    expect(html).toContain(
      '<div class="aufruf"><div class="aufruf-text"><h2>Schnuppern im Cevi</h2><p>Jederzeit möglich.</p></div><a href="/mitmachen/anmeldung" class="btn w gross">Zur Anmeldung<svg',
    );
  });

  test("Schema: Titel, Beschriftung und Ziel sind Pflicht, das Ziel eine erlaubte Adresse", () => {
    const ok = (d: object) => bausteinSchema.safeParse(b("aufruf", d)).success;
    const voll = { titel: "T", beschriftung: "B", ziel: "/start" };
    expect(ok(voll)).toBe(true);
    expect(ok({ ...voll, ziel: "javascript:alert(1)" })).toBe(false);
    expect(ok({ titel: "T", beschriftung: "B" })).toBe(false);
    expect(ok({ ...voll, extra: 1 })).toBe(false);
    expect(sammleVerweise(dok("T", b("aufruf", voll))).seiten).toEqual([
      "/start",
    ]);
  });
});

describe("Umschalter Hell und Dunkel (theme.js)", () => {
  const skript = readFileSync(
    new URL("../public/website/theme.js", import.meta.url),
    "utf8",
  );

  // Kleinste Umgebung, in der das Skript läuft: Wurzelelement, Speicher, matchMedia und zwei Knöpfe
  function lauf({
    gespeichert,
    systemDunkel,
  }: {
    gespeichert?: string;
    systemDunkel: boolean;
  }) {
    const speicher = new Map<string, string>(
      gespeichert ? [["cevi-darstellung", gespeichert]] : [],
    );
    const wurzel = {
      attr: new Map<string, string>(),
      setAttribute(n: string, w: string) {
        this.attr.set(n, w);
      },
      removeAttribute(n: string) {
        this.attr.delete(n);
      },
    };
    const knopf = (wert: string) => {
      const attr = new Map<string, string>([["data-thema", wert]]);
      const klick: ((e: unknown) => void)[] = [];
      return {
        attr,
        getAttribute: (n: string) => attr.get(n) ?? null,
        setAttribute: (n: string, w: string) => attr.set(n, w),
        addEventListener: (_: string, f: (e: unknown) => void) => klick.push(f),
        klick() {
          klick.forEach((f) => f({ currentTarget: this }));
        },
      };
    };
    const knoepfe = [knopf("light"), knopf("dark")];
    const gruppe = {
      hidden: true,
      querySelectorAll: () => knoepfe,
    };
    let bereit: () => void = () => {};
    runInNewContext(skript, {
      document: {
        documentElement: wurzel,
        addEventListener: (_: string, f: () => void) => (bereit = f),
        // Das Skript sucht alle Gruppen und alle Knöpfe im Dokument (Band und Menü, #558)
        querySelectorAll: (auswahl: string) =>
          auswahl.includes("button") ? knoepfe : [gruppe],
      },
      window: {
        localStorage: {
          getItem: (k: string) => speicher.get(k) ?? null,
          setItem: (k: string, v: string) => speicher.set(k, v),
        },
        matchMedia: () => ({
          matches: systemDunkel,
          addEventListener: () => {},
        }),
        addEventListener: () => {},
      },
    });
    const vorher = new Map(wurzel.attr);
    bereit();
    return { speicher, wurzel, knoepfe, gruppe, vorher };
  }
  const gedrueckt = (k: { attr: Map<string, string> }) =>
    k.attr.get("aria-pressed");

  test("ohne Wahl folgt die Seite dem System: der passende Knopf ist markiert, nichts ist gespeichert, data-theme fehlt", () => {
    const hell = lauf({ systemDunkel: false });
    expect(hell.wurzel.attr.has("data-theme")).toBe(false);
    expect(hell.speicher.size).toBe(0);
    expect(hell.knoepfe.map(gedrueckt)).toEqual(["true", "false"]);
    expect(hell.gruppe.hidden).toBe(false);
    const dunkel = lauf({ systemDunkel: true });
    expect(dunkel.knoepfe.map(gedrueckt)).toEqual(["false", "true"]);
    expect(dunkel.speicher.size).toBe(0);
  });

  test("ein Klick setzt data-theme, markiert den Knopf und speichert die Wahl", () => {
    const l = lauf({ systemDunkel: false });
    l.knoepfe[1]!.klick();
    expect(l.wurzel.attr.get("data-theme")).toBe("dark");
    expect(l.speicher.get("cevi-darstellung")).toBe("dark");
    expect(l.knoepfe.map(gedrueckt)).toEqual(["false", "true"]);
    l.knoepfe[0]!.klick();
    expect(l.wurzel.attr.get("data-theme")).toBe("light");
    expect(l.speicher.get("cevi-darstellung")).toBe("light");
  });

  test("eine gespeicherte Wahl gilt schon vor dem ersten Zeichnen und gegen das System", () => {
    const l = lauf({ gespeichert: "light", systemDunkel: true });
    expect(l.vorher.get("data-theme")).toBe("light");
    expect(l.knoepfe.map(gedrueckt)).toEqual(["true", "false"]);
  });

  test("ein unbekannter gespeicherter Wert wird ignoriert", () => {
    const l = lauf({ gespeichert: "system", systemDunkel: false });
    expect(l.wurzel.attr.has("data-theme")).toBe(false);
  });
});
