import { beforeAll, describe, expect, test, vi } from "vitest";

// Anlässe der Verwaltung (#608): reine Funktionen ohne Browser (Reihenfolge, Monate, Frist, Prozente, Änderungen) und der Umschalter «Meine Termine» des Kalenders.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let anlaesse: Modul;
let gemeinsam: Modul;
let monat: Modul;
let kalender: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  // Als Text, damit tsc die Browserdateien nicht als Module des Programms prüft
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  anlaesse = await lade("termine-anlaesse.js");
  gemeinsam = await lade("anlass-gemeinsam.js");
  monat = await lade("termine-monat.js");
  kalender = await lade("termine-kalender.js");
  vi.unstubAllGlobals();
});

const ganz = (id: string, von: string, bis = von) => ({
  id,
  ganztaegig: true,
  tagVon: von,
  tagBis: bis,
  beginn: null,
  ende: null,
});
const zeit = (id: string, beginn: string, ende: string) => ({
  id,
  ganztaegig: false,
  tagVon: null,
  tagBis: null,
  beginn,
  ende,
});

describe("Liste der Anlässe", () => {
  const vorbei = (a: { id: string }) => a.id.startsWith("alt");

  test("kommende zuerst mit dem frühesten Termin oben, dann die vergangenen mit dem neuesten oben", () => {
    const liste = [
      ganz("alt1", "2026-03-01"),
      ganz("spaet", "2027-07-24", "2027-08-02"),
      ganz("alt2", "2026-09-01"),
      zeit("frueh", "2026-12-13T07:00:00Z", "2026-12-13T10:00:00Z"),
    ];
    expect(
      anlaesse.ordne(liste, vorbei).map((a: { id: string }) => a.id),
    ).toEqual(["frueh", "spaet", "alt2", "alt1"]);
  });

  test("am selben Tag entscheidet die Uhrzeit, ganztägige stehen vor den zeitlichen", () => {
    const liste = [
      zeit("nachmittag", "2026-12-13T13:00:00Z", "2026-12-13T15:00:00Z"),
      zeit("morgen", "2026-12-13T07:00:00Z", "2026-12-13T09:00:00Z"),
      ganz("ganz", "2026-12-13"),
    ];
    expect(
      anlaesse.ordne(liste, () => false).map((a: { id: string }) => a.id),
    ).toEqual(["ganz", "morgen", "nachmittag"]);
  });

  test("Monate nach dem ersten Tag des Anlasses (Zürcher Kalendertag), in der Reihenfolge der Eingabe", () => {
    const gruppen = anlaesse.nachMonaten([
      ganz("a", "2026-12-05"),
      // 23:30 Uhr UTC am 31.12. ist in Zürich schon der 1.1.
      zeit("b", "2026-12-31T23:30:00Z", "2027-01-01T02:00:00Z"),
      ganz("c", "2027-01-16"),
    ]);
    expect(
      gruppen.map((g: { monat: string; anlaesse: { id: string }[] }) => [
        g.monat,
        g.anlaesse.map((a: { id: string }) => a.id),
      ]),
    ).toEqual([
      ["2026-12", ["a"]],
      ["2027-01", ["b", "c"]],
    ]);
  });
});

