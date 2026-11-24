import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  MAX_KOPF_TITEL,
  MAX_KOPF_UNTERTITEL,
  MAX_WEITERFUEHREND,
  MAX_WEITERSAGEN_NACHRICHT,
} from "../src/website/bausteine-handlung.js";
import {
  pruefeDokument,
  sammleVerweise,
  type Seitendokument,
} from "../src/website/dokument.js";
import {
  keineDaten,
  rendereGeschuetzte,
  rendereSeite,
  type Daten,
  type NavPunkt,
} from "../src/website/rendern.js";

// Bausteine «Einstieg und Handlung» (#743): Schema mit Grenzen und Ablehnung, Verweise, Rendern mit Maskierung, Anker, Menübaum

const BOESE = `<x-boese a="1">&"'`;
const id = () => randomUUID();
const b = (typ: string, daten: unknown, extra: object = {}) => ({
  id: id(),
  typ,
  daten,
  ...extra,
});
const pruefe = (...bausteine: unknown[]) =>
  pruefeDokument({ v: 1, titel: "Seite", bausteine });
const dok = (...bausteine: unknown[]): Seitendokument => {
  const p = pruefe(...bausteine);
  if (!p.ok) throw new Error(JSON.stringify(p.fehler));
  return p.dokument;
};
const nav = (
  pfad: string,
  titel: string,
  kinder: NavPunkt[] = [],
): NavPunkt => ({
  pfad,
  titel,
  kinder,
});
const BAUM: NavPunkt[] = [
  nav("/", "Start"),
  nav("/gruppen", "Unsere Gruppen", [
    nav("/gruppen/froeschli", "Stufe Fröschli"),
    nav("/gruppen/pilami", "Stufe Pilami"),
    nav("/gruppen/imperius", "Stufe Imperius"),
  ]),
  nav("/mitmachen", "Mitmachen"),
];
const seite = (
  d: Seitendokument,
  {
    pfad = "/gruppen/pilami",
    navigation = BAUM,
    daten = keineDaten(),
    titel,
  }: {
    pfad?: string;
    navigation?: NavPunkt[];
    daten?: Daten;
    titel?: string;
  } = {},
) =>
  rendereSeite(
    { id: id(), pfad, dokument: titel ? { ...d, titel } : d },
    {
      abteilung: "Cevi Test",
      basisUrl: "https://www.example.org",
      navigation,
      daten,
    },
  );
const ueberschrift = (text: string, ebene = 2) =>
  b("ueberschrift", { ebene, text });
// Der Inhalt unter dem Seitentitel; Kopf und Fuss der Seite stehen ausserhalb von <main>
const inhalt = (html: string) =>
  html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const bildDaten = (altText: string | null) => ({
  mimeTyp: "image/jpeg",
  groesse: 1000,
  breite: 400,
  hoehe: 300,
  altText,
});

