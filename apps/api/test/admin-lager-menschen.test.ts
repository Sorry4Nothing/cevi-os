import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Lager-Module «Menschen und Einteilung» der Verwaltung (#675): reine Logik, Quelltext-Regeln und Abgleich der aufgerufenen Routen mit dem API-Vertrag; ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let logik: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  logik = await lade("lager-menschen-logik.js");
  vi.unstubAllGlobals();
});

const dir = new URL("../public/admin/", import.meta.url);
const lies = (name: string) => readFileSync(new URL(name, dir), "utf8");
const MODULE = [
  "teilnehmer",
  "abzaehlen",
  "anwesenheit",
  "gruppen",
  "zimmer",
  "fahrten",
  "schichtplan",
  "diensttausch",
  "adressbuch",
];
const quellen = Object.fromEntries(
  MODULE.map((m) => [m, lies(`lager-m-${m}.js`)]),
);
const alle = Object.values(quellen).join("\n");

describe("Logik: Import, Anwesenheit, Belegung", () => {
  test("zaehleImport: Kopfzeile und leere Zeilen zählen nicht, Limits werden früh gemeldet", () => {
    const z = logik.zaehleImport!(
      "Vorname;Nachname\nAnna;Muster\n\nBen;Probe\n",
    );
    expect(z.zeilen).toBe(2);
    expect(z.zuViele).toBe(false);
    const viele = Array.from({ length: 501 }, (_, i) => `A${i}\tB`).join("\n");
    expect(logik.zaehleImport!(viele).zuViele).toBe(true);
    expect(logik.zaehleImport!("x".repeat(40_001)).zuLang).toBe(true);
  });

  test("naechsterWert wechselt Offen, Da, Frei, Offen", () => {
    expect(logik.naechsterWert!("O")).toBe("A");
    expect(logik.naechsterWert!("A")).toBe("F");
    expect(logik.naechsterWert!("F")).toBe("O");
  });

  test("belegung: mehr als Plätze ist erlaubt und wird gemeldet", () => {
    expect(logik.belegung!({ belegt: 3, plaetze: 4 })).toMatchObject({
      text: "3 von 4 Plätzen belegt",
      ueberbelegt: false,
      frei: 1,
    });
    expect(logik.belegung!({ belegt: 5, plaetze: 4 }).ueberbelegt).toBe(true);
    expect(logik.belegung!({ belegt: 1, plaetze: 1 }).text).toBe(
      "1 von 1 Platz belegt",
    );
    expect(logik.belegung!({ belegt: 2, plaetze: null }).text).toBe(
      "2 Personen",
    );
  });

  test("tagText und datumText in Schweizer Schreibweise", () => {
    expect(logik.tagText!("2027-07-17")).toBe("Sa 17.07.");
    expect(logik.datumText!("2027-07-17")).toBe("17.07.2027");
  });

  test("besetzungText nennt das Wort zur Zahl", () => {
    expect(logik.besetzungText!(0, 2)).toBe("niemand eingeteilt");
    expect(logik.besetzungText!(1, 2)).toBe("noch ein Platz frei");
    expect(logik.besetzungText!(1, 3)).toBe("noch 2 Plätze frei");
    expect(logik.besetzungText!(2, 2)).toBe("voll besetzt");
  });

  test("besetzung: Personen dazu und weg, ohne Doppelte, getrennt nach Art", () => {
    const a = [
      { typ: "person", id: "p1" },
      { typ: "teilnehmer", id: "t1" },
    ];
    expect(
      logik.besetzung!(a, {
        dazu: [
          { typ: "person", id: "p1" },
          { typ: "person", id: "p2" },
        ],
        weg: [{ typ: "teilnehmer", id: "t1" }],
      }),
    ).toEqual({ teilnehmerIds: [], personIds: ["p1", "p2"] });
  });

  test("nachArt und Schlüssel trennen Teilnehmende und Mitglieder", () => {
    expect(
      logik.nachArt!([
        { typ: "teilnehmer", id: "t" },
        { typ: "person", id: "p" },
      ]),
    ).toEqual({ teilnehmerIds: ["t"], personIds: ["p"] });
    expect(logik.personSchluessel!("teilnehmer", "x")).toBe("t:x");
    expect(logik.personSchluessel!("person", "x")).toBe("p:x");
  });

  test("konfliktZeilen zeigt nur abweichende Felder, leere Werte als «leer»", () => {
    const zeilen = logik.konfliktZeilen!(
      {
        aktuell: { stufe: "Pfadistufe", ceviName: null, version: 3 },
        abweichend: ["stufe", "ceviName"],
      },
      [
        ["vorname", "Vorname"],
        ["stufe", "Stufe"],
        ["ceviName", "Cevi-Name"],
      ],
      { stufe: "Wolfsstufe", ceviName: "Funke" },
    );
    expect(zeilen).toEqual([
      {
        schluessel: "stufe",
        label: "Stufe",
        dein: "Wolfsstufe",
        server: "Pfadistufe",
      },
      {
        schluessel: "ceviName",
        label: "Cevi-Name",
        dein: "Funke",
        server: "leer",
      },
    ]);
  });

  test("istKonflikt erkennt nur 409 VERSION_KONFLIKT mit Stand", () => {
    expect(
      logik.istKonflikt!({
        status: 409,
        code: "VERSION_KONFLIKT",
        daten: { aktuell: {} },
      }),
    ).toBe(true);
    expect(logik.istKonflikt!({ status: 409, code: "LAGER_GESCHLOSSEN" })).toBe(
      false,
    );
  });

  test("istHttps lässt nur https als Link zu", () => {
    expect(logik.istHttps!("https://fahrplan.example/x")).toBe(true);
    expect(logik.istHttps!("javascript:alert(1)")).toBe(false);
    expect(logik.istHttps!("http://x")).toBe(false);
  });

  test("tauschSatz: tauschen, abgeben an Person, abgeben", () => {
    const schicht = { dienst: "Küche", datum: "2027-07-17" };
    expect(
      logik.tauschSatz!({
        vonName: "Anna",
        schicht,
        mitSchichtId: "s",
        mitName: "Ben",
      }),
    ).toBe("Anna möchte Küche am Sa 17.07. mit Ben tauschen");
    expect(
      logik.tauschSatz!({ vonName: "Anna", schicht, mitName: "Ben" }),
    ).toBe("Anna möchte Küche am Sa 17.07. an Ben abgeben");
    expect(logik.tauschSatz!({ vonName: "Anna", schicht })).toBe(
      "Anna möchte Küche am Sa 17.07. abgeben",
    );
  });

  test("aenderungen sendet nur geänderte Felder", () => {
    expect(
      logik.aenderungen!(
        { a: "1", b: null, c: "3" },
        { a: "1", b: "2", c: null },
      ),
    ).toEqual({ b: "2", c: null });
  });
});

