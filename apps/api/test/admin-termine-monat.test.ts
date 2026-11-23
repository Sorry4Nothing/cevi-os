import { beforeAll, describe, expect, test, vi } from "vitest";

// Monatsansicht des Kalenders (#590): reine Funktionen ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let m: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  // Als Text, damit tsc die Browserdatei nicht als Modul des Programms prüft
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  m = await lade("termine-monat.js");
  vi.unstubAllGlobals();
});

const ganz = (id: string, von: string, bis: string, titel = id) => ({
  id,
  titel,
  ganztaegig: true,
  tagVon: von,
  tagBis: bis,
  beginn: null,
  ende: null,
  status: "aktiv",
  ort: null,
  tags: [],
});
const zeit = (id: string, beginn: string, ende: string, titel = id) => ({
  id,
  titel,
  ganztaegig: false,
  tagVon: null,
  tagBis: null,
  beginn,
  ende,
  status: "aktiv",
  ort: null,
  tags: [{ id: "g1", name: "Pilami" }],
});

describe("termine-monat.js", () => {
  test("monatsWochen: Montag zuerst, 5 oder 6 Wochen, Ränder aus den Nachbarmonaten", () => {
    // Januar 2027 beginnt an einem Freitag und hat 5 Wochen
    const w = m.monatsWochen!("2027-01");
    expect(w).toHaveLength(5);
    expect(w[0]![0]).toBe("2026-12-28");
    expect(w[0]![4]).toBe("2027-01-01");
    expect(w.at(-1)![6]).toBe("2027-01-31");
    // August 2026 beginnt an einem Samstag und braucht 6 Wochen
    expect(m.monatsWochen!("2026-08")).toHaveLength(6);
    // Februar 2027 beginnt an einem Montag und hat genau 4 Wochen
    expect(m.monatsWochen!("2027-02")).toHaveLength(4);
    expect(m.monatsZeitraum!("2027-02")).toEqual({
      von: "2027-02-01",
      bis: "2027-02-28",
    });
  });

  test("terminTage: Zeitpunkte zählen in Schweizer Tagen, Mitternacht gehört zum Vortag", () => {
    // 22:30 UTC im Winter ist 23:30 in Zürich, 23:30 UTC schon der nächste Tag
    expect(
      m.terminTage!(zeit("a", "2027-01-16T22:30:00Z", "2027-01-16T23:30:00Z")),
    ).toEqual(["2027-01-16", "2027-01-17"]);
    // Ende genau um Mitternacht (23:00 UTC im Winter): bleibt beim Vortag
    expect(
      m.terminTage!(zeit("b", "2027-01-16T13:00:00Z", "2027-01-16T23:00:00Z")),
    ).toEqual(["2027-01-16", "2027-01-16"]);
    expect(m.terminTage!(ganz("c", "2027-07-24", "2027-08-02"))).toEqual([
      "2027-07-24",
      "2027-08-02",
    ]);
  });

  test("nachTagen: ein mehrtägiger Termin steht an jedem Tag, Ganztägige zuerst", () => {
    const karte = m.nachTagen!([
      zeit("t", "2027-01-16T13:00:00Z", "2027-01-16T16:00:00Z", "Programm"),
      ganz("l", "2027-01-15", "2027-01-17", "Lager"),
    ]);
    expect(karte.get("2027-01-15").map((t: { id: string }) => t.id)).toEqual([
      "l",
    ]);
    expect(karte.get("2027-01-16").map((t: { id: string }) => t.id)).toEqual([
      "l",
      "t",
    ]);
    expect(karte.has("2027-01-18")).toBe(false);
  });

  test("wochenBahnen: Ein Mehrtägiger bleibt in derselben Bahn", () => {
    const woche = m.monatsWochen!("2027-01")[1]!;
    const lager = ganz("l", "2027-01-05", "2027-01-08");
    const eins = ganz("e", "2027-01-06", "2027-01-06");
    const karte = m.nachTagen!([lager, eins]);
    const bahnen = m.wochenBahnen!(woche, karte);
    // Dienstag 5.: nur das Lager in Bahn 0; Mittwoch 6.: Lager in Bahn 0, der Eintag in Bahn 1
    expect(bahnen[1]![0].id).toBe("l");
    expect(bahnen[2]![0].id).toBe("l");
    expect(bahnen[2]![1].id).toBe("e");
    expect(bahnen[3]![0].id).toBe("l");
    expect(bahnen[3]![1] ?? null).toBeNull();
  });

  test("naechsterTag: Pfeile, Pos1/Ende, Bild auf/ab", () => {
    expect(m.naechsterTag!("2027-01-16", "ArrowRight")).toBe("2027-01-17");
    expect(m.naechsterTag!("2027-01-16", "ArrowUp")).toBe("2027-01-09");
    expect(m.naechsterTag!("2027-01-16", "Home")).toBe("2027-01-11");
    expect(m.naechsterTag!("2027-01-16", "End")).toBe("2027-01-17");
    expect(m.naechsterTag!("2027-01-31", "PageDown")).toBe("2027-02-28");
    expect(m.naechsterTag!("2027-01-16", "PageUp", true)).toBe("2026-01-16");
    expect(m.naechsterTag!("2027-01-16", "a")).toBeNull();
  });

  test("ansichtAusPfad und adresseVon: gültige Adressen, alte Adresse 12, Müll fällt auf den heutigen Monat", () => {
    const heute = "2026-11-23";
    expect(m.ansichtAusPfad!([], heute)).toEqual({
      art: "monat",
      monat: "2026-11",
      tag: null,
    });
    expect(m.ansichtAusPfad!(["2027-01"], heute).monat).toBe("2027-01");
    expect(m.ansichtAusPfad!(["2027-01-16"], heute)).toEqual({
      art: "monat",
      monat: "2027-01",
      tag: "2027-01-16",
    });
    expect(m.ansichtAusPfad!(["12"], heute)).toEqual({
      art: "liste",
      zeitraum: "12",
    });
    expect(m.ansichtAusPfad!(["liste"], heute).zeitraum).toBe("3");
    expect(m.ansichtAusPfad!(["2027-13"], heute).monat).toBe("2026-11");
    expect(m.ansichtAusPfad!(["2027-02-30"], heute).monat).toBe("2026-11");
    expect(m.adresseVon!({ art: "liste", zeitraum: "12" })).toBe(
      "#termine/kalender/liste/12",
    );
    expect(m.adresseVon!({ art: "monat", monat: "2027-01", tag: null })).toBe(
      "#termine/kalender/2027-01",
    );
  });

  test("filtere: Suche in Titel und Ort, Gruppe, ohne Gruppe", () => {
    const a = {
      ...zeit("a", "2027-01-16T13:00:00Z", "2027-01-16T16:00:00Z", "Waldtag"),
    };
    const b = ganz("b", "2027-01-20", "2027-01-20", "Hajk");
    expect(m.filtere!([a, b], { suche: "wald" })).toEqual([a]);
    expect(m.filtere!([a, b], { gruppe: "g1" })).toEqual([a]);
    expect(m.filtere!([a, b], { gruppe: "keine" })).toEqual([b]);
    expect(m.filtere!([a, b], {})).toHaveLength(2);
  });

  test("ladeMonat: holt weitere Seiten und merkt sich den Monat", async () => {
    const seiten = [
      { termine: [{ id: "1" }], weitere: true, naechste: "x" },
      { termine: [{ id: "2" }], weitere: false, naechste: null },
    ];
    const hole = vi.fn(async () => seiten.shift()!);
    const daten = await m.ladeMonat!("2031-05", hole);
    expect(daten.termine).toHaveLength(2);
    expect(daten.unvollstaendig).toBe(false);
    await m.ladeMonat!("2031-05", hole);
    expect(hole).toHaveBeenCalledTimes(2);
    // Zeitraum des Monats geht an die Abfrage
    expect(hole.mock.calls[0]).toEqual(["2031-04-28", "2031-06-01", ""]);
  });
});