describe("Schema", () => {
  test("gültige Bausteine", () => {
    expect(
      pruefe(
        b("kopfbereich", {
          titel: "Sommerlager",
          untertitel: "Zehn Tage",
          bild: id(),
          schaltflaechen: [
            { beschriftung: "Anmelden", ziel: "/anmelden" },
            { beschriftung: "Info", ziel: "https://www.cevi.ch/lager" },
          ],
        }),
        b("kopfbereich", { titel: "Nur Titel" }),
        b("inhaltsverzeichnis", { darstellung: "liste" }),
        b("inhaltsverzeichnis", { darstellung: "knoepfe", titel: "Inhalt" }),
        b("weiterfuehrend", {
          darstellung: "karten",
          eintraege: [
            { titel: "Termine", text: "Was ansteht", ziel: "/termine" },
            { titel: "Cevi Schweiz", ziel: "https://www.cevi.ch/" },
          ],
        }),
        b("kontaktleiste", { felder: ["telefon", "email", "adresse"] }),
        b("kontaktleiste", { titel: "Fragen?", felder: ["email"] }),
        b("weitersagen", {}),
        b("weitersagen", { beschriftung: "Teilen", nachricht: "Schau mal:" }),
        b("seitenwechsel", {}),
        b("brotkrumen", {}),
      ).ok,
    ).toBe(true);
  });

  test.each([
    ["kopfbereich ohne Titel", b("kopfbereich", {})],
    ["kopfbereich mit leerem Titel", b("kopfbereich", { titel: "  " })],
    [
      "kopfbereich mit zu langem Titel",
      b("kopfbereich", { titel: "x".repeat(MAX_KOPF_TITEL + 1) }),
    ],
    [
      "kopfbereich mit zu langem Untertitel",
      b("kopfbereich", {
        titel: "a",
        untertitel: "x".repeat(MAX_KOPF_UNTERTITEL + 1),
      }),
    ],
    [
      "kopfbereich mit drei Schaltflächen",
      b("kopfbereich", {
        titel: "a",
        schaltflaechen: [1, 2, 3].map((n) => ({
          beschriftung: `K${n}`,
          ziel: "/anmelden",
        })),
      }),
    ],
    [
      "kopfbereich mit javascript-Ziel",
      b("kopfbereich", {
        titel: "a",
        schaltflaechen: [{ beschriftung: "x", ziel: "javascript:alert(1)" }],
      }),
    ],
    [
      "kopfbereich mit http-Ziel",
      b("kopfbereich", {
        titel: "a",
        schaltflaechen: [{ beschriftung: "x", ziel: "http://www.cevi.ch" }],
      }),
    ],
    [
      "kopfbereich mit Bild ohne UUID",
      b("kopfbereich", { titel: "a", bild: "x" }),
    ],
    [
      "kopfbereich mit fremdem Feld",
      b("kopfbereich", { titel: "a", html: "<b>" }),
    ],
    [
      "kopfbereich mit Steuerzeichen im Titel",
      b("kopfbereich", { titel: "a\u0000b" }),
    ],
    ["verzeichnis ohne Darstellung", b("inhaltsverzeichnis", {})],
    [
      "verzeichnis mit unbekannter Darstellung",
      b("inhaltsverzeichnis", { darstellung: "baum" }),
    ],
    [
      "verzeichnis mit eigenen Einträgen",
      b("inhaltsverzeichnis", { darstellung: "liste", eintraege: [] }),
    ],
    [
      "weiterfuehrend ohne Einträge",
      b("weiterfuehrend", { darstellung: "karten", eintraege: [] }),
    ],
    [
      "weiterfuehrend mit zu vielen Einträgen",
      b("weiterfuehrend", {
        darstellung: "liste",
        eintraege: Array.from({ length: MAX_WEITERFUEHREND + 1 }, (_, i) => ({
          titel: `T${i}`,
          ziel: "/termine",
        })),
      }),
    ],
    [
      "weiterfuehrend mit mailto-Ziel",
      b("weiterfuehrend", {
        darstellung: "karten",
        eintraege: [{ titel: "a", ziel: "mailto:a@example.org" }],
      }),
    ],
    [
      "weiterfuehrend mit tel-Ziel",
      b("weiterfuehrend", {
        darstellung: "karten",
        eintraege: [{ titel: "a", ziel: "tel:+41435439682" }],
      }),
    ],
    [
      "weiterfuehrend ohne Ziel",
      b("weiterfuehrend", {
        darstellung: "karten",
        eintraege: [{ titel: "a" }],
      }),
    ],
    ["kontaktleiste ohne Felder", b("kontaktleiste", { felder: [] })],
    [
      "kontaktleiste mit unbekanntem Feld",
      b("kontaktleiste", { felder: ["fax"] }),
    ],
    [
      "kontaktleiste mit doppeltem Feld",
      b("kontaktleiste", { felder: ["email", "email"] }),
    ],
    [
      "kontaktleiste mit Wert im Dokument",
      b("kontaktleiste", { felder: ["email"], email: "a@example.org" }),
    ],
    [
      "weitersagen mit zu langer Nachricht",
      b("weitersagen", {
        nachricht: "x".repeat(MAX_WEITERSAGEN_NACHRICHT + 1),
      }),
    ],
    [
      "weitersagen mit Link",
      b("weitersagen", { ziel: "https://www.cevi.ch/" }),
    ],
    ["seitenwechsel mit Daten", b("seitenwechsel", { nachOben: true })],
    ["brotkrumen mit Daten", b("brotkrumen", { ebene: 1 })],
  ])("abgelehnt: %s", (_, baustein) => {
    expect(pruefe(baustein).ok).toBe(false);
  });

  test("Grenzen gelten genau: Titel, Untertitel, sechs Links", () => {
    expect(
      pruefe(b("kopfbereich", { titel: "x".repeat(MAX_KOPF_TITEL) })).ok,
    ).toBe(true);
    expect(
      pruefe(
        b("kopfbereich", {
          titel: "a",
          untertitel: "x".repeat(MAX_KOPF_UNTERTITEL),
        }),
      ).ok,
    ).toBe(true);
    expect(
      pruefe(
        b("weiterfuehrend", {
          darstellung: "liste",
          eintraege: Array.from({ length: MAX_WEITERFUEHREND }, (_, i) => ({
            titel: `T${i}`,
            ziel: "/termine",
          })),
        }),
      ).ok,
    ).toBe(true);
  });

  test("Sichtbarkeit lässt sich wie bei jedem Baustein setzen", () => {
    const d = dok(
      b("weitersagen", {}, { sichtbarkeit: { art: "angemeldet" } }),
      b("brotkrumen", {}),
    );
    expect(d.bausteine.map((x) => x.sichtbarkeit)).toMatchObject([
      { art: "angemeldet" },
      "erbt",
    ]);
  });
});

