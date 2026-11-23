import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as l from "../public/admin/belegung-layout.js";

type Teil = { von: number; bis: number };

describe("Belegungsplan: Rechnen (belegung-layout.js)", () => {
  test("Tage und Minuten in Schweizer Zeit, Sommer und Winter", () => {
    // Sommer: UTC+2
    expect(l.zuerichTeile("2099-07-01T22:30:00.000Z")).toEqual({
      tag: "2099-07-02",
      minuten: 30,
    });
    // Winter: UTC+1
    expect(l.zuerichTeile("2099-01-14T23:30:00.000Z")).toEqual({
      tag: "2099-01-15",
      minuten: 30,
    });
    // Mitternacht ist 00:00, nicht 24:00
    expect(l.zuerichTeile("2099-01-14T23:00:00.000Z").minuten).toBe(0);
  });

  test("Wochen: Montag, Kalenderwoche, Tage über den Jahreswechsel", () => {
    expect(l.montagVon("2026-11-29")).toBe("2026-11-23");
    expect(l.montagVon("2026-11-23")).toBe("2026-11-23");
    expect(l.wochenTage("2026-11-23")).toHaveLength(7);
    expect(l.wochenTage("2026-12-28").at(-1)).toBe("2027-01-03");
    expect(l.kalenderwoche("2026-11-23")).toEqual({ jahr: 2026, woche: 48 });
    // Der 1. Januar 2027 (Freitag) gehört zur Woche 53 von 2026
    expect(l.kalenderwoche("2027-01-01")).toEqual({ jahr: 2026, woche: 53 });
    // Sommerzeitwechsel verschiebt keinen Tag
    expect(l.plusTage("2026-03-28", 1)).toBe("2026-03-29");
    expect(l.plusTage("2026-03-29", 1)).toBe("2026-03-30");
  });

  test("eine Buchung auf Tage verteilen; Ende um Mitternacht hat keinen Teil am Folgetag", () => {
    const eine = {
      beginn: "2099-03-02T08:00:00.000Z",
      ende: "2099-03-02T10:30:00.000Z",
    };
    expect(l.tagesTeile(eine, "2099-03-01", "2099-03-07")).toEqual([
      { tag: "2099-03-02", von: 540, bis: 690 },
    ]);
    const ueberNacht = {
      beginn: "2099-03-02T20:00:00.000Z",
      ende: "2099-03-04T06:00:00.000Z",
    };
    expect(l.tagesTeile(ueberNacht, "2099-03-01", "2099-03-07")).toEqual([
      { tag: "2099-03-02", von: 21 * 60, bis: 1440 },
      { tag: "2099-03-03", von: 0, bis: 1440 },
      { tag: "2099-03-04", von: 0, bis: 7 * 60 },
    ]);
    // auf den gezeigten Zeitraum zugeschnitten
    expect(l.tagesTeile(ueberNacht, "2099-03-03", "2099-03-03")).toEqual([
      { tag: "2099-03-03", von: 0, bis: 1440 },
    ]);
    const bisMitternacht = {
      beginn: "2099-03-02T21:00:00.000Z",
      ende: "2099-03-02T23:00:00.000Z",
    };
    expect(l.tagesTeile(bisMitternacht, "2099-03-01", "2099-03-07")).toEqual([
      { tag: "2099-03-02", von: 22 * 60, bis: 1440 },
    ]);
  });

  test("Achse: 07 bis 23 Uhr, bei Bedarf um volle Stunden erweitert", () => {
    expect(l.achseFuer([])).toEqual({ anfang: 420, ende: 1380, laenge: 960 });
    expect(l.achseFuer([{ von: 9 * 60, bis: 10 * 60 }])).toMatchObject({
      anfang: 420,
      ende: 1380,
    });
    expect(l.achseFuer([{ von: 5 * 60 + 30, bis: 23 * 60 + 40 }])).toEqual({
      anfang: 300,
      ende: 1440,
      laenge: 1140,
    });
  });

  test("Lage in Prozent der Achse, zugeschnitten", () => {
    const achse = l.achseFuer([]);
    expect(l.lageAufAchse(420, 1380, achse)).toEqual({ links: 0, breite: 100 });
    const mitte = l.lageAufAchse(900, 960, achse);
    expect(mitte.links).toBeCloseTo(50);
    expect(mitte.breite).toBeCloseTo(6.25);
    // vor der Achse: links 0, nur der Teil in der Achse zählt
    const frueh = l.lageAufAchse(360, 480, achse);
    expect(frueh.links).toBe(0);
    expect(frueh.breite).toBeCloseTo(6.25);
  });

  test("Spuren: Berührendes teilt sich die Breite, danach verbreitert sich ein Teil", () => {
    const teile: Teil[] = [
      { von: 600, bis: 720 },
      { von: 660, bis: 780 },
      { von: 700, bis: 740 },
      { von: 900, bis: 960 },
    ];
    const r = l.ordneSpuren(teile) as {
      spur: number;
      spuren: number;
      spanne: number;
    }[];
    // Die ersten drei überschneiden sich in Folge: drei Spuren
    expect(r[0]).toEqual({ spur: 0, spuren: 3, spanne: 1 });
    expect(r[1]).toEqual({ spur: 1, spuren: 3, spanne: 1 });
    expect(r[2]).toEqual({ spur: 2, spuren: 3, spanne: 1 });
    // Der letzte steht allein und füllt die ganze Breite
    expect(r[3]).toEqual({ spur: 0, spuren: 1, spanne: 1 });
    // Ein Teil neben freien Spuren verbreitert sich
    const breit = l.ordneSpuren([
      { von: 600, bis: 780 },
      { von: 600, bis: 660 },
      { von: 700, bis: 780 },
    ]) as { spur: number; spuren: number; spanne: number }[];
    expect(breit[0]).toEqual({ spur: 0, spuren: 2, spanne: 1 });
    expect(breit[2]).toEqual({ spur: 1, spuren: 2, spanne: 1 });
    const frei = l.ordneSpuren([
      { von: 600, bis: 780 },
      { von: 600, bis: 660 },
    ]) as { spur: number; spuren: number; spanne: number }[];
    expect(frei.map((x) => x.spuren)).toEqual([2, 2]);
    const luecke = l.ordneSpuren([
      { von: 600, bis: 660 },
      { von: 600, bis: 780 },
      { von: 720, bis: 780 },
    ]) as { spur: number; spuren: number; spanne: number }[];
    // Die kurze Buchung in Spur 1 endet vor 720: Der dritte Teil nimmt ihre Spur
    expect(luecke[2]).toMatchObject({ spur: 1, spuren: 2 });
  });

  test("freie Fenster: Lücken ab 30 Minuten, Überschneidungen zählen einmal", () => {
    const frei = l.freieFenster([
      { von: 540, bis: 600 },
      { von: 570, bis: 660 },
      { von: 1350, bis: 1380 },
    ]);
    expect(frei).toEqual([
      { von: 420, bis: 540 },
      { von: 660, bis: 1350 },
    ]);
    // Fenster unter 30 Minuten fallen weg
    expect(
      l.freieFenster([
        { von: 440, bis: 1380 },
        { von: 400, bis: 430 },
      ]),
    ).toEqual([]);
    expect(l.freieFenster([])).toEqual([{ von: 420, bis: 1380 }]);
    expect(l.freiText(frei)).toBe("frei 07:00–09:00, 11:00–22:30");
    expect(l.freiText([])).toBe("nicht frei");
    expect(
      l.freiText(
        [1, 2, 3, 4].map((i) => ({ von: i * 100, bis: i * 100 + 60 })),
        2,
      ),
    ).toBe("frei 01:40–02:40, 03:20–04:20 …");
  });

  test("gruppieren je Raum und Tag, Anfragen lassen sich ausblenden", () => {
    const b = (id: string, raumId: string, beginn: string, status: string) => ({
      id,
      raumId,
      status,
      beginn,
      ende: new Date(Date.parse(beginn) + 36e5).toISOString(),
    });
    const liste = [
      b("2", "r1", "2099-03-02T10:00:00.000Z", "bestaetigt"),
      b("1", "r1", "2099-03-02T08:00:00.000Z", "angefragt"),
      b("3", "r2", "2099-03-03T08:00:00.000Z", "bestaetigt"),
    ];
    const alle = l.gruppiere(liste, "2099-03-01", "2099-03-07");
    expect(
      alle
        .get("r1")
        .get("2099-03-02")
        .map((t: { buchung: { id: string } }) => t.buchung.id),
    ).toEqual(["1", "2"]);
    expect(alle.get("r2").has("2099-03-03")).toBe(true);
    const ohne = l.gruppiere(liste, "2099-03-01", "2099-03-07", false);
    expect(ohne.get("r1").get("2099-03-02")).toHaveLength(1);
  });

  test("Pfeiltasten: links und rechts in der Zeit desselben Raums, oben und unten zum nächsten Beginn", () => {
    const blocks = [
      { raum: "a", beginn: 100 },
      { raum: "a", beginn: 200 },
      { raum: "b", beginn: 150 },
      { raum: "b", beginn: 400 },
      { raum: "c", beginn: 900 },
    ];
    const raeume = ["a", "b", "c"];
    expect(l.naechsterBlock(blocks, 0, "rechts", raeume)).toBe(1);
    // am Rand des Raums bleibt der Fokus
    expect(l.naechsterBlock(blocks, 1, "rechts", raeume)).toBe(1);
    expect(l.naechsterBlock(blocks, 0, "links", raeume)).toBe(0);
    expect(l.naechsterBlock(blocks, 1, "unten", raeume)).toBe(2);
    expect(l.naechsterBlock(blocks, 3, "oben", raeume)).toBe(1);
    expect(l.naechsterBlock(blocks, 3, "unten", raeume)).toBe(4);
    expect(l.naechsterBlock(blocks, 0, "oben", raeume)).toBe(0);
  });

  test("Richtung des Wechsels: vor, zurück oder Überblendung", () => {
    const w = (datum: string) => ({ art: "woche", datum });
    expect(l.wechselRichtung(null, w("2026-11-23"))).toBe("blende");
    // innerhalb derselben Woche ist es derselbe Zeitraum
    expect(l.wechselRichtung(w("2026-11-23"), w("2026-11-29"))).toBe("blende");
    expect(l.wechselRichtung(w("2026-11-23"), w("2026-11-30"))).toBe("vor");
    expect(l.wechselRichtung(w("2026-11-30"), w("2026-11-23"))).toBe("zurueck");
    // über den Jahreswechsel
    expect(l.wechselRichtung(w("2026-12-28"), w("2027-01-04"))).toBe("vor");
    const t1 = (datum: string) => ({ art: "tag", datum });
    expect(l.wechselRichtung(t1("2026-11-24"), t1("2026-11-25"))).toBe("vor");
    expect(l.wechselRichtung(t1("2026-11-25"), t1("2026-11-24"))).toBe(
      "zurueck",
    );
    expect(l.wechselRichtung(t1("2026-11-24"), t1("2026-11-24"))).toBe(
      "blende",
    );
    // andere Ansicht: immer Überblendung
    expect(l.wechselRichtung(w("2026-11-23"), t1("2026-11-30"))).toBe("blende");
  });
});
