import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { erzeugeWebsite } from "../src/website/abgleich.js";
import { dateisystemAusgabe, type Ausgabe } from "../src/website/ausgabe.js";
import { bausteinSchema } from "../src/website/bausteine.js";
import { pruefeDokument } from "../src/website/dokument.js";
import {
  keineDaten,
  rendereSeite,
  type Daten,
  type Kontext,
  type NavPunkt,
  type TerminEintrag,
} from "../src/website/rendern.js";
import { rendereFehlerseite } from "../src/website/fehlerseiten.js";
import {
  DATENPLAN,
  ladeDatenplan,
  ladeTerminlisten,
} from "../src/website/termine-liste.js";
import { DATENPLAN_DATEI } from "../src/website/termine-seiten.js";
import { API_URL } from "./hilfen/datenbank.js";

// Darstellung nach dem Design «Cevi Web» (#549): Stufenkarten, Termin-Liste, Hinweisband, Kontaktkarte, Titelbild, Navigation in einer Zeile, Fuss

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
const nav = (titel: string, kinder: NavPunkt[] = []): NavPunkt => ({
  pfad: `/${titel.toLowerCase().replaceAll(" ", "-")}`,
  titel,
  kinder,
});
const kontext = (daten: Daten = keineDaten(), navigation = [nav("Stufen")]) =>
  ({
    abteilung: "Cevi Beispielstadt",
    basisUrl: "https://www.example.org",
    navigation,
    daten,
  }) satisfies Kontext;
const seite = (d: ReturnType<typeof dok>, daten?: Daten, pfad = "/stufen") =>
  rendereSeite({ id: id(), pfad, dokument: d }, kontext(daten));
const zaehle = (t: string, teil: string) => t.split(teil).length - 1;

describe("Stufenkarten und Liste (Baustein «Karten»)", () => {
  const eintraege = [
    {
      titel: "Bienli",
      text: "Kindergarten bis 2. Klasse",
      link: "/stufen/bienli",
    },
    { titel: "Ohne Link" },
  ];

  test("«karten»: Name als Überschrift, Text, «Mehr zu …» nur mit Link; die Ebene folgt auf die letzte", () => {
    const html = seite(
      dok(
        "Stufen",
        b("ueberschrift", { ebene: 2, text: "Unsere Stufen" }),
        b("karten", { darstellung: "karten", eintraege }),
      ),
    );
    expect(html).toContain(
      '<ul class="karten"><li><h3 class="titel">Bienli</h3><p>Kindergarten bis 2. Klasse</p><p><a href="/stufen/bienli" class="mehr">Mehr zu Bienli</a></p></li>',
    );
    // Ohne Link kein «Mehr zu»; ein Titel ist nie ein Link
    expect(html).toContain('<li><h3 class="titel">Ohne Link</h3></li>');
    expect(html).not.toContain('<a href="/stufen/bienli">Bienli</a>');
  });

  test("«karten» ohne Überschrift davor springt nicht über eine Ebene (h2 nach dem h1)", () => {
    const html = seite(
      dok("Stufen", b("karten", { darstellung: "karten", eintraege })),
    );
    expect(html).toContain('<h2 class="titel">Bienli</h2>');
  });

  test("«liste»: eine Zeile je Eintrag mit Link am Titel", () => {
    const html = seite(
      dok("Stufen", b("karten", { darstellung: "liste", eintraege })),
    );
    expect(html).toContain(
      '<ul class="liste"><li><p class="titel"><a href="/stufen/bienli">Bienli</a></p>',
    );
  });
});

describe("Hinweisband", () => {
  test("Symbol, Satz und Link; der Link muss eine erlaubte Adresse sein", () => {
    const html = seite(
      dok(
        "T",
        b("hinweis", {
          text: "Anmeldung offen bis 15. März",
          link: { beschriftung: "Zum Lager", ziel: "/anlaesse/lager" },
        }),
      ),
    );
    expect(html).toContain('<div class="band hinweisband" role="status"><svg');
    expect(html).toContain(
      '<div class="text"><strong>Anmeldung offen bis 15. März</strong><a href="/anlaesse/lager" class="verweis">Zum Lager</a></div>',
    );
  });

  test("Schema: Text Pflicht, Link nur mit Beschriftung und erlaubtem Ziel", () => {
    const ok = (daten: unknown) =>
      bausteinSchema.safeParse(b("hinweis", daten)).success;
    expect(ok({ text: "Satz" })).toBe(true);
    expect(ok({})).toBe(false);
    expect(
      ok({
        text: "Satz",
        link: { beschriftung: "x", ziel: "javascript:alert(1)" },
      }),
    ).toBe(false);
    expect(ok({ text: "Satz", link: { ziel: "/start" } })).toBe(false);
    expect(ok({ text: "Satz", zusatz: 1 })).toBe(false);
  });
});