describe("Verweise", () => {
  test("Bild und Ziele des Kopfbereichs, Ziele der weiterführenden Links", () => {
    const bild = id();
    const v = sammleVerweise(
      dok(
        b("kopfbereich", {
          titel: "a",
          bild,
          schaltflaechen: [
            { beschriftung: "x", ziel: "/anmelden#formular" },
            { beschriftung: "y", ziel: "https://www.cevi.ch/" },
          ],
        }),
        b("weiterfuehrend", {
          darstellung: "karten",
          eintraege: [
            { titel: "a", ziel: "/stufen/woelfe" },
            { titel: "b", ziel: "https://www.cevi.ch/" },
          ],
        }),
      ),
    );
    expect(v.medien).toEqual([bild]);
    expect(v.seiten.sort()).toEqual(["/anmelden", "/stufen/woelfe"]);
  });
});

describe("Kopfbereich", () => {
  const bild = id();
  const daten = (alt: string | null = "Zelte am See"): Daten => ({
    ...keineDaten(),
    medien: new Map([[bild, bildDaten(alt)]]),
  });
  const mit = (...bausteine: unknown[]) => dok(...bausteine);

  test("mit Bild: Bild, Fahne, Titel der Ebene 2, Untertitel, erste Schaltfläche rot", () => {
    const html = inhalt(
      seite(
        mit(
          b("kopfbereich", {
            titel: "Sommerlager",
            untertitel: "Zehn Tage",
            bild,
            schaltflaechen: [
              { beschriftung: "Anmelden", ziel: "/anmelden" },
              { beschriftung: "Mehr", ziel: "/anlaesse" },
            ],
          }),
        ),
        { daten: daten() },
      ),
    );
    expect(html).toContain('<section class="sektion sektion--kopfbereich">');
    expect(html).toContain('class="kopfbereich kopfbereich--bild"');
    expect(html).toContain(`src="/api/v1/medien/${bild}"`);
    expect(html).toContain('alt="Zelte am See"');
    expect(html).toContain('<div class="fahne"><h2>Sommerlager</h2>');
    expect(html).toContain('<p class="kopf-untertitel">Zehn Tage</p>');
    expect(html).toContain(
      '<a href="/anmelden" class="btn p gross">Anmelden</a>',
    );
    expect(html).toContain('<a href="/anlaesse" class="btn s gross">Mehr</a>');
    // Das Bild liegt im ersten Abschnitt: sofort laden, kein loading="lazy"
    expect(html).not.toContain('loading="lazy"');
  });

  test("ohne Bild oder mit einem Medium, das kein Bild ist: das blaue Band", () => {
    const ohne = inhalt(seite(mit(b("kopfbereich", { titel: "Hallo" }))));
    expect(ohne).toContain('class="kopfbereich kopfbereich--band"');
    expect(ohne).not.toContain("<img");
    const pdf = inhalt(
      seite(mit(b("kopfbereich", { titel: "Hallo", bild })), {
        daten: {
          ...keineDaten(),
          medien: new Map([
            [bild, { ...bildDaten(null), mimeTyp: "application/pdf" }],
          ]),
        },
      }),
    );
    expect(pdf).toContain("kopfbereich--band");
    expect(pdf).not.toContain("<img");
  });

  test("nur die erste Schaltfläche der Seite ist die Hauptaktion", () => {
    const html = inhalt(
      seite(
        mit(
          b("schaltflaeche", {
            darstellung: "schaltflaeche",
            beschriftung: "Zuerst",
            ziel: "/anmelden",
          }),
          b("kopfbereich", {
            titel: "a",
            schaltflaechen: [{ beschriftung: "Danach", ziel: "/termine" }],
          }),
        ),
      ),
    );
    expect(html.match(/btn p /g)).toHaveLength(1);
    expect(html).toContain('<a href="/termine" class="btn s gross">Danach</a>');
  });

  test("Maskierung: kein rohes HTML aus Titel, Untertitel und Beschriftung", () => {
    const html = inhalt(
      seite(
        mit(
          b("kopfbereich", {
            titel: BOESE,
            untertitel: BOESE,
            schaltflaechen: [{ beschriftung: BOESE, ziel: "/anmelden" }],
          }),
        ),
      ),
    );
    expect(html).not.toContain("<x-boese");
    expect(html).toContain("&lt;x-boese a=&quot;1&quot;&gt;");
  });

  test("steht nach einer Überschrift und bleibt ein eigener Abschnitt", () => {
    const html = inhalt(
      seite(mit(ueberschrift("Vorher"), b("kopfbereich", { titel: "Mitte" }))),
    );
    expect(html.indexOf("<h2")).toBeLessThan(html.indexOf("kopfbereich--band"));
    expect(html).toContain('<section class="sektion sektion--kopfbereich">');
  });
});

