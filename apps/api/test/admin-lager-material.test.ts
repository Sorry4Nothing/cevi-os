import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

// Lager-Arbeitsbereich, Module «Material und Infos» (#674): reine Funktionen und Quelltext-Prüfungen ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let hilfen: Modul;
let packliste: Modul;
let einkauf: Modul;
let notfall: Modul;
let infos: Modul;
let wetter: Modul;
let tagesseiten: Modul;
let register: {
  MODULE: { schluessel: string; recht?: string; gruppe: string }[];
};

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  hilfen = await lade("lager-m-hilfen.js");
  packliste = await lade("lager-m-packliste.js");
  einkauf = await lade("lager-m-einkauf.js");
  notfall = await lade("lager-m-notfall.js");
  infos = await lade("lager-m-infos.js");
  wetter = await lade("lager-m-wetter.js");
  tagesseiten = await lade("lager-m-tagesseiten.js");
  register = (await lade("lager-module.js")) as unknown as typeof register;
  vi.unstubAllGlobals();
});

// Die Browser-Funktionen lesen window.URL
beforeEach(() => vi.stubGlobal("window", { URL }));
afterEach(() => vi.unstubAllGlobals());

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

describe("Material und Infos: Register und Rechte", () => {
  test("jedes Modul steht mit seinem Leserecht im Register", () => {
    const soll: Record<string, string> = {
      packliste: "packliste.lesen",
      einkauf: "einkauf.lesen",
      infos: "infos.lesen",
      notfall: "notfall.lesen",
      tagesseiten: "tagesseiten.lesen",
      wetter: "wetter.lesen",
    };
    for (const [schluessel, recht] of Object.entries(soll)) {
      const e = register.MODULE.find((m) => m.schluessel === schluessel);
      expect(e?.recht, schluessel).toBe(recht);
      expect(quelle(`lager-m-${schluessel}.js`)).toContain(
        "export function zeige(",
      );
    }
  });

  test("kannLesen und kannSchreiben: das geschlossene Lager ist schreibgeschützt", () => {
    const offen = { rechte: ["packliste.lesen", "packliste.bearbeiten"] };
    expect(hilfen.kannLesen!(offen, "packliste.lesen")).toBe(true);
    expect(hilfen.kannLesen!(offen, "einkauf.lesen")).toBe(false);
    expect(hilfen.kannSchreiben!(offen, "packliste.bearbeiten")).toBe(true);
    expect(
      hilfen.kannSchreiben!(
        { ...offen, schreibgeschuetzt: true },
        "packliste.bearbeiten",
      ),
    ).toBe(false);
    expect(hilfen.kannLesen!({}, "x")).toBe(false);
  });

  test("istKonflikt erkennt nur VERSION_KONFLIKT", () => {
    expect(hilfen.istKonflikt!({ status: 409, code: "VERSION_KONFLIKT" })).toBe(
      true,
    );
    expect(
      hilfen.istKonflikt!({ status: 409, code: "LAGER_GESCHLOSSEN" }),
    ).toBe(false);
    expect(
      hilfen.istGeschlossen!({ status: 409, code: "LAGER_GESCHLOSSEN" }),
    ).toBe(true);
  });

  test("sichererLink lässt nur https zu", () => {
    expect(hilfen.sichererLink!("https://example.org/a")).toBe(
      "https://example.org/a",
    );
    expect(hilfen.sichererLink!("http://example.org")).toBeNull();
    expect(hilfen.sichererLink!("javascript:alert(1)")).toBeNull();
    expect(hilfen.sichererLink!("nichts")).toBeNull();
  });

  test("neueReihenfolge: nur geänderte Zeilen, die Werte der Zeilen bleiben im Umlauf", () => {
    const zeilen = [
      { id: "a", version: 1, reihenfolge: 2 },
      { id: "b", version: 4, reihenfolge: 5 },
      { id: "c", version: 2, reihenfolge: 9 },
    ];
    expect(hilfen.neueReihenfolge!(zeilen, ["a", "b", "c"])).toEqual([]);
    expect(hilfen.neueReihenfolge!(zeilen, ["c", "a", "b"])).toEqual([
      { id: "c", version: 2, reihenfolge: 2 },
      { id: "a", version: 1, reihenfolge: 5 },
      { id: "b", version: 4, reihenfolge: 9 },
    ]);
  });
});