describe("Kontaktkarte", () => {
  const daten = (): Daten => {
    const personId = id();
    return {
      ...keineDaten(),
      personen: new Map([
        [personId, { name: "Mara Muster", funktion: "Abteilungsleitung" }],
      ]),
      kontakt: {
        telefon: "043 543 96 82",
        email: "info@example.org",
        adresse: "Beispielweg 1, 8000 Beispielstadt",
      },
    };
  };

  test("Frage, Ansprechperson, E-Mail als Hauptaktion und Anrufen als zweite Möglichkeit, dazu die Angaben zum Nachlesen (#580)", () => {
    const d = daten();
    const personId = [...d.personen.keys()][0]!;
    const html = seite(dok("T", b("kontaktkarte", { personId })), d);
    expect(html).toContain("<h2>Fragen? Melde dich bei uns.</h2>");
    expect(html).toContain(
      '<p class="kontakt-person">Mara Muster, Abteilungsleitung</p>',
    );
    // Eine Hauptaktion (rot), die zweite Möglichkeit mit Rand: Knöpfe des Repertoires, nie ein eigener Knopf
    expect(html).toContain(
      '<div class="knopfreihe aktionen"><a href="mailto:info@example.org" class="btn p gross">E-Mail schreiben</a><a href="tel:+41435439682" class="btn s gross">Anrufen</a></div>',
    );
    // Die Angaben sind ganze Zeilen mit Symbol, Art und Wert: E-Mail und Telefon als Link, die Anschrift ohne Link; in dieser Reihenfolge (#605)
    expect(html).toContain('<address class="kontakt-angaben"><ul>');
    expect(html).toMatch(
      /<a href="mailto:info@example.org" class="kontakt-zeile"><span class="kontakt-symbol"><svg class="i"[^>]*aria-hidden="true">.*?<\/svg><\/span><span class="kontakt-text"><span class="kontakt-art">E-Mail<\/span> <span class="kontakt-wert">info@example\.org<\/span><\/span><span class="kontakt-pfeil">/,
    );
    expect(html).toContain(
      '<span class="kontakt-art">Telefon</span> <span class="kontakt-wert">043 543 96 82</span>',
    );
    expect(html).toContain('<a href="tel:+41435439682" class="kontakt-zeile">');
    expect(html).toContain(
      '<div class="kontakt-zeile"><span class="kontakt-symbol">',
    );
    expect(html).toContain(
      '<span class="kontakt-art">Anschrift</span> <span class="kontakt-wert">Beispielweg 1, 8000 Beispielstadt</span>',
    );
    const reihenfolge = [
      "E-Mail</span>",
      "Telefon</span>",
      "Anschrift</span>",
    ].map((w) => html.indexOf(`kontakt-art">${w}`));
    expect(reihenfolge).toEqual([...reihenfolge].sort((x, y) => x - y));
    expect(reihenfolge.every((i) => i > 0)).toBe(true);
    // Hinweis, Bild und Verweise sind freiwillig
    expect(html).not.toContain("kontakt-hinweis");
    expect(html).not.toContain("kontakt-bild");
    expect(html).not.toContain("kontakt-verweise");
    expect(html).toContain('<section class="kontaktkarte">');
  });

  test("ohne E-Mail ist das Telefon die Hauptaktion; fehlt beides, gibt es keine Knöpfe", () => {
    const nurTelefon = seite(dok("T", b("kontaktkarte", {})), {
      ...keineDaten(),
      kontakt: { telefon: "043 543 96 82" },
    });
    expect(nurTelefon).toContain('class="btn p gross">Anrufen</a>');
    expect(nurTelefon).not.toContain("E-Mail schreiben");
    const nurAdresse = seite(dok("T", b("kontaktkarte", {})), {
      ...keineDaten(),
      kontakt: { adresse: "Beispielweg 1" },
    });
    expect(nurAdresse).toContain('class="kontakt-angaben"');
    expect(nurAdresse).not.toContain('class="knopfreihe aktionen"');
  });

  test("ohne Telefonnummer steht die Karte mit E-Mail und Anschrift, ohne «Anrufen» und ohne leere Zeile (#605)", () => {
    const html = seite(dok("T", b("kontaktkarte", {})), {
      ...keineDaten(),
      kontakt: { email: "info@example.org", adresse: "Beispielweg 1" },
    });
    expect(html).toContain("E-Mail schreiben");
    expect(html).not.toContain("Anrufen");
    expect(html).not.toContain("Telefon");
    expect(html).not.toContain("tel:");
    expect(html.match(/class="kontakt-zeile"/g)).toHaveLength(2);
  });

  test("Hinweis zur Erreichbarkeit, Bild und Verweise: der fremde Link trägt Pfeil-Zusatz und rel, die Seite der Website nicht (#580)", () => {
    const medium = id();
    const html = seite(
      dok(
        "T",
        b("kontaktkarte", {
          hinweis: "Wir antworten, sobald wir können.",
          bild: medium,
          verweise: [
            { beschriftung: "Cevi Schweiz", ziel: "https://www.cevi.ch" },
            { beschriftung: "Mitmachen", ziel: "/mitmachen" },
          ],
        }),
      ),
      {
        ...daten(),
        medien: new Map([
          [
            medium,
            {
              mimeTyp: "image/webp",
              groesse: 10,
              breite: 1920,
              hoehe: 1280,
              altText: "Kinder auf einer Wiese",
            },
          ],
        ]),
      },
    );
    expect(html).toContain(
      '<p class="kontakt-hinweis">Wir antworten, sobald wir können.</p>',
    );
    expect(html).toContain('<section class="kontaktkarte kontaktkarte--bild">');
    expect(html).toContain(
      `<figure class="kontakt-bild"><img src="/api/v1/medien/${medium}" alt="Kinder auf einer Wiese" width="1920" height="1280" decoding="async"></figure>`,
    );
    // Steht die Karte weit unten, lädt das Bild erst beim Scrollen (loading="lazy", wie jedes Bild unterhalb des ersten Bildschirms); als erster Abschnitt lädt es sofort
    expect(html).toContain("<h3>Weitere Informationen</h3>");
    expect(html).toContain(
      '<a href="https://www.cevi.ch" rel="noopener noreferrer" class="verweis">Cevi Schweiz<span class="nur-sr"> (externe Seite)</span></a>',
    );
    expect(html).toContain(
      '<a href="/mitmachen" class="verweis">Mitmachen</a>',
    );
  });

  test("ein Bild, das nicht (mehr) da ist, entfällt: die Karte steht ohne Bild", () => {
    const html = seite(dok("T", b("kontaktkarte", { bild: id() })), daten());
    expect(html).not.toContain("kontakt-bild");
    expect(html).toContain('<section class="kontaktkarte">');
  });

  test("ohne Person und ohne Kontaktdaten entfällt die Karte", () => {
    expect(seite(dok("T", b("kontaktkarte", {})))).not.toContain(
      'class="kontaktkarte"',
    );
  });

  test("Telefon: Landesvorwahl bleibt, +41 steht für eine Nummer mit 0", () => {
    const mit = (telefon: string) =>
      seite(dok("T", b("kontaktkarte", {})), {
        ...keineDaten(),
        kontakt: { telefon },
      });
    expect(mit("+49 30 123456")).toContain('href="tel:+4930123456"');
    expect(mit("0041 43 000 00 00")).toContain('href="tel:+41430000000"');
  });
});