describe("Inhaltsverzeichnis", () => {
  const verz = b("inhaltsverzeichnis", { darstellung: "liste" });

  test("Links zu den Überschriften der Ebene 2, auch wenn es vor ihnen steht", () => {
    const html = inhalt(
      seite(
        dok(
          verz,
          ueberschrift("Was wir tun"),
          ueberschrift("Unterabschnitt", 3),
          ueberschrift("Wann und wo"),
        ),
      ),
    );
    expect(html).toContain('<nav class="verzeichnis verzeichnis--liste"');
    expect(html).toContain('<a href="#was-wir-tun">Was wir tun</a>');
    expect(html).toContain('<a href="#wann-und-wo">Wann und wo</a>');
    expect(html).not.toContain("#unterabschnitt");
    // Die Ziele gibt es: dieselben Anker stehen an den Überschriften
    expect(html).toContain('<h2 id="was-wir-tun">');
    expect(html).toContain('<h2 id="wann-und-wo">');
  });

  test("gleiche Überschriften bekommen dieselben Anker wie im Text", () => {
    const html = inhalt(
      seite(dok(verz, ueberschrift("Preise"), ueberschrift("Preise"))),
    );
    expect(html).toContain('<a href="#preise">Preise</a>');
    expect(html).toContain('<a href="#preise-2">Preise</a>');
    expect(html).toContain('<h2 id="preise">');
    expect(html).toContain('<h2 id="preise-2">');
  });

  test("Titel, Knöpfe und Beschriftung durch den Namen", () => {
    const html = inhalt(
      seite(
        dok(
          b("inhaltsverzeichnis", {
            darstellung: "knoepfe",
            titel: "Springen",
          }),
          ueberschrift("A"),
          ueberschrift("B"),
        ),
      ),
    );
    expect(html).toContain("verzeichnis--knoepfe");
    expect(html).toContain("Springen</p>");
    expect(html).toMatch(/aria-labelledby="verz-[0-9a-f-]+"/);
  });

  test("weniger als zwei Überschriften: kein Verzeichnis", () => {
    const eine = inhalt(seite(dok(verz, ueberschrift("Nur eine"))));
    expect(eine).not.toContain("verzeichnis");
    const keine = inhalt(seite(dok(verz)));
    expect(keine).not.toContain("verzeichnis");
    // Ebene 3 zählt nicht
    expect(
      inhalt(seite(dok(verz, ueberschrift("a", 3), ueberschrift("b", 3)))),
    ).not.toContain("verzeichnis");
  });

  test("Überschriften, die nur angemeldet sichtbar sind, stehen nicht darin", () => {
    const html = inhalt(
      seite(
        dok(
          verz,
          ueberschrift("Öffentlich A"),
          b(
            "ueberschrift",
            { ebene: 2, text: "Geheim" },
            { sichtbarkeit: { art: "angemeldet" } },
          ),
          ueberschrift("Öffentlich B"),
        ),
      ),
    );
    expect(html).toContain("#oeffentlich-a");
    expect(html).toContain("#oeffentlich-b");
    expect(html).not.toContain("Geheim");
  });

  test("Maskierung des Textes", () => {
    const html = inhalt(
      seite(dok(verz, ueberschrift(BOESE), ueberschrift("Zweite"))),
    );
    expect(html).not.toContain("<x-boese");
  });

  test("ohne Menübaum (Vorschau): ein Beispiel ohne Links; mit Überschriften die echten", () => {
    const leer = inhalt(
      seite(dok(verz), { navigation: [], pfad: "/vorschau" }),
    );
    expect(leer).toContain("Erster Abschnitt");
    expect(leer).not.toContain('href="#');
    const echt = inhalt(
      seite(dok(verz, ueberschrift("A"), ueberschrift("B")), {
        navigation: [],
        pfad: "/vorschau",
      }),
    );
    expect(echt).toContain('href="#a"');
    expect(echt).not.toContain("Erster Abschnitt");
  });

  test("auch nachgeladen (geschützter Baustein) kennt es die Anker", () => {
    const d = dok(
      b(
        "inhaltsverzeichnis",
        { darstellung: "liste" },
        { sichtbarkeit: { art: "angemeldet" } },
      ),
      ueberschrift("Eins"),
      ueberschrift("Zwei"),
    );
    const [k] = rendereGeschuetzte(
      d,
      id(),
      keineDaten(),
      (x) => x.typ === "inhaltsverzeichnis",
    );
    expect(JSON.stringify(k!.knoten)).toContain("#eins");
  });
});

