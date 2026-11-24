import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Module «Aufgaben», «Zeitplan» und «To-dos» im Lager-Arbeitsbereich (#670): die reinen Rechnungen, die Rechte der Rolle und Prüfungen am Quelltext ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let logik: Modul;
let gemeinsam: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  logik = await lade("lager-aufgaben-logik.js");
  gemeinsam = await lade("lager-aufgaben-gemeinsam.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");

const person = (id: string, name = id) => ({ id, name, ceviName: null });
const aufgabe = (id: string, wert: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  titel: `Aufgabe ${id}`,
  status: "offen",
  frist: null,
  spaeterAb: null,
  notiz: null,
  teil: null,
  stern: false,
  laufend: false,
  reihenfolge: Number(id.replace(/\D/g, "")) || 0,
  ressortId: null,
  ressort: null,
  verantwortlich: null,
  unterstuetzung: [],
  ...wert,
});
const HEUTE = "2027-03-15";

describe("Aufgaben: Abschnitte nach Frist", () => {
  test.each([
    ["überfällig", { frist: "2027-03-10" }, "ueberfaellig"],
    ["heute ist nicht überfällig", { frist: "2027-03-15" }, "bald"],
    ["in 14 Tagen ist bald", { frist: "2027-03-29" }, "bald"],
    ["in 15 Tagen ist später", { frist: "2027-03-30" }, "spaeter"],
    ["ohne Frist", {}, "ohneFrist"],
    [
      "erledigt schlägt überfällig",
      { frist: "2027-03-01", status: "erledigt" },
      "erledigt",
    ],
    [
      "vertagt bleibt ruhig unter später",
      { frist: "2027-03-10", spaeterAb: "2027-03-20" },
      "spaeter",
    ],
    [
      "die Erinnerung ist heute fällig",
      { frist: "2027-03-10", spaeterAb: "2027-03-15" },
      "ueberfaellig",
    ],
  ])("%s", (_name, wert, erwartet) => {
    expect(logik.abschnitt!(aufgabe("1", wert), HEUTE)).toBe(erwartet);
  });

  test("ueberfaelligTage zählt nur offene Aufgaben mit vergangener Frist", () => {
    expect(
      logik.ueberfaelligTage!(aufgabe("1", { frist: "2027-03-12" }), HEUTE),
    ).toBe(3);
    expect(
      logik.ueberfaelligTage!(aufgabe("1", { frist: "2027-03-15" }), HEUTE),
    ).toBeNull();
    expect(
      logik.ueberfaelligTage!(
        aufgabe("1", { frist: "2027-03-01", status: "erledigt" }),
        HEUTE,
      ),
    ).toBeNull();
    expect(logik.ueberfaelligTage!(aufgabe("1"), HEUTE)).toBeNull();
  });

  test("fristWort nennt Tage in Worten", () => {
    expect(logik.fristWort!(aufgabe("1", { frist: "2027-03-12" }), HEUTE)).toBe(
      "Überfällig seit 3 Tagen",
    );
    expect(logik.fristWort!(aufgabe("1", { frist: "2027-03-14" }), HEUTE)).toBe(
      "Überfällig seit 1 Tag",
    );
    expect(logik.fristWort!(aufgabe("1", { frist: HEUTE }), HEUTE)).toBe(
      "Heute",
    );
    expect(logik.fristWort!(aufgabe("1", { frist: "2027-03-16" }), HEUTE)).toBe(
      "Morgen",
    );
    expect(logik.fristWort!(aufgabe("1", { frist: "2027-03-18" }), HEUTE)).toBe(
      "In 3 Tagen",
    );
    expect(logik.fristWort!(aufgabe("1", { frist: "2027-04-01" }), HEUTE)).toBe(
      "Do, 01.04.2027",
    );
    expect(logik.fristWort!(aufgabe("1"), HEUTE)).toBe("Keine Frist");
  });

  test("Datumsrechnung ohne Zeitzone: Tage zwischen, addieren, Wochentag", () => {
    expect(logik.tageZwischen!("2027-03-15", "2027-03-29")).toBe(14);
    expect(logik.tageZwischen!("2027-03-28", "2027-03-29")).toBe(1);
    expect(logik.addiereTage!("2027-03-31", 1)).toBe("2027-04-01");
    expect(logik.addiereTage!("2027-03-01", -1)).toBe("2027-02-28");
    expect(logik.wochentag!("2027-03-15")).toBe("Mo");
  });
});