describe("Termin-Liste", () => {
  const termin = (extra: Partial<TerminEintrag> = {}): TerminEintrag => ({
    id: id(),
    titel: "Waldspiel",
    von: "2027-02-06",
    bis: "2027-02-06",
    zeitVon: "14:00",
    zeitBis: "17:00",
    ort: "Pfadiheim Beispielwald",
    stufen: ["Wölfe", "Adler"],
    anlassId: null,
    ...extra,
  });
  const mitTermine = (liste: TerminEintrag[], anzahl = 5) => {
    const baustein = b("terminliste", { anzahl });
    return seite(dok("T", baustein), {
      ...keineDaten(),
      termine: new Map([[baustein.id, liste]]),
    });
  };

  test("Datumsfeld, Titel, Zeit und Ort, Chips der Stufen, Link «Alle Termine»", () => {
    const html = mitTermine([termin()]);
    expect(html).toContain(
      '<div class="abschnitt-kopf"><h2>Das steht an</h2><a class="btn s" href="/termine">Alle Termine</a></div>',
    );
    expect(html).toContain(
      '<span class="datum" aria-hidden="true"><span class="tag">Sa</span><span class="nr">6</span><span class="mo">Feb.</span></span>',
    );
    expect(html).toContain('<span class="titel">Waldspiel</span>');
    expect(html).toContain('<span class="termin-text">');
    expect(html).toContain(
      '<span class="meta">14:00–17:00 · Pfadiheim Beispielwald</span>',
    );
    expect(html).toContain(
      '<span class="chips"><span class="chip st">Wölfe</span><span class="chip st">Adler</span></span>',
    );
  });

  test("ohne Anlass keine Verknüpfung; mit Anlass ein Link auf die Anlassseite mit vollem Namen für Screenreader", () => {
    const anlassId = id();
    expect(mitTermine([termin()])).toContain('<div class="termin">');
    const html = mitTermine([termin({ anlassId })]);
    expect(html).toContain(`<a class="termin" href="/anlass?id=${anlassId}"`);
    expect(html).toContain(
      'aria-label="Samstag, 6. Februar, Waldspiel, 14:00–17:00 · Pfadiheim Beispielwald, für Wölfe, Adler"',
    );
  });

  test("ganztägig, mehrtägig, Mai ohne Punkt, ohne Ort und ohne Stufen", () => {
    const html = mitTermine([
      termin({
        von: "2027-05-01",
        bis: "2027-05-01",
        zeitVon: null,
        zeitBis: null,
        ort: null,
        stufen: [],
      }),
      termin({
        von: "2027-07-24",
        bis: "2027-08-02",
        zeitVon: null,
        zeitBis: null,
      }),
    ]);
    expect(html).toContain('<span class="mo">Mai</span>');
    expect(html).toContain('<span class="meta">ganztägig</span>');
    expect(html).toContain("bis 2. August 2027 · Pfadiheim Beispielwald");
    expect(zaehle(html, 'class="chips"')).toBe(1);
  });

  test("zeigt höchstens «anzahl» Termine; leer: Hinweis statt Liste", () => {
    const viele = Array.from({ length: 6 }, (_, i) =>
      termin({ titel: `T${i}` }),
    );
    expect(zaehle(mitTermine(viele, 3), '<li><div class="termin">')).toBe(3);
    expect(mitTermine([])).toContain(
      "Im Moment sind keine Termine eingetragen.",
    );
  });

  test("Termine als Text: nichts wird ungeprüft ins Markup übernommen", () => {
    const html = mitTermine([
      termin({ titel: '<img src=x onerror="a">', ort: "<b>", stufen: ["<i>"] }),
    ]);
    expect(html).not.toMatch(/<img src=x|· <b>|<i>/);
    expect(html).toContain("&lt;img src=x onerror=&quot;a&quot;&gt;");
  });

  test("ohne geladene Daten (zum Beispiel in der Vorschau) entfällt der Baustein", () => {
    expect(seite(dok("T", b("terminliste", { anzahl: 5 })))).not.toContain(
      "Das steht an",
    );
  });
});