describe("Weiterführende Links", () => {
  const eintraege = [
    { titel: "Termine", text: "Was ansteht", ziel: "/termine" },
    { titel: "Cevi Schweiz", ziel: "https://www.cevi.ch/" },
  ];

  test("ganze Karte ist ein Link; fremde Adresse mit rel und Hinweis für Screenreader", () => {
    const html = inhalt(
      seite(dok(b("weiterfuehrend", { darstellung: "karten", eintraege }))),
    );
    expect(html).toContain('<ul class="weiter weiter--karten" role="list">');
    expect(html).toContain('<a href="/termine" class="weiter-link">');
    expect(html).toContain('<span class="weiter-titel">Termine</span>');
    expect(html).toContain(
      '<span class="weiter-beschreibung">Was ansteht</span>',
    );
    expect(html).toContain(
      '<a href="https://www.cevi.ch/" rel="noopener noreferrer" class="weiter-link weiter-link--extern">',
    );
    expect(html).toContain("(externe Seite)");
    expect(html).toContain('aria-hidden="true"');
  });

  test("Liste als zweite Darstellung", () => {
    const html = inhalt(
      seite(dok(b("weiterfuehrend", { darstellung: "liste", eintraege }))),
    );
    expect(html).toContain("weiter--liste");
  });

  test("Einträge auf Seiten, die Besucher nicht sehen, entfallen; ohne Rest entfällt der Baustein", () => {
    const daten: Daten = { ...keineDaten(), verborgen: new Set(["/termine"]) };
    const html = inhalt(
      seite(dok(b("weiterfuehrend", { darstellung: "karten", eintraege })), {
        daten,
      }),
    );
    expect(html).not.toContain('href="/termine"');
    expect(html).toContain("Cevi Schweiz");
    const alle = inhalt(
      seite(
        dok(
          b("weiterfuehrend", {
            darstellung: "karten",
            eintraege: [{ titel: "T", ziel: "/termine#x" }],
          }),
        ),
        { daten },
      ),
    );
    expect(alle).not.toContain("weiter");
  });

  test("Maskierung", () => {
    const html = inhalt(
      seite(
        dok(
          b("weiterfuehrend", {
            darstellung: "karten",
            eintraege: [{ titel: BOESE, text: BOESE, ziel: "/termine" }],
          }),
        ),
      ),
    );
    expect(html).not.toContain("<x-boese");
  });
});