describe("Frist, Prozente, Änderungen", () => {
  const jetzt = new Date("2026-12-01T10:00:00Z");
  const offen = (frist: string | null) => ({
    ganztaegig: true,
    tagVon: "2027-06-01",
    tagBis: "2027-06-01",
    anmeldungOffen: true,
    frist,
  });

  test("der Satz zur Frist nennt Tage, Stunden und den Stand", () => {
    expect(gemeinsam.fristSatz(offen("2026-12-16T10:00:00Z"), jetzt)).toBe(
      "Noch 15 Tage bis zum Anmeldeschluss.",
    );
    expect(gemeinsam.fristSatz(offen("2026-12-02T09:00:00Z"), jetzt)).toBe(
      "Noch 23 Stunden bis zum Anmeldeschluss.",
    );
    expect(gemeinsam.fristSatz(offen("2026-12-01T10:30:00Z"), jetzt)).toBe(
      "Noch 1 Stunde bis zum Anmeldeschluss.",
    );
    expect(gemeinsam.fristSatz(offen(null), jetzt)).toBe(
      "Die Anmeldung ist bis zum Ende des Termins offen.",
    );
    expect(gemeinsam.fristSatz(offen("2026-11-20T10:00:00Z"), jetzt)).toMatch(
      /^Der Anmeldeschluss war am /,
    );
    expect(
      gemeinsam.fristSatz({ ...offen(null), anmeldungOffen: false }, jetzt),
    ).toBe("Die Anmeldung ist geschlossen.");
  });

  test("Prozente ergeben immer 100", () => {
    for (const zahlen of [
      [12, 2],
      [1, 1, 1],
      [0, 0],
      [5, 0],
      [1, 2],
    ]) {
      const p = gemeinsam.prozente(zahlen);
      expect(p.reduce((s: number, z: number) => s + z, 0)).toBe(
        zahlen.every((z) => z === 0) ? 0 : 100,
      );
    }
    expect(gemeinsam.prozente([12, 2])).toEqual([86, 14]);
    expect(gemeinsam.prozente([1, 1, 1])).toEqual([34, 33, 33]);
  });

  test("die Zahl der Änderungen zählt Einstellungen, nicht Eingaben", () => {
    const alt = {
      anmeldungFuer: "kind",
      anmeldungOffen: true,
      frist: "2026-12-07T22:59:00.000Z",
      sichtbarkeit: { art: "tags", tagIds: ["a", "b"] },
    };
    expect(gemeinsam.anzahlAenderungen(alt, { ...alt })).toBe(0);
    expect(
      gemeinsam.anzahlAenderungen(alt, { ...alt, anmeldungOffen: false }),
    ).toBe(1);
    expect(
      gemeinsam.anzahlAenderungen(alt, {
        ...alt,
        frist: null,
        sichtbarkeit: { art: "oeffentlich" },
      }),
    ).toBe(2);
  });
});

describe("Kalender: Alle Termine und Meine Termine", () => {
  const termine = [
    { id: "1", titel: "Pilami-Samstag", ort: null, tags: [], meine: true },
    { id: "2", titel: "Fröschli-Samstag", ort: null, tags: [], meine: false },
    { id: "3", titel: "Lagerwoche", ort: "Haus", tags: [], meine: true },
  ];

  test("«meine» zeigt nur die Termine der eigenen Gruppen", () => {
    expect(
      monat.filtere(termine, { nur: "meine" }).map((t: { id: string }) => t.id),
    ).toEqual(["1", "3"]);
    expect(monat.filtere(termine, { nur: "alle" })).toHaveLength(3);
    // Ohne Angabe gilt «alle»
    expect(monat.filtere(termine, {})).toHaveLength(3);
  });

  test("der Umschalter wirkt zusammen mit der Suche", () => {
    expect(
      monat
        .filtere(termine, { nur: "meine", suche: "haus" })
        .map((t: { id: string }) => t.id),
    ).toEqual(["3"]);
    expect(monat.filtere(termine, { nur: "meine", suche: "fröschli" })).toEqual(
      [],
    );
  });

  test("Standard ist «Alle Termine»: nur «meine» in der Adresse wählt Meine Termine (#622)", () => {
    expect(kalender.umfangAusPfad([])).toEqual({ nur: "alle", rest: [] });
    expect(kalender.umfangAusPfad(["2027-01"])).toEqual({
      nur: "alle",
      rest: ["2027-01"],
    });
    expect(kalender.umfangAusPfad(["liste", "12"]).nur).toBe("alle");
    expect(kalender.umfangAusPfad(["meine"])).toEqual({
      nur: "meine",
      rest: [],
    });
    expect(kalender.umfangAusPfad(["meine", "2027-01"])).toEqual({
      nur: "meine",
      rest: ["2027-01"],
    });
  });

  test("die Adresse trägt «meine» nach «kalender»", () => {
    expect(kalender.mitUmfang("#termine/kalender/2027-01", "meine")).toBe(
      "#termine/kalender/meine/2027-01",
    );
    expect(kalender.mitUmfang("#termine/kalender/liste/12", "meine")).toBe(
      "#termine/kalender/meine/liste/12",
    );
    expect(kalender.mitUmfang("#termine/kalender", "meine")).toBe(
      "#termine/kalender/meine",
    );
    expect(kalender.mitUmfang("#termine/kalender/2027-01", "alle")).toBe(
      "#termine/kalender/2027-01",
    );
  });
});