describe("Aufgaben: Filter, Gruppen, Meine", () => {
  const liste = [
    aufgabe("1", {
      titel: "Zelte prüfen",
      ressortId: "r1",
      ressort: { id: "r1", kuerzel: "MAT", name: "Material" },
      verantwortlich: person("p1", "Mia"),
      frist: "2027-03-10",
    }),
    aufgabe("2", {
      titel: "Küche planen",
      ressortId: "r2",
      ressort: { id: "r2", kuerzel: "KÜ", name: "Küche" },
      unterstuetzung: [person("p1", "Mia")],
      stern: true,
    }),
    aufgabe("3", {
      titel: "Programm",
      status: "erledigt",
      verantwortlich: person("p2", "Jonas"),
    }),
  ];

  test("Suche in Titel, Teilbereich und Notiz, ohne Gross- und Kleinschreibung", () => {
    expect(logik.filtere!(liste, { suche: "ZELTE" }, HEUTE)).toHaveLength(1);
    expect(
      logik.filtere!(
        [aufgabe("9", { notiz: "Bei Frau Muster fragen" })],
        { suche: "muster" },
        HEUTE,
      ),
    ).toHaveLength(1);
  });

  test("Person: verantwortlich oder unterstützend; «niemand» sind Aufgaben ohne Verantwortliche", () => {
    expect(
      logik.filtere!(liste, { person: "p1" }, HEUTE).map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual(["1", "2"]);
    expect(
      logik.filtere!(liste, { person: "niemand" }, HEUTE).map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual(["2"]);
  });

  test("Ressort, Status, Frist und Gemerkt", () => {
    expect(logik.filtere!(liste, { ressort: "r2" }, HEUTE)).toHaveLength(1);
    expect(
      logik.filtere!(liste, { ressort: "keins" }, HEUTE).map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual(["3"]);
    expect(logik.filtere!(liste, { status: "offene" }, HEUTE)).toHaveLength(2);
    expect(logik.filtere!(liste, { status: "erledigt" }, HEUTE)).toHaveLength(
      1,
    );
    expect(
      logik.filtere!(liste, { frist: "ueberfaellig" }, HEUTE).map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual(["1"]);
    expect(logik.filtere!(liste, { frist: "ohne" }, HEUTE)).toHaveLength(2);
    expect(
      logik.filtere!(liste, { gemerkt: "ja" }, HEUTE).map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual(["2"]);
  });

  test("Gruppen: leere fehlen, ohne Person und ohne Ressort zuletzt", () => {
    const nachFrist = logik.gruppiere!(liste, "abschnitt", HEUTE);
    expect(nachFrist.map((g: { schluessel: string }) => g.schluessel)).toEqual([
      "ueberfaellig",
      "ohneFrist",
      "erledigt",
    ]);
    const nachPerson = logik.gruppiere!(liste, "person", HEUTE);
    expect(nachPerson.map((g: { titel: string }) => g.titel)).toEqual([
      "Jonas",
      "Mia",
      "Ohne Verantwortliche",
    ]);
    const nachRessort = logik.gruppiere!(liste, "ressort", HEUTE);
    expect(nachRessort.at(-1).titel).toBe("Kein Ressort");
    expect(logik.gruppiere!(liste, "keine", HEUTE)).toHaveLength(1);
  });

  test("Meine: offene zuerst nach Frist, Erledigtes am Ende", () => {
    const eigene = logik.meine!(
      [
        ...liste,
        aufgabe("4", {
          verantwortlich: person("p1", "Mia"),
          status: "erledigt",
        }),
      ],
      "p1",
    );
    expect(eigene.map((a: { id: string }) => a.id)).toEqual(["1", "2", "4"]);
  });

  test("Board: vier Spalten, «Nächster Höck» nur mit solchen Aufgaben", () => {
    expect(
      logik.spalten!(liste).map((s: { schluessel: string }) => s.schluessel),
    ).toEqual(["offen", "laeuft", "wartet", "erledigt"]);
    const mit = logik.spalten!([
      ...liste,
      aufgabe("5", { status: "naechster_hoeck" }),
    ]);
    expect(mit.at(-1).schluessel).toBe("naechster_hoeck");
  });
});

describe("Aufgaben: Reihenfolge und Schnelleingabe", () => {
  test("eintraegeNach gibt ID und letzte bekannte Version in der neuen Reihenfolge", () => {
    const l = [aufgabe("1", { version: 3 }), aufgabe("2", { version: 5 })];
    expect(logik.eintraegeNach!(l, ["2", "1"])).toEqual([
      { id: "2", version: 5 },
      { id: "1", version: 3 },
    ]);
    expect(logik.eintraegeNach!(l, ["2", "9"])).toEqual([
      { id: "2", version: 5 },
    ]);
  });

  test("reihenfolgeEintraege: eine Stelle weiter; am Rand bewegt sich nichts", () => {
    const l = [aufgabe("1"), aufgabe("2"), aufgabe("3")];
    expect(
      logik.reihenfolgeEintraege!(l, "1", 1)!.map((e: { id: string }) => e.id),
    ).toEqual(["2", "1", "3"]);
    expect(logik.reihenfolgeEintraege!(l, "1", -1)).toBeNull();
    expect(logik.reihenfolgeEintraege!(l, "9", 1)).toBeNull();
  });

  const vorschlag = (wert: Record<string, unknown>) => ({
    zeile: "x",
    titel: "Offerte einholen",
    person: null,
    ressort: null,
    frist: null,
    hinweise: [],
    ...wert,
  });

  test("ein gefundener Treffer setzt Person, Ressort und Frist", () => {
    const v = vorschlag({
      person: {
        status: "gefunden",
        text: "Jonas",
        kandidaten: [{ id: "p1", name: "Jonas" }],
      },
      ressort: {
        status: "gefunden",
        text: "Mat",
        kandidaten: [{ id: "r1", kuerzel: "MAT", name: "Material" }],
      },
      frist: { datum: "2027-03-15", text: "bis 15.3." },
    });
    expect(logik.vorschlagBereit!(v)).toBe(true);
    expect(logik.vorschlagZuAufgabe!(v)).toEqual({
      titel: "Offerte einholen",
      verantwortlichPersonId: "p1",
      ressortId: "r1",
      frist: "2027-03-15",
    });
  });

  test("ein mehrdeutiger Treffer wartet auf die Wahl, «Keine Angabe» lässt das Feld weg", () => {
    const v = vorschlag({
      person: {
        status: "mehrdeutig",
        text: "Jo",
        kandidaten: [{ id: "p1" }, { id: "p2" }],
      },
    });
    expect(logik.vorschlagBereit!(v)).toBe(false);
    expect(logik.vorschlagBereit!(v, { person: "p2" })).toBe(true);
    expect(
      logik.vorschlagZuAufgabe!(v, { person: "p2" }).verantwortlichPersonId,
    ).toBe("p2");
    expect(logik.vorschlagBereit!(v, { person: "" })).toBe(true);
    expect(logik.vorschlagZuAufgabe!(v, { person: "" })).toEqual({
      titel: "Offerte einholen",
    });
  });

  test("ein Hinweis (Titel fehlt, Datum ungültig) hält die Zeile zurück", () => {
    expect(
      logik.vorschlagBereit!(vorschlag({ hinweise: ["TITEL_FEHLT"] })),
    ).toBe(false);
  });
});

describe("Zeitplan: Tage, Monat, Verschiebung", () => {
  const lager = { von: "2027-07-17", bis: "2027-07-19" };

  test("fehlende Lagertage: nur die Tage des Lagers ohne Eintrag", () => {
    expect(logik.fehlendeLagertage!(lager, [{ datum: "2027-07-18" }])).toEqual([
      "2027-07-17",
      "2027-07-19",
    ]);
    expect(logik.tageImLager!("2027-07-19", "2027-07-17")).toEqual([]);
  });

  test("zeitplanTage: je Tag eine Gruppe aus Lagertag, Meilensteinen und Fristen; Erledigtes fehlt", () => {
    const zeitplan = {
      lagertage: [
        { id: "t1", datum: "2027-07-17", label: "Anreise", version: 1 },
      ],
      meilensteine: [
        {
          id: "m1",
          datum: "2027-07-17",
          titel: "Packen",
          version: 1,
          art: null,
        },
      ],
      tagesabschnitte: [],
    };
    const tage = logik.zeitplanTage!(
      zeitplan,
      [
        aufgabe("1", { frist: "2027-07-17" }),
        aufgabe("2", { frist: "2027-07-17", status: "erledigt" }),
        aufgabe("3", { frist: "2027-06-01" }),
      ],
      lager,
      "2027-07-01",
    );
    expect(tage.map((t: { datum: string }) => t.datum)).toEqual([
      "2027-06-01",
      "2027-07-17",
    ]);
    expect(tage[1].lagertag.nummer).toBe(1);
    expect(tage[1].meilensteine).toHaveLength(1);
    expect(tage[1].fristen).toHaveLength(1);
    expect(tage[1].imLager).toBe(true);
    expect(tage[0].imLager).toBe(false);
  });

  test("monatsZellen: Montag zuerst, Auffüllen auf volle Wochen", () => {
    const z = logik.monatsZellen!(2027, 2);
    expect(z.length % 7).toBe(0);
    // 1. März 2027 ist ein Montag
    expect(z[0]).toBe("2027-03-01");
    expect(z.filter(Boolean)).toHaveLength(31);
    // 1. Mai 2027 ist ein Samstag: fünf leere Zellen davor
    expect(logik.monatsZellen!(2027, 4).slice(0, 6)).toEqual([
      null,
      null,
      null,
      null,
      null,
      "2027-05-01",
    ]);
  });

  test("verschiebungSatz und relative Frist in Worten", () => {
    expect(logik.verschiebungSatz!(0)).toContain("keine Aufgabe");
    expect(logik.verschiebungSatz!(1)).toBe("1 Aufgabe ändert ihre Frist.");
    expect(logik.verschiebungSatz!(7)).toBe("7 Aufgaben ändern ihre Frist.");
    expect(logik.relativeFristText!(-3, "Anreise")).toBe(
      "3 Tage vor «Anreise»",
    );
    expect(logik.relativeFristText!(1, null)).toBe("1 Tag nach Lagerbeginn");
    expect(logik.relativeFristText!(0, "Packen")).toBe("Am Tag von «Packen»");
  });
});

describe("Konflikt und Rechte", () => {
  test("feldWert löst IDs und Wörter auf", () => {
    const ids = {
      ressorts: new Map([["r1", "MAT Material"]]),
      personen: new Map([["p1", "Mia"]]),
    };
    expect(logik.feldWert!("ressortId", "r1", ids)).toBe("MAT Material");
    expect(logik.feldWert!("verantwortlichPersonId", "p1", ids)).toBe("Mia");
    expect(logik.feldWert!("status", "laeuft")).toBe("Läuft");
    expect(logik.feldWert!("frist", "2027-03-15")).toBe("15.03.2027");
    expect(logik.feldWert!("stern", true)).toBe("Ja");
    expect(logik.feldWert!("notiz", null)).toBe("leer");
  });

  test("rechteVon: Lesen und Schreiben folgen der Rolle, ein geschlossenes Lager sperrt das Schreiben", () => {
    const leitung = gemeinsam.rechteVon!({
      rechte: [
        "aufgaben.lesen_alle",
        "aufgaben.bearbeiten",
        "zeitplan.lesen",
        "zeitplan.bearbeiten",
        "vorlagen.anwenden",
        "verlauf.lesen",
      ],
    });
    expect(leitung).toMatchObject({
      lesenAlle: true,
      bearbeiten: true,
      status: true,
      verschieben: true,
      vorlagen: true,
      verlauf: true,
      zu: false,
    });

    const team = gemeinsam.rechteVon!({
      rechte: ["aufgaben.eigene", "zeitplan.lesen"],
    });
    expect(team).toMatchObject({
      lesen: true,
      lesenAlle: false,
      bearbeiten: false,
      status: true,
      zeitplanBearbeiten: false,
      verschieben: false,
      vorlagen: false,
    });

    const lesen = gemeinsam.rechteVon!({ rechte: ["aufgaben.lesen_alle"] });
    expect(lesen).toMatchObject({
      lesenAlle: true,
      bearbeiten: false,
      status: false,
    });

    const zu = gemeinsam.rechteVon!({
      rechte: ["aufgaben.bearbeiten", "zeitplan.bearbeiten"],
      schreibgeschuetzt: true,
    });
    expect(zu).toMatchObject({
      zu: true,
      bearbeiten: false,
      status: false,
      zeitplanBearbeiten: false,
      verschieben: false,
    });

    // Die Verschiebung ändert Fristen von Aufgaben: ohne aufgaben.bearbeiten gibt es sie nicht
    const nurZeitplan = gemeinsam.rechteVon!({
      rechte: ["zeitplan.bearbeiten", "zeitplan.lesen"],
    });
    expect(nurZeitplan.zeitplanBearbeiten).toBe(true);
    expect(nurZeitplan.verschieben).toBe(false);

    expect(gemeinsam.rechteVon!({ rechte: [] }).lesen).toBe(false);
  });

  test("istKonflikt und istGeschlossen erkennen die zwei 409", () => {
    expect(
      gemeinsam.istKonflikt!({ status: 409, code: "VERSION_KONFLIKT" }),
    ).toBe(true);
    expect(
      gemeinsam.istKonflikt!({ status: 409, code: "LAGER_GESCHLOSSEN" }),
    ).toBe(false);
    expect(
      gemeinsam.istGeschlossen!({ status: 409, code: "LAGER_GESCHLOSSEN" }),
    ).toBe(true);
  });
});

describe("Quelltext: Routen, Adressen, Regeln der Verwaltung", () => {
  const DATEIEN = [
    "lager-m-aufgaben.js",
    "lager-aufgaben-neu.js",
    "lager-aufgaben-detail.js",
    "lager-aufgaben-gemeinsam.js",
    "lager-aufgaben-logik.js",
    "lager-m-zeitplan.js",
    "lager-m-todos.js",
  ];
  const alle = DATEIEN.map(quelle).join("\n");

  test("die Module hängen im Register mit dem Recht, das die Navigation prüft", () => {
    const register = quelle("lager-module.js");
    expect(register).toContain('schluessel: "aufgaben"');
    expect(register).toContain(
      "aufgaben.lesen_alle|aufgaben.bearbeiten|aufgaben.eigene",
    );
    expect(register).toContain('schluessel: "zeitplan"');
    expect(register).toContain('recht: "zeitplan.lesen"');
    expect(register).toContain('schluessel: "todos"');
    expect(register).toContain("./lager-m-aufgaben.js");
    expect(register).toContain("./lager-m-zeitplan.js");
    expect(register).toContain("./lager-m-todos.js");
    expect(quelle("index.html")).toContain('href="/admin/lager-aufgaben.css"');
  });

  test("jedes Modul exportiert zeige(bereich, ctx, lagerId, lager)", () => {
    for (const d of [
      "lager-m-aufgaben.js",
      "lager-m-zeitplan.js",
      "lager-m-todos.js",
    ]) {
      expect(quelle(d)).toMatch(
        /export function zeige\(bereich, ctx, lagerId, lager\)/,
      );
    }
  });

  test("nur Routen der Lager-API, nie die Verwaltungsrouten der Abteilung", () => {
    expect(alle).toContain("/api/v1/lager/");
    expect(alle).not.toContain("/api/v1/admin/");
    for (const pfad of [
      "/aufgaben",
      "/aufgaben/schnell",
      "/aufgaben/reihenfolge",
      "/aufgaben/duplikate",
      "/details",
      "/checkliste",
      "/links",
      "/stichworte",
      "/zusammenfuehren",
      "/verlauf",
      "/zeitplan",
      "/zeitplan/vorschlag",
      "/zeitplan/uebernehmen",
      "/zeitplan/meilensteine",
      "/verschieben",
      "/zeitplan/lagertage",
      "/zeitplan/tagesabschnitte",
      "/vorlagen",
      "/anwenden",
      "/todos",
      "/mitglieder",
      "/ressorts",
    ]) {
      expect(alle, pfad).toContain(pfad);
    }
  });

  test("die Verschiebung zeigt erst die Vorschau (trocken) und bestätigt mit den Aufgaben und ihren Versionen", () => {
    const q = quelle("lager-m-zeitplan.js");
    expect(q).toContain("trocken: true");
    expect(q).toContain("trocken: false");
    expect(q.replace(/\s+/g, " ")).toContain(
      "vorschau.aufgaben.map((a) => ({ id: a.id, version: a.version, }))",
    );
    expect(q).toContain("VORSCHAU_VERALTET");
  });

  test("Konflikte: Der Server liefert den Stand, die Person wählt; nichts wird still überschrieben", () => {
    const q = quelle("lager-aufgaben-gemeinsam.js");
    expect(q).toContain("Meine Änderung übernehmen");
    expect(q).toContain("Stand des Servers übernehmen");
    expect(quelle("lager-aufgaben-detail.js")).toContain("konfliktKarte");
    expect(quelle("lager-m-aufgaben.js")).toContain(
      "Meine Änderung übernehmen",
    );
  });

  test("Löschen geht über «Rückgängig», die Reihenfolge über die Sortierliste, Ziehen mit Griff, Knöpfen und Tastatur", () => {
    expect(quelle("lager-m-aufgaben.js")).toContain("ctx.mitRueckgaengig");
    expect(quelle("lager-m-aufgaben.js")).toContain("sortierListe");
    expect(quelle("lager-aufgaben-detail.js")).toContain("sortierListe");
    expect(quelle("lager-m-todos.js")).toContain("sortierListe");
    expect(quelle("lager-m-zeitplan.js")).toContain("sortierListe");
  });

  test("keine rohen Kästchen, keine Popups, keine Browserfelder für Datum und Zahl", () => {
    expect(alle).not.toMatch(
      /type:\s*"checkbox"|type=["']checkbox|\balert\(|\bconfirm\(|\bprompt\(/,
    );
    expect(alle).not.toMatch(/type:\s*"(date|time|number|datetime-local)"/);
    expect(alle).toContain("ankreuzen");
    expect(alle).toContain("datumsfeld");
  });

  test("kein Polling, keine Inline-Stile, kein Browserspeicher", () => {
    expect(alle).not.toMatch(
      /setInterval|\.style\b|setAttribute\("style"|localStorage|sessionStorage|innerHTML/,
    );
    expect(quelle("lager-aufgaben.css")).not.toMatch(
      /:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/,
    );
  });

  test("Bewegung nur bei erlaubter Bewegung; erzwungene Farben sind bedacht", () => {
    const css = quelle("lager-aufgaben.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    // Übergänge stehen nur im Zweig für erlaubte Bewegung
    const ausserhalb = css.split(
      "@media (prefers-reduced-motion: no-preference)",
    )[0]!;
    expect(ausserhalb).not.toMatch(/transition:|animation:/);
  });

  test("Vertrauliches steht nie in Adresse oder Titel: Die Adresse trägt nur IDs", () => {
    expect(alle).not.toMatch(
      /location\.hash\s*=\s*`[^`]*\$\{[^}]*(titel|name|text)/,
    );
  });
});