describe("Kontaktleiste", () => {
  const daten = (kontakt?: Daten["kontakt"]): Daten => ({
    ...keineDaten(),
    ...(kontakt && { kontakt }),
  });
  const leiste = b("kontaktleiste", {
    titel: "Fragen?",
    felder: ["telefon", "email", "adresse"],
  });

  test("Werte aus der Konfiguration: Telefon und E-Mail als Link, Anschrift ohne", () => {
    const html = inhalt(
      seite(dok(leiste), {
        daten: daten({
          telefon: "043 543 96 82",
          email: "info@example.org",
          adresse: "Dorfstrasse 1, 8712 Stäfa",
        }),
      }),
    );
    expect(html).toContain('<address class="kontaktleiste">');
    expect(html).toContain('<p class="leiste-titel">Fragen?</p>');
    expect(html).toContain('href="tel:+41435439682"');
    expect(html).toContain('href="mailto:info@example.org"');
    expect(html).toContain("Dorfstrasse 1, 8712 Stäfa");
    expect(html).not.toContain('href="Dorfstrasse');
  });

  test("Reihenfolge wie gewählt; fehlende Angaben entfallen", () => {
    const html = inhalt(
      seite(dok(b("kontaktleiste", { felder: ["email", "telefon"] })), {
        daten: daten({ email: "info@example.org" }),
      }),
    );
    expect(html).toContain("info@example.org");
    expect(html).not.toContain("Telefon");
  });

  test("ohne Konfiguration oder ohne eine der gewählten Angaben: kein Baustein", () => {
    expect(inhalt(seite(dok(leiste)))).not.toContain("kontaktleiste");
    expect(
      inhalt(
        seite(dok(b("kontaktleiste", { felder: ["telefon"] })), {
          daten: daten({ email: "info@example.org" }),
        }),
      ),
    ).not.toContain("kontaktleiste");
  });

  test("Maskierung der Werte und des Titels", () => {
    const html = inhalt(
      seite(dok(b("kontaktleiste", { titel: BOESE, felder: ["adresse"] })), {
        daten: daten({ adresse: BOESE }),
      }),
    );
    expect(html).not.toContain("<x-boese");
  });
});