describe("Material und Infos: Packliste", () => {
  const punkte = [
    {
      id: "1",
      abschnitt: "Schlafen",
      text: "Schlafsack",
      reihenfolge: 1,
      zustand: "abgehakt",
    },
    {
      id: "2",
      abschnitt: "Kleidung",
      text: "Regenjacke",
      reihenfolge: 2,
      zustand: "offen",
    },
    {
      id: "3",
      abschnitt: "Schlafen",
      text: "Matte",
      reihenfolge: 3,
      zustand: "entfernt",
    },
  ];
  const eigene = [
    {
      id: "e1",
      abschnitt: "Schlafen",
      text: "Kissen",
      reihenfolge: 0,
      abgehakt: false,
    },
    {
      id: "e2",
      abschnitt: "Eigene Punkte",
      text: "Buch",
      reihenfolge: 1,
      abgehakt: true,
    },
  ];

  test("gruppiere: Abschnitte in der Reihenfolge des ersten Punkts, eigene Punkte dazu", () => {
    const g = packliste.gruppiere!(punkte, eigene) as {
      name: string;
      zeilen: { id: string; art: string }[];
    }[];
    expect(g.map((a) => a.name)).toEqual([
      "Schlafen",
      "Kleidung",
      "Eigene Punkte",
    ]);
    // Die Vorlage steht vor den eigenen Punkten, jede Gruppe nach ihrer Reihenfolge
    expect(g[0]!.zeilen.map((z) => z.id)).toEqual(["1", "3", "e1"]);
    expect(g[0]!.zeilen.map((z) => z.art)).toEqual(["punkt", "punkt", "eigen"]);
  });

  test("zaehle: entfernte Punkte zählen nicht", () => {
    expect(packliste.zaehle!(punkte, eigene)).toEqual({
      gepackt: 2,
      gesamt: 4,
    });
  });

  test("alsText: nur offene Punkte, je Abschnitt ein Block", () => {
    expect(packliste.alsText!(punkte, eigene)).toBe(
      "Schlafen\n- Kissen\n\nKleidung\n- Regenjacke",
    );
  });

  test("Die Vorlage ordnet mit der Sortierliste, löscht mit Rückgängig und löst Konflikte am Ort", () => {
    const q = quelle("lager-m-packliste.js");
    expect(q).toContain("sortierListe");
    expect(q).toContain("ctx.mitRueckgaengig");
    expect(q).toContain("konfliktBox");
    expect(q).toContain("ankreuzen(");
    expect(q).not.toMatch(/type: "checkbox"|typ: "checkbox"/);
  });
});

describe("Material und Infos: Einkauf", () => {
  test("parseMenge: Komma und Punkt, leer ist keine Menge, Unsinn ist ungültig", () => {
    expect(einkauf.parseMenge!("")).toBeNull();
    expect(einkauf.parseMenge!(" 1,5 ")).toBe(1.5);
    expect(einkauf.parseMenge!("2")).toBe(2);
    expect(einkauf.parseMenge!("0")).toBeUndefined();
    expect(einkauf.parseMenge!("-3")).toBeUndefined();
    expect(einkauf.parseMenge!("1,2345")).toBeUndefined();
    expect(einkauf.parseMenge!("viel")).toBeUndefined();
    expect(einkauf.parseMenge!("2000000")).toBeUndefined();
  });

  test("formatMenge: Zahl mit Einheit, ohne Menge nur die Einheit", () => {
    expect(einkauf.formatMenge!(1.5, "kg")).toMatch(/^1[.,]5 kg$/);
    expect(einkauf.formatMenge!(6, null)).toBe("6");
    expect(einkauf.formatMenge!(null, "Packungen")).toBe("Packungen");
    expect(einkauf.formatMenge!(null, null)).toBe("");
  });

  test("nachAbteilung: Reihenfolge des Ladens, Erledigte unten, unbekannte Gruppe ist Diverses", () => {
    const g = einkauf.nachAbteilung!([
      { name: "Wasser", warengruppe: "getraenke", erledigt: false },
      { name: "Apfel", warengruppe: "obst_gemuese", erledigt: true },
      { name: "Birne", warengruppe: "obst_gemuese", erledigt: false },
      { name: "Etwas", warengruppe: "gibts_nicht", erledigt: false },
    ]) as { schluessel: string; zeilen: { name: string }[] }[];
    expect(g.map((x) => x.schluessel)).toEqual([
      "obst_gemuese",
      "getraenke",
      "diverses",
    ]);
    expect(g[0]!.zeilen.map((z) => z.name)).toEqual(["Birne", "Apfel"]);
  });

  test("alsText nennt nur offene Artikel mit Menge", () => {
    expect(
      einkauf.alsText!([
        {
          name: "Milch",
          menge: 6,
          einheit: "l",
          warengruppe: "milch_kaese",
          erledigt: false,
        },
        {
          name: "Brot",
          menge: null,
          einheit: null,
          warengruppe: "brot",
          erledigt: true,
        },
      ]),
    ).toBe("Milch und Käse\n- Milch 6 l");
  });

  test("Zusammenzählen, Vorschläge und Abhaken laufen über die Routen des Servers", () => {
    const q = quelle("lager-m-einkauf.js");
    expect(q).toContain("/einkauf/vorschlaege");
    expect(q).toContain('"/zusammen"');
    expect(q).toContain("version: a.version");
  });
});