describe("Titelbild", () => {
  const medium = () => ({
    mimeTyp: "image/webp",
    groesse: 1,
    breite: 1264,
    hoehe: 379,
    altText: "Wald",
  });
  const mit = (...ids: string[]) => ({
    ...keineDaten(),
    medien: new Map(ids.map((m) => [m, medium()])),
  });
  const absatz = (t: string) =>
    b("text", { inhalt: [{ typ: "absatz", inhalt: [{ text: t }] }] });

  test("Startseite: das erste Bild geht bis zum Fensterrand, das Teaser-Feld überlappt es", () => {
    const a = id();
    const html = seite(
      dok("Start", b("bild", { mediumId: a }), absatz("Hallo")),
      mit(a),
      "/",
    );
    expect(html).toMatch(
      new RegExp(
        `<main[^>]*>\\n<div class="hero"><figure class="titelbild"><img src="/api/v1/medien/${a}"[^>]*fetchpriority="high"[^>]*></figure>\\n<section class="teaser teaser--ueber-bild"`,
      ),
    );
    // Das Titelbild lädt sofort und mit Vorrang
    expect(html).not.toContain('loading="lazy"');
    // Der Titel steht in der Fahne, der Text daneben; kein Etikett über dem Titel
    expect(html).toContain(
      '<div class="fahne"><h1 id="h1">Start</h1></div>\n<div class="teaser-text"><div class="text lesetext"><p>Hallo</p></div></div>',
    );
    expect(html).not.toContain("kicker");
  });

  test("ein Bild ohne Text: Titelbild mit dem Seitentitel in der Fahne, auf der Startseite und auf jeder anderen Seite", () => {
    const a = id();
    for (const pfad of ["/", "/seite"]) {
      const html = seite(
        dok("Start", b("bild", { mediumId: a })),
        mit(a),
        pfad,
      );
      expect(html).not.toContain('class="teaser');
      expect(html).toMatch(
        /<div class="hero hero--seite"><figure class="titelbild"><img [^>]*fetchpriority="high"[^>]*><\/figure>\n<div class="seitenband seitenband--ueber-bild"><div class="wrap"><div class="fahne"><h1>Start<\/h1><\/div><\/div><\/div><\/div>/,
      );
      expect(zaehle(html, "<h1")).toBe(1);
    }
  });

  test("ohne Bild steht der Seitentitel allein im Band", () => {
    const html = seite(dok("Start", absatz("Hallo")), mit(), "/seite");
    expect(html).toContain(
      '<div class="seitenband"><div class="wrap"><h1>Start</h1></div></div>',
    );
    expect(html).not.toContain("fahne");
  });

  test("jede Seite: das erste Bild ist das Titelbild vor dem Seitentitel, ein zweites steht im Inhalt", () => {
    const [a, f] = [id(), id()];
    const html = seite(
      dok("Seite", b("bild", { mediumId: a }), b("bild", { mediumId: f })),
      mit(a, f),
      "/seite",
    );
    expect(zaehle(html, 'class="titelbild"')).toBe(1);
    expect(html.indexOf("titelbild")).toBeLessThan(html.indexOf("seitenband"));
    expect(html).toContain(`<img src="/api/v1/medien/${f}"`);
  });

  test("Bilder oberhalb der Falz laden sofort, ab dem vierten Abschnitt erst beim Scrollen", () => {
    const ids = [id(), id(), id(), id(), id()];
    const abschnitte = ids.flatMap((m, i) => [
      b("ueberschrift", { ebene: 2, text: `Abschnitt ${i}` }),
      b("bild", { mediumId: m }),
    ]);
    const html = seite(dok("Seite", ...abschnitte), mit(...ids), "/seite");
    const lazy = (m: string) =>
      new RegExp(`<img src="/api/v1/medien/${m}"[^>]*loading="lazy"`).test(
        html,
      );
    expect(ids.map(lazy)).toEqual([false, false, false, true, true]);
    // Das Seitenverhältnis steht im Markup, damit nichts springt
    expect(html).toContain('width="1264" height="379"');
  });
});