describe("Register und Quelltext der Module", () => {
  test("jedes Modul steht im Register der Gruppe «Menschen» mit dem Recht des Servers", () => {
    const reg = lies("lager-module.js");
    for (const m of MODULE) {
      expect(reg).toContain(`schluessel: "${m}"`);
      expect(reg).toContain(`import("./lager-m-${m}.js")`);
    }
    expect(reg).toContain('recht: "einteilung.lesen"');
    expect(reg).toContain('recht: "teilnehmer.lesen"');
    expect(reg).toContain('recht: "adressbuch.lesen"');
    expect(reg).toContain("anwesenheit.lesen_alle|anwesenheit.eigene");
    expect(reg).toContain("diensttausch.anfragen|diensttausch.entscheiden");
  });

  test("jedes Modul exportiert zeige(bereich, ctx, lagerId, lager)", () => {
    for (const q of Object.values(quellen))
      expect(q).toMatch(
        /export function zeige\(bereich, ctx, lagerId, lager\)/,
      );
  });

  test("die Stilvorlage ist eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/lager-menschen.css"');
  });

  test("Rechte blenden Knöpfe aus: Schreiben nur über k.kann()", () => {
    for (const m of [
      "teilnehmer",
      "abzaehlen",
      "anwesenheit",
      "gruppen",
      "zimmer",
      "fahrten",
      "schichtplan",
      "diensttausch",
      "adressbuch",
    ])
      expect(quellen[m], m).toMatch(
        /(k\.kann|schreiben)\(\s*"[a-z]+\.[a-z_]+"/,
      );
    // Das Leserecht entscheidet über die ganze Seite
    for (const m of MODULE) expect(quellen[m]).toContain("k.darf(");
  });

  test("Konflikte: Formulare zeigen beide Stände, Wiederholung mit der Version des Servers", () => {
    const g = lies("lager-menschen.js");
    expect(g).toContain("Meine Änderung übernehmen");
    expect(g).toContain("Stand des Servers übernehmen");
    for (const m of [
      "teilnehmer",
      "zimmer",
      "fahrten",
      "gruppen",
      "schichtplan",
      "adressbuch",
    ])
      expect(quellen[m]).toContain("sendeMitKonflikt");
    // Anwesenheit führt den Konflikt im Matrix-Fall selbst
    expect(quellen.anwesenheit).toContain("VERSION_KONFLIKT");
    // Nur Geändertes wird gesendet: ein Konflikt überschreibt nichts, was niemand anfasste
    expect(quellen.teilnehmer).toContain("geaendert");
  });

  test("Zuteilen per Ziehen hat immer eine Alternative ohne Ziehen (WCAG 2.5.7)", () => {
    for (const m of ["zimmer", "fahrten", "gruppen"]) {
      expect(quellen[m]).toContain("zielFlaeche");
      expect(quellen[m]).toContain("personZeile");
      expect(quellen[m]).toContain("auswahlLeiste");
      expect(quellen[m]).toMatch(/Verschieben|Einteilen nach|Zuteilen/);
    }
    // Schichtplan: «Besetzen» als Alternative zum Ziehen
    expect(quellen.schichtplan).toContain("besetzenSeite");
    const z = lies("lager-ziehen.js");
    expect(z).toContain("pointerdown");
    expect(z).toContain("Escape");
    expect(z).toContain("prefers-reduced-motion");
  });

  test("Löschen läuft mit Rückgängig, nie mit Popup", () => {
    for (const m of [
      "teilnehmer",
      "zimmer",
      "fahrten",
      "gruppen",
      "schichtplan",
      "adressbuch",
    ])
      expect(quellen[m]).toContain("ctx.mitRueckgaengig");
    expect(alle).not.toMatch(
      /window\.(confirm|alert|prompt)|\bconfirm\(|\balert\(/,
    );
  });

  test("keine rohen Kästchen, kein natives Datum, kein Polling, keine Inline-Stile", () => {
    expect(alle).not.toMatch(
      /type: "checkbox"|typ: "checkbox"|typ: "date"|typ: "time"/,
    );
    expect(alle).not.toMatch(/setInterval|setAttribute\("style"|cssText/);
    expect(alle).toContain("ankreuzen(");
    expect(quellen.fahrten).toContain("datumsfeld(");
    expect(quellen.fahrten).toContain("zeitfeld(");
  });

  test("Fahrplan-Links nur mit https, mit rel noopener", () => {
    expect(quellen.fahrten).toContain("istHttps(");
    expect(quellen.fahrten).toContain('rel: "noopener noreferrer"');
  });

  test("Import: Vorschau zuerst, 500 Zeilen, Fehlerliste mit Zeilennummer", () => {
    const t = quellen.teilnehmer;
    expect(t).toContain("uebernehmen: uebernehmenJetzt");
    expect(t).toContain("IMPORT_MAX_ZEILEN");
    expect(t).toContain("Fehler in diesen Zeilen");
    expect(t).toContain("`Zeile ${f.zeile}: `");
  });

  test("Zurücksetzen der Abzählliste fragt am Ort und sendet die Bestätigung", () => {
    expect(quellen.abzaehlen).toContain("zweistufigerKnopf");
    expect(quellen.abzaehlen).toContain("bestaetigt: true");
  });

  test("Vertrauliches: Adressbuch zeigt den Hinweis zum Protokoll und lädt die Liste einmal", () => {
    expect(quellen.adressbuch).toContain("Jeder Abruf wird protokolliert");
    expect(quellen.adressbuch).toContain("180 Tage");
    // Suche lokal: kein weiterer Abruf je Eingabe
    expect(quellen.adressbuch).not.toMatch(/adressbuch\?q=/);
  });

  test("kein localStorage, kein innerHTML, keine fremden Adressen", () => {
    const dateien = [
      ...MODULE.map((m) => `lager-m-${m}.js`),
      "lager-menschen.js",
      "lager-menschen-logik.js",
      "lager-ziehen.js",
    ];
    for (const d of dateien) {
      const q = lies(d);
      expect(q).not.toMatch(
        /localStorage|sessionStorage|innerHTML|outerHTML|insertAdjacentHTML/,
      );
      expect(q.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(
        /https?:\/\//,
      );
    }
  });
});

describe("Aufgerufene Routen kennt der API-Vertrag", () => {
  const vertrag = readFileSync(
    new URL("../../../docs/api/openapi.yaml", import.meta.url),
    "utf8",
  );
  const pfade = new Set(
    [...vertrag.matchAll(/^ {2}(\/api\/v1\/lager\/\{id\}[^:\n]*):/gm)].map(
      (m) => m[1]!.replace(/\{[^}]+\}/g, "{}"),
    ),
  );
  const methoden = (quelle: string) =>
    [
      ...quelle.matchAll(
        /anfrage\(\s*"(\w+)",\s*`\$\{LB\(([\w.]+)\)\}([^`?]*)/g,
      ),
    ].map((t) => [
      t[1]!,
      "/api/v1/lager/{}" + t[3]!.replace(/\$\{[^}]+\}/g, "{}"),
    ]);
  const ladeAlleRouten = (quelle: string) =>
    [...quelle.matchAll(/ladeAlle\(\s*`\$\{LB\(\w+\)\}([^`?]*)/g)].map((t) => [
      "GET",
      "/api/v1/lager/{}" + t[1]!.replace(/\$\{[^}]+\}/g, "{}"),
    ]);

  test("jede Route der Module steht im Vertrag", () => {
    const gefunden = new Set<string>();
    for (const q of Object.values(quellen))
      for (const [, pfad] of [...methoden(q), ...ladeAlleRouten(q)])
        gefunden.add(pfad!);
    expect(gefunden.size).toBeGreaterThan(30);
    for (const p of gefunden) expect(pfade, p).toContain(p);
  });

  test("auch die Schreibwege der Konfliktbehandlung sind PATCH, nie PUT auf Zeilen", () => {
    expect(alle).not.toMatch(
      /anfrage\("PUT", `\$\{LB\(k\.lagerId\)\}\/(teilnehmer|zimmer|fahrten|adressbuch)\/\$/,
    );
  });

  test("alle Module liegen in public/admin", () => {
    const dateien = readdirSync(dir);
    for (const m of MODULE) expect(dateien).toContain(`lager-m-${m}.js`);
  });
});