describe("Material und Infos: Notfall, Infos, Wetter, Tagesseiten", () => {
  test("telefonLink enthält nur Ziffern und ein führendes Plus", () => {
    expect(notfall.telefonLink!("+41 79 123 45 67")).toBe("tel:+41791234567");
    expect(notfall.telefonLink!("079/123 45 67;x")).toBe("tel:0791234567");
  });

  test("Telefonnummern stehen nur im Inhalt, nie in Titel oder Adresse", () => {
    const q = quelle("lager-m-notfall.js");
    expect(q).not.toMatch(/ctx\.titel\([^)]*telefon/i);
    expect(q).not.toMatch(/location\.hash\s*=[^;]*telefon/i);
    expect(q).toContain("sichererLink");
  });

  test("pruefeLinks: leere Zeilen fallen weg, halbe und fremde Adressen sind Fehler", () => {
    const { links, fehler } = infos.pruefeLinks!([
      { titel: "", url: "" },
      { titel: "Karte", url: "https://example.org/k" },
      { titel: "Nur Titel", url: "" },
      { titel: "", url: "https://example.org" },
      { titel: "Böse", url: "javascript:alert(1)" },
    ]);
    expect(links).toEqual([{ titel: "Karte", url: "https://example.org/k" }]);
    expect(
      fehler.map(
        (f: { index: number; feld: string }) => `${f.index}:${f.feld}`,
      ),
    ).toEqual(["2:url", "3:titel", "4:url"]);
  });

  test("auszug kürzt und glättet Zeilenumbrüche", () => {
    expect(infos.auszug!("a\n\n b", 10)).toBe("a b");
    expect(infos.auszug!("x".repeat(200), 20)).toHaveLength(20);
  });

  test("Infos ordnen mit einem Aufruf an /infos/reihenfolge", () => {
    const q = quelle("lager-m-infos.js");
    expect(q).toContain('"/infos/reihenfolge"');
    expect(q).toContain("sortierListe");
  });

  test("parseKoordinate: Komma, leer, Grenzen", () => {
    expect(wetter.parseKoordinate!("47,37", 90)).toBe(47.37);
    expect(wetter.parseKoordinate!("", 90)).toBeNull();
    expect(wetter.parseKoordinate!("91", 90)).toBeUndefined();
    expect(wetter.parseKoordinate!("abc", 180)).toBeUndefined();
  });

  test("temperaturText und wetterSatz", () => {
    expect(wetter.temperaturText!(12.4, 21.6)).toBe("12 bis 22 °C");
    expect(wetter.temperaturText!(null, 21)).toBe("bis 21 °C");
    expect(wetter.temperaturText!(null, null)).toBe("");
    expect(
      wetter.wetterSatz!({
        zustand: "Regen",
        tmin: 10,
        tmax: 15,
        regen: 3,
        boeen: 40,
      }),
    ).toBe("Regen, 10 bis 15 °C, 3 mm Regen, Böen bis 40 km/h");
  });

  test("tagText: Wochentag und Datum ohne Zeitzonen-Sprung", () => {
    expect(wetter.tagText!("2027-07-17")).toBe("Samstag, 17.07.2027");
  });

  test("waehleTag: gewählter Tag, sonst heute, sonst der nächste, sonst der erste", () => {
    const tage = [
      { lagertagId: "a", datum: "2027-07-17" },
      { lagertagId: "b", datum: "2027-07-18" },
    ];
    expect(tagesseiten.waehleTag!(tage, "b", "2027-07-17")).toBe("b");
    expect(tagesseiten.waehleTag!(tage, "x", "2027-07-18")).toBe("b");
    expect(tagesseiten.waehleTag!(tage, undefined, "2027-07-01")).toBe("a");
    expect(tagesseiten.waehleTag!(tage, undefined, "2028-01-01")).toBe("a");
    expect(tagesseiten.waehleTag!([], undefined, "2027-07-01")).toBeNull();
  });
});

describe("Material und Infos: Regeln der Verwaltung", () => {
  const dateien = [
    "lager-m-hilfen.js",
    "lager-m-packliste.js",
    "lager-m-einkauf.js",
    "lager-m-notfall.js",
    "lager-m-infos.js",
    "lager-m-tagesseiten.js",
    "lager-m-wetter.js",
  ];
  test.each(dateien)(
    "%s: keine nativen Popups, Kästchen oder Auswahlfelder",
    (d) => {
      const q = quelle(d);
      expect(q).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(q).not.toMatch(/localStorage|sessionStorage|innerHTML/);
      expect(q).not.toMatch(
        /<select|"select"|type: "(date|time|number|checkbox)"/,
      );
      expect(q).not.toMatch(/\.style\b|setAttribute\(\s*["']style/);
    },
  );

  test("das Stylesheet ist in index.html eingebunden und druckt ohne Bedienung", () => {
    expect(quelle("index.html")).toContain("/admin/lager-material.css");
    const css = quelle("lager-material.css");
    expect(css).toContain("@media print");
    expect(css).toContain(".lm-nicht-drucken");
    expect(css).not.toMatch(/animation:/);
  });
});