describe("Navigation in einer Zeile", () => {
  const acht = [
    nav("Start"),
    nav("Über den Cevi", [nav("Was ist Cevi")]),
    nav("Über den Cevi Stäfa-Hombi"),
    nav("Mitmachen"),
    nav("Unsere Gruppen", [nav("Bienli"), nav("Wölfe")]),
    nav("Cevi-Anlässe"),
    nav("Fotos"),
    nav("Dokumente", [nav("Statuten")]),
  ];
  const html = rendereFehlerseite(kontext(keineDaten(), acht));
  const leiste = html.slice(
    html.indexOf('<nav class="hauptnav"'),
    html.indexOf("</nav>"),
  );

  // Aufteilung der Zeile, Untermenüs und «Mehr»: test/website-kopf.test.ts (#558)
  test("die Navigation steht in der Hülle jeder Seite", () => {
    expect(leiste).toContain(">Unsere Gruppen</a>");
  });

  test("wenige Punkte: kein «Mehr»", () => {
    const kurz = rendereFehlerseite(
      kontext(keineDaten(), [nav("Start"), nav("Stufen")]),
    );
    expect(kurz).not.toContain("<summary>Mehr</summary>");
  });

  test("auch bei einem einzigen, sehr langen Titel steht mindestens ein Punkt in der Leiste", () => {
    const lang = rendereFehlerseite(
      kontext(keineDaten(), [nav("x".repeat(120)), nav("Zwei")]),
    );
    expect(lang).toContain(`<li><a href="/${"x".repeat(120)}">`);
  });

  test("Skript nur als Verbesserung: eigene Datei, Meta-CSP mit script-src und font-src, nie inline", () => {
    expect(html).toContain(
      '<script type="module" src="/website/menue.js"></script>',
    );
    expect(html).toMatch(
      /script-src &#39;self&#39;; style-src &#39;self&#39;; font-src &#39;self&#39;/,
    );
    // Verbinden darf der Kopf wegen des Konto-Menüs (konto-menue.js, #669), nur zur eigenen Herkunft
    expect(html).toContain("connect-src &#39;self&#39;");
    expect(html).not.toMatch(/<script(?![^>]* src=)/);
  });
});

describe("Fuss (#580)", () => {
  const fuss = (daten: Daten, rest: Partial<Kontext> = {}) =>
    rendereFehlerseite({ ...kontext(daten), ...rest }).split(
      '<footer class="fuss">',
    )[1]!;

  test("ein Raster: Marke, Hauptbereiche, Kontakt und Rechtliches als Spalten, dazu «©» und «Nach oben»", () => {
    const html = fuss({
      ...keineDaten(),
      kontakt: {
        adresse: "Beispielweg 1, 8000 Beispielstadt",
        telefon: "+41 00 000 00 00",
        email: "info@example.org",
        impressum: "/impressum",
        datenschutz: "/datenschutz-website",
      },
    });
    // Ohne Logo steht die Wortmarke
    expect(html).toContain(
      '<a class="fuss-marke" href="/"><b>CEVI</b><span>Beispielstadt</span></a>',
    );
    expect(html).toContain(
      '<div class="fuss-kontakt"><h2>Kontakt</h2><address><ul>',
    );
    expect(html).toContain(
      '<li><a href="mailto:info@example.org">info@example.org</a></li><li><a href="tel:+41000000000">+41 00 000 00 00</a></li><li>Cevi Beispielstadt<br>Beispielweg 1, 8000 Beispielstadt</li>',
    );
    expect(html).toContain(
      '<nav class="fuss-recht" aria-labelledby="fuss-recht"><h2 id="fuss-recht">Rechtliches</h2><ul><li><a href="/impressum">Impressum</a></li><li><a href="/datenschutz-website">Datenschutz</a></li></ul></nav>',
    );
    // «Nach oben» ist ein Verweis des Repertoires (ohne Knopf), «©» und «Nach oben» stehen in einer Zeile
    expect(html).toMatch(
      /<div class="fuss-unten"><p class="fuss-copy">© \d{4} Cevi Beispielstadt<\/p><a class="verweis fuss-oben" href="#">Nach oben<\/a><\/div>/,
    );
  });

  test("ohne Telefon fehlt es im Fuss, ohne Angaben fehlt die ganze Spalte Kontakt", () => {
    const ohneTelefon = fuss({
      ...keineDaten(),
      kontakt: { email: "info@example.org" },
    });
    expect(ohneTelefon).toContain("info@example.org");
    expect(ohneTelefon).not.toContain("tel:");
    expect(fuss(keineDaten())).not.toContain("fuss-kontakt");
  });

  test("nur die oberste Ebene der Navigation steht im Fuss, nie die Unterseiten", () => {
    const html = fuss(keineDaten(), {
      navigation: [
        { pfad: "/gruppen", titel: "Unsere Gruppen", kinder: [nav("Bienli")] },
        { pfad: "/mitmachen", titel: "Mitmachen", kinder: [] },
      ],
    });
    expect(html).toContain(
      '<nav class="fuss-seiten" aria-labelledby="fuss-seiten"><h2 id="fuss-seiten">Bereiche</h2><ul><li><a href="/gruppen">Unsere Gruppen</a></li><li><a href="/mitmachen">Mitmachen</a></li></ul></nav>',
    );
    expect(html).not.toContain("Bienli");
  });

  test("Logo: mit Fassung für Dunkel steht sie auf Blau, mit nur einer hellen Fassung auf einem hellen Feld", () => {
    const logo = {
      id: "01a20580-3c5d-7c70-8783-e931b4402523",
      altText: "Cevi",
      breite: 800,
      hoehe: 165,
    };
    const zwei = fuss(keineDaten(), {
      logo: {
        ...logo,
        dunkel: {
          id: "01a20580-3d31-7782-abdd-2cc5b954ab90",
          breite: 800,
          hoehe: 165,
        },
      },
    });
    expect(zwei).toContain(
      '<img class="fuss-logo" src="/api/v1/medien/01a20580-3d31-7782-abdd-2cc5b954ab90" alt="Cevi" width="800" height="165"><span class="nur-sr">Beispielstadt</span>',
    );
    const eins = fuss(keineDaten(), { logo });
    expect(eins).toContain(
      '<img class="fuss-logo fuss-logo--feld" src="/api/v1/medien/01a20580-3c5d-7c70-8783-e931b4402523"',
    );
  });

  test("ohne Angaben: kein erfundenes Impressum, Datenschutz führt auf die Seite «datenschutz-website», keine leeren Angaben", () => {
    const html = fuss(keineDaten());
    expect(html).not.toContain("Impressum");
    expect(html).toContain('<a href="/datenschutz-website">Datenschutz</a>');
    expect(html).not.toContain("<address>");
    expect(html).not.toContain("fuss-kontakt");
  });
});