describe("Weitersagen", () => {
  const weiter = (daten: unknown = {}, titel = "Sommerlager 2027") =>
    inhalt(seite(dok(b("weitersagen", daten)), { titel }));

  test("mailto mit Titel als Betreff und Adresse der Seite im Text", () => {
    const html = weiter({ nachricht: "Schau mal:" });
    const m = html.match(/href="(mailto:[^"]*)"/);
    expect(m).not.toBeNull();
    const url = new URL(m![1]!.replaceAll("&amp;", "&"));
    expect(url.protocol).toBe("mailto:");
    expect(url.searchParams.get("subject")).toBe("Sommerlager 2027");
    expect(url.searchParams.get("body")).toBe(
      "Schau mal:\r\n\r\nhttps://www.example.org/gruppen/pilami",
    );
    expect(html).toContain("Per E-Mail weitersagen");
    expect(html).toContain('class="btn s gross"');
  });

  test("Beschriftung und Standardsatz", () => {
    const html = weiter({ beschriftung: "Teilen" });
    expect(html).toContain("Teilen</a>");
    expect(html).toContain(
      encodeURIComponent("Das könnte dich interessieren:"),
    );
  });

  test("Sonderzeichen im Titel sind codiert und nie im Markup", () => {
    const html = weiter({ nachricht: BOESE }, `A & B <i>"x"</i>`);
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<x-boese");
    // Im Wert stehen nur codierte Zeichen: kein rohes «<», «"», Leerzeichen oder «&» ausser dem Trenner
    const wert = html.match(/href="(mailto:[^"]*)"/)![1]!;
    expect(wert).not.toMatch(/[<> "\s]/);
    expect(wert).toMatch(/^mailto:\?subject=[^&]*&amp;body=/);
    expect(
      new URL(wert.replaceAll("&amp;", "&")).searchParams.get("subject"),
    ).toBe(`A & B <i>"x"</i>`);
  });

  test("ohne Adresse der Website (Vorschau) steht nur der Satz; nachgeladen entfällt der Baustein", () => {
    const ohne = rendereSeite(
      { id: id(), pfad: "/vorschau", dokument: dok(b("weitersagen", {})) },
      { abteilung: "A", basisUrl: "", navigation: [], daten: keineDaten() },
    );
    expect(ohne).toContain("mailto:");
    expect(ohne).not.toContain("%2Fvorschau");
    const d = dok(
      b("weitersagen", {}, { sichtbarkeit: { art: "angemeldet" } }),
    );
    expect(rendereGeschuetzte(d, id(), keineDaten(), () => true)).toHaveLength(
      0,
    );
  });
});

describe("Brotkrumen", () => {
  test("Start, übergeordnete Seiten, die Seite selbst", () => {
    const html = inhalt(seite(dok(b("brotkrumen", {}))));
    expect(html).toContain(
      '<nav class="brotkrumen" aria-label="Du bist hier">',
    );
    expect(html).toContain('<a href="/">Start</a>');
    expect(html).toContain('<a href="/gruppen">Unsere Gruppen</a>');
    expect(html).toContain('<span aria-current="page">Stufe Pilami</span>');
    expect(html.indexOf("Start")).toBeLessThan(html.indexOf("Unsere Gruppen"));
  });

  test("Seite auf der obersten Ebene: Start und sie selbst", () => {
    const html = inhalt(
      seite(dok(b("brotkrumen", {})), { pfad: "/mitmachen" }),
    );
    expect(html).toContain('<a href="/">Start</a>');
    expect(html).toContain('<span aria-current="page">Mitmachen</span>');
  });

  test("auf der Startseite und ohne Seitenkontext nichts; Seite ausserhalb des Menüs: Start und Titel", () => {
    expect(
      inhalt(seite(dok(b("brotkrumen", {})), { pfad: "/" })),
    ).not.toContain("brotkrumen");
    const aussen = inhalt(
      seite(dok(b("brotkrumen", {})), {
        pfad: "/impressum",
        titel: "Impressum",
      }),
    );
    expect(aussen).toContain('<span aria-current="page">Impressum</span>');
    expect(aussen).toContain('<a href="/">Start</a>');
  });

  test("ohne Menübaum (Vorschau): ein Beispiel ohne Links", () => {
    const html = inhalt(
      seite(dok(b("brotkrumen", {})), { navigation: [], pfad: "/vorschau" }),
    );
    expect(html).toContain("Übergeordnete Seite");
    expect(html).not.toContain('href="/"');
  });

  test("Maskierung der Titel im Menübaum", () => {
    const html = inhalt(
      seite(dok(b("brotkrumen", {})), {
        navigation: [nav("/a", BOESE, [nav("/a/b", BOESE)])],
        pfad: "/a/b",
      }),
    );
    expect(html).not.toContain("<x-boese");
  });
});

describe("Seitenwechsel", () => {
  test("vorherige und nächste Seite auf derselben Ebene", () => {
    const html = inhalt(seite(dok(b("seitenwechsel", {}))));
    expect(html).toContain(
      '<nav class="seitenwechsel" aria-label="Weitere Seiten">',
    );
    expect(html).toMatch(
      /<a class="seitenwechsel-link seitenwechsel-link--zurueck" href="\/gruppen\/froeschli" rel="prev">/,
    );
    expect(html).toMatch(
      /<a class="seitenwechsel-link seitenwechsel-link--weiter" href="\/gruppen\/imperius" rel="next">/,
    );
    expect(html).toContain("Vorherige Seite");
    expect(html).toContain("Stufe Imperius");
  });

  test("erste Seite hat keine vorherige, letzte keine nächste", () => {
    const erste = inhalt(
      seite(dok(b("seitenwechsel", {})), { pfad: "/gruppen/froeschli" }),
    );
    expect(erste).not.toContain("Vorherige Seite");
    expect(erste).toContain("Nächste Seite");
    const letzte = inhalt(
      seite(dok(b("seitenwechsel", {})), { pfad: "/gruppen/imperius" }),
    );
    expect(letzte).toContain("Vorherige Seite");
    expect(letzte).not.toContain("Nächste Seite");
  });

  test("die Startseite gehört nicht in die Abfolge; ohne Nachbarn oder ausserhalb des Menüs nichts", () => {
    const erste = inhalt(
      seite(dok(b("seitenwechsel", {})), { pfad: "/gruppen" }),
    );
    expect(erste).not.toContain("Vorherige Seite");
    expect(erste).toContain("Mitmachen");
    expect(
      inhalt(
        seite(dok(b("seitenwechsel", {})), {
          pfad: "/allein",
          navigation: [nav("/allein", "Allein")],
        }),
      ),
    ).not.toContain("seitenwechsel");
    expect(
      inhalt(seite(dok(b("seitenwechsel", {})), { pfad: "/impressum" })),
    ).not.toContain("seitenwechsel");
  });

  test("ohne Menübaum (Vorschau): ein Beispiel ohne Links", () => {
    const html = inhalt(
      seite(dok(b("seitenwechsel", {})), { navigation: [], pfad: "/vorschau" }),
    );
    expect(html).toContain("Vorherige Seite");
    expect(html).toContain("Nächste Seite");
    expect(html).not.toContain('<a class="seitenwechsel-link');
  });

  test("Maskierung der Titel", () => {
    const html = inhalt(
      seite(dok(b("seitenwechsel", {})), {
        navigation: [nav("/a", BOESE), nav("/b", "B")],
        pfad: "/b",
      }),
    );
    expect(html).not.toContain("<x-boese");
  });
});