// Abgleich mit Datenbank: Termine, Schrift als Datei, Seiten des Fusses
const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

describe("Abgleich", () => {
  let abteilungId: string;
  let wurzel: string;
  let ausgabe: Ausgabe;

  beforeEach(async () => {
    const [a] = await db
      .insert(schema.abteilung)
      .values({ name: "Cevi Testabteilung" })
      .returning();
    abteilungId = a!.id;
    wurzel = await mkdtemp(join(tmpdir(), "cevi-darstellung-"));
    ausgabe = dateisystemAusgabe(wurzel);
  });
  afterEach(() => rm(wurzel, { recursive: true, force: true }));

  async function neueSeite(adresse: string, inhalt: unknown, titel = adresse) {
    const [s] = await db
      .insert(schema.seite)
      .values({
        abteilungId,
        adresse,
        titel,
        reihenfolge: 0,
        sichtbarkeit: "oeffentlich",
      })
      .returning();
    const [v] = await db
      .insert(schema.seiteVersion)
      .values({ seiteId: s!.id, nr: 1, inhalt })
      .returning();
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, s!.id));
    return s!.id;
  }
  const tage = (n: number) => new Date(Date.now() + n * 86_400_000);
  async function termin(
    titel: string,
    n: number,
    opt: {
      sichtbarkeit?: "intern" | "leitende" | "eltern";
      status?: "aktiv" | "abgesagt" | "pruefen";
      tags?: string[];
      anlass?: "oeffentlich" | "angemeldet";
    } = {},
  ) {
    const beginn = tage(n);
    const [p] = await db
      .insert(schema.programm)
      .values({
        abteilungId,
        googleEventId: id(),
        titel,
        ganztaegig: false,
        beginn,
        ende: new Date(beginn.getTime() + 3 * 3_600_000),
        sichtbarkeit: opt.sichtbarkeit ?? "eltern",
        status: opt.status ?? "aktiv",
        ort: "Treffpunkt",
      })
      .returning();
    for (const tagId of opt.tags ?? []) {
      await db.insert(schema.programmTag).values({ programmId: p!.id, tagId });
    }
    if (opt.anlass) {
      await db.insert(schema.anlass).values({
        abteilungId,
        programmId: p!.id,
        anmeldungFuer: "kind",
        sichtbarkeit: opt.anlass,
      });
    }
    return p!.id;
  }
  async function stufe(name: string) {
    const [t] = await db
      .insert(schema.tag)
      .values({ abteilungId, typ: "stufe", name, kuerzel: name.slice(0, 2) })
      .returning();
    return t!.id;
  }

  test("ohne Gruppe: nur Termine öffentlicher Anlässe; mit Gruppe: die Termine der Gruppe; nie intern, leitende, abgesagt oder vergangen", async () => {
    const woelfe = await stufe("Wölfe");
    const adler = await stufe("Adler");
    await termin("Öffentlicher Anlass", 5, {
      anlass: "oeffentlich",
      tags: [woelfe, adler],
    });
    await termin("Anlass nur für Angemeldete", 4, {
      anlass: "angemeldet",
      tags: [woelfe],
    });
    await termin("Programm Wölfe", 3, { tags: [woelfe] });
    await termin("Programm Wölfe später", 9, { tags: [woelfe] });
    await termin("Programm Adler", 2, { tags: [adler] });
    await termin("Intern", 1, {
      sichtbarkeit: "intern",
      tags: [woelfe],
      anlass: "oeffentlich",
    });
    await termin("Leitende", 1, { sichtbarkeit: "leitende", tags: [woelfe] });
    await termin("Abgesagt", 1, {
      status: "abgesagt",
      tags: [woelfe],
      anlass: "oeffentlich",
    });
    await termin("Vergangen", -3, { tags: [woelfe], anlass: "oeffentlich" });
    // Anderer Abteilung
    const [fremd] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremd" })
      .returning();
    await db.insert(schema.programm).values({
      abteilungId: fremd!.id,
      googleEventId: id(),
      titel: "Fremder Anlass",
      ganztaegig: true,
      tagVon: "2099-01-01",
      tagBis: "2099-01-01",
    });

    const alle = b("terminliste", { anzahl: 5 });
    const nurWoelfe = b("terminliste", { tagId: woelfe, anzahl: 3 });
    const d = dok("T", alle, nurWoelfe);
    const { termine } = await ladeTerminlisten(
      db,
      abteilungId,
      [],
      new Map([["s", d]]),
    );
    expect(termine!.get(alle.id)!.map((t) => t.titel)).toEqual([
      "Öffentlicher Anlass",
    ]);
    const w = termine!.get(nurWoelfe.id)!;
    expect(w.map((t) => t.titel)).toEqual([
      "Programm Wölfe",
      "Anlass nur für Angemeldete",
      "Öffentlicher Anlass",
    ]);
    expect(w[0]).toMatchObject({
      titel: "Programm Wölfe",
      ort: "Treffpunkt",
      stufen: ["Wölfe"],
      anlassId: null,
    });
    // Chips: nur Stufen, auch die zweite des Anlasses
    expect(termine!.get(alle.id)![0]!.stufen).toEqual(["Adler", "Wölfe"]);
    expect(termine!.get(alle.id)![0]!.anlassId).toMatch(/^[0-9a-f-]{36}$/);
    // Zeiten sind Zürcher Zeit als «HH:MM», Tage als «JJJJ-MM-TT»
    expect(w[0]!.zeitVon).toMatch(/^\d\d:\d\d$/);
    expect(w[0]!.von).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  test("ganztägige Termine: Tage statt Zeiten; ohne Bausteine keine Abfrage", async () => {
    const [p] = await db
      .insert(schema.programm)
      .values({
        abteilungId,
        googleEventId: id(),
        titel: "Lager",
        ganztaegig: true,
        tagVon: tage(30).toISOString().slice(0, 10),
        tagBis: tage(38).toISOString().slice(0, 10),
      })
      .returning();
    await db.insert(schema.anlass).values({
      abteilungId,
      programmId: p!.id,
      anmeldungFuer: "kind",
      sichtbarkeit: "oeffentlich",
    });
    const lager = b("terminliste", { anzahl: 3 });
    const { termine } = await ladeTerminlisten(
      db,
      abteilungId,
      [],
      new Map([["s", dok("T", lager)]]),
    );
    const t = termine!.get(lager.id)![0]!;
    expect(t.zeitVon).toBeNull();
    expect(t.von < t.bis).toBe(true);
    // Ohne Bausteine bleibt nur der öffentliche Datenplan (#564)
    expect([
      ...(
        await ladeTerminlisten(db, abteilungId, [], new Map([["s", dok("T")]]))
      ).termine!.keys(),
    ]).toEqual([DATENPLAN]);
  });

  test("öffentlicher Datenplan (#564): nur aktive Termine für Eltern und öffentliche Anlässe; nie intern, leitende, abgesagt, unklar, fremd; Datei ohne IDs", async () => {
    const woelfe = await stufe("Wölfe");
    const team = (
      await db
        .insert(schema.tag)
        .values({ abteilungId, typ: "team", name: "Küchenteam", kuerzel: "KT" })
        .returning()
    )[0]!.id;
    await termin("Programm Wölfe", 3, { tags: [woelfe, team] });
    const mitSeite = await termin("Weihnachtsfest", 5, {
      anlass: "oeffentlich",
    });
    await termin("Anlass ohne Seite", 6, { anlass: "oeffentlich" });
    await termin("Anlass nur für Angemeldete", 4, { anlass: "angemeldet" });
    await termin("Intern", 1, { sichtbarkeit: "intern", tags: [woelfe] });
    await termin("Leitende", 1, { sichtbarkeit: "leitende", tags: [woelfe] });
    await termin("Abgesagt", 1, { status: "abgesagt", tags: [woelfe] });
    await termin("Unklar", 1, { status: "pruefen", tags: [woelfe] });
    await termin("Längst vorbei", -70, { tags: [woelfe] });
    await termin("Zu weit weg", 450, { tags: [woelfe] });
    const [fremd] = await db
      .insert(schema.abteilung)
      .values({ name: "Fremd" })
      .returning();
    await db.insert(schema.programm).values({
      abteilungId: fremd!.id,
      googleEventId: id(),
      titel: "Fremdes Programm",
      ganztaegig: false,
      beginn: tage(3),
      ende: tage(3),
    });
    const seiteId = await neueSeite(
      "weihnachtsfest",
      { v: 1, titel: "Fest", bausteine: [b("trenner", { art: "linie" })] },
      "Fest",
    );
    await db
      .update(schema.anlass)
      .set({ seiteId })
      .where(eq(schema.anlass.programmId, mitSeite));

    const erlaubt = ["Programm Wölfe", "Weihnachtsfest", "Anlass ohne Seite"];
    expect(
      (await ladeDatenplan(db, abteilungId)).map((t) => t.titel).sort(),
    ).toEqual([...erlaubt].sort());

    await erzeugeWebsite(db, {
      ausgabe,
      abteilungId,
      basisUrl: "https://www.example.org",
      stylesheet: "body{}",
      datenquellen: [ladeTerminlisten],
    });
    const roh = await readFile(join(wurzel, DATENPLAN_DATEI), "utf8");
    const plan = JSON.parse(roh) as {
      von: string;
      bis: string;
      termine: Record<string, unknown>[];
    };
    expect(plan.termine.map((t) => t.titel).sort()).toEqual(
      [...erlaubt].sort(),
    );
    // Nur, was die Zeile zeigt: keine IDs, keine Personen, keine Zahlen; Gruppen nur als Namen der Stufen
    expect(roh).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    for (const t of plan.termine) {
      expect(
        Object.keys(t).filter(
          (k) =>
            ![
              "titel",
              "von",
              "bis",
              "zeitVon",
              "zeitBis",
              "ort",
              "stufen",
              "seite",
            ].includes(k),
        ),
      ).toEqual([]);
    }
    const nach = (titel: string) =>
      plan.termine.find((t) => t.titel === titel)!;
    expect(nach("Programm Wölfe")).toMatchObject({
      ort: "Treffpunkt",
      stufen: ["Wölfe"],
    });
    // Ein Link nur auf die öffentliche Seite des Anlasses, nie auf «/anlass?id=»
    expect(nach("Weihnachtsfest").seite).toBe("/weihnachtsfest");
    expect(nach("Anlass ohne Seite").seite).toBeUndefined();
    expect(plan.von).toMatch(/^\d{4}-\d\d-01$/);

    // Dieselben Termine als Liste im HTML, lesbar ohne Skript
    const html = await readFile(join(wurzel, "termine", "index.html"), "utf8");
    expect(html).toContain('<div class="plan" id="tm-plan">');
    for (const titel of erlaubt) {
      expect(html).toContain(`<span class="titel">${titel}</span>`);
    }
    expect(html).toContain('<a class="termin" href="/weihnachtsfest"');
    expect(html).not.toContain("/anlass?id=");
    for (const nie of [
      "Intern",
      "Leitende",
      "Abgesagt",
      "Unklar",
      "Fremdes Programm",
      "Anlass nur für Angemeldete",
      "Küchenteam",
      "Längst vorbei",
      "Zu weit weg",
    ]) {
      expect(roh, nie).not.toContain(nie);
      expect(html, nie).not.toContain(nie);
    }
  });

  test("die erzeugte Startseite zeigt die Termine, der Fuss die Seiten des Baums; die Schrift kommt unverändert als Datei", async () => {
    await termin("Weihnachtsfest", 10, { anlass: "oeffentlich" });
    await neueSeite("start", {
      v: 1,
      titel: "Start",
      bausteine: [b("terminliste", { anzahl: 3 })],
    });
    await neueSeite(
      "impressum",
      { v: 1, titel: "Impressum", bausteine: [b("trenner", { art: "linie" })] },
      "Impressum",
    );
    await neueSeite(
      "datenschutz-website",
      {
        v: 1,
        titel: "Datenschutz",
        bausteine: [b("trenner", { art: "linie" })],
      },
      "Datenschutz",
    );
    const bytes = Uint8Array.from([
      0x77, 0x4f, 0x46, 0x32, 0, 255, 128, 10, 13,
    ]);
    await erzeugeWebsite(db, {
      ausgabe,
      abteilungId,
      basisUrl: "https://www.example.org",
      stylesheet: "body{}",
      skripte: { "archivo-latin.woff2": bytes, "menue.js": "// m" },
      datenquellen: [ladeTerminlisten],
      kontakt: {
        adresse: "Beispielweg 1",
        telefon: "+41 00 000 00 00",
        email: "info@example.org",
      },
    });
    const start = await readFile(join(wurzel, "index.html"), "utf8");
    expect(start).toContain('<span class="titel">Weihnachtsfest</span>');
    // Fuss: Seiten des Baums; sie stehen nicht zusätzlich in der Leiste
    const fuss = start.split('<footer class="fuss">')[1]!;
    expect(fuss).toContain('<a href="/impressum">Impressum</a>');
    expect(fuss).toContain('<a href="/datenschutz-website">Datenschutz</a>');
    expect(fuss).toContain("<li>Cevi Testabteilung<br>Beispielweg 1</li>");
    const leiste = start.slice(
      start.indexOf('<nav class="hauptnav"'),
      start.indexOf("</nav>"),
    );
    expect(leiste).not.toContain("Impressum");
    expect(leiste).not.toContain("Datenschutz");
    // Binärdatei: dieselben Bytes, nicht als Text umgeschrieben
    expect(
      new Uint8Array(
        await readFile(join(wurzel, "website", "archivo-latin.woff2")),
      ),
    ).toEqual(bytes);
  });
});
