import { describe, expect, test } from "vitest";
import {
  MAX_VORSCHLAG,
  schlageVor,
  type VorschlagDienst,
  type VorschlagEingabe,
} from "../../src/lager/schichtvorschlag.js";

// Der Vorschlag ist eine reine Funktion: Alles hier läuft ohne Datenbank
const TAGE = Array.from(
  { length: 14 },
  (_, i) => `tag${String(i).padStart(2, "0")}`,
);
const dienst = (
  id: string,
  abschnitt: string,
  mindest: number,
  nacht = false,
): VorschlagDienst => ({
  id,
  tagesabschnittId: abschnitt,
  mindestbesetzung: mindest,
  nacht,
});
const DIENSTE = [
  dienst("fruehstueck", "morgen", 2),
  dienst("mittag", "mittag", 2),
  dienst("abend", "abend", 2),
  dienst("nachtwache", "nacht", 1, true),
];
const LEUTE = ["a", "b", "c", "d", "e", "f"].map((k) => `p:${k}`);

const eingabe = (teil: Partial<VorschlagEingabe> = {}): VorschlagEingabe => ({
  tage: TAGE,
  planTage: TAGE,
  dienste: DIENSTE,
  kandidaten: LEUTE,
  vorhanden: [],
  verfuegbar: () => true,
  seed: 1,
  ...teil,
});

const zaehle = (neu: { schluessel: string }[]) => {
  const je = new Map<string, number>();
  for (const n of neu) je.set(n.schluessel, (je.get(n.schluessel) ?? 0) + 1);
  return je;
};

describe("schlageVor", () => {
  test("füllt jeden Platz und gibt bei gleichem Startwert dasselbe, auch bei anderer Eingabereihenfolge", () => {
    const a = schlageVor(eingabe());
    expect(a.neu).toHaveLength(TAGE.length * 7);
    expect(a.unbesetzt).toEqual([]);
    expect(schlageVor(eingabe())).toEqual(a);
    // Die Reihenfolge der Kandidaten aus der Datenbank spielt keine Rolle
    expect(
      schlageVor(eingabe({ kandidaten: [...LEUTE].reverse() })).neu,
    ).toEqual(a.neu);
    // Ein anderer Startwert gibt eine andere Verteilung
    expect(schlageVor(eingabe({ seed: 2 })).neu).not.toEqual(a.neu);
  });

  test("keine Doppelbelegung im selben Abschnitt, auch bei zwei Diensten im Abschnitt", () => {
    const dienste = [...DIENSTE, dienst("abwasch", "abend", 2)];
    const r = schlageVor(eingabe({ dienste }));
    const abschnitt = new Map(dienste.map((d) => [d.id, d.tagesabschnittId]));
    const felder = r.neu.map(
      (n) => `${n.schluessel}|${n.lagertagId}|${abschnitt.get(n.dienstId)}`,
    );
    expect(new Set(felder).size).toBe(felder.length);
    expect(r.unbesetzt).toEqual([]);
  });

  test("keine Nachtwachen an aufeinanderfolgenden Tagen", () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = schlageVor(eingabe({ seed }));
      const nachts = new Map<string, number[]>();
      for (const n of r.neu.filter((x) => x.dienstId === "nachtwache")) {
        nachts.set(n.schluessel, [
          ...(nachts.get(n.schluessel) ?? []),
          TAGE.indexOf(n.lagertagId),
        ]);
      }
      for (const tage of nachts.values()) {
        tage.sort((x, y) => x - y);
        tage.forEach(
          (t, i) => i > 0 && expect(t - tage[i - 1]!).toBeGreaterThan(1),
        );
      }
    }
  });

  test("Verteilung: die Zahl der Dienste je Person unterscheidet sich um höchstens eins", () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = schlageVor(eingabe({ seed }));
      const zahlen = LEUTE.map((k) => zaehle(r.neu).get(k) ?? 0);
      expect(
        Math.max(...zahlen) - Math.min(...zahlen),
        `seed ${seed}`,
      ).toBeLessThanOrEqual(1);
      // Die Nachtwachen verteilen sich ebenso
      const nacht = zaehle(r.neu.filter((n) => n.dienstId === "nachtwache"));
      const nz = LEUTE.map((k) => nacht.get(k) ?? 0);
      expect(Math.max(...nz) - Math.min(...nz)).toBeLessThanOrEqual(1);
    }
  });

  test("Verteilung zählt bestehende Schichten mit", () => {
    // a hat schon 10 Dienste: Der Vorschlag gibt a nur dort etwas, wo andere nicht mehr können
    const vorhanden = TAGE.slice(0, 10).map((t, i) => ({
      lagertagId: t,
      dienstId: i % 2 ? "mittag" : "fruehstueck",
      schluessel: "p:a",
    }));
    const r = schlageVor(eingabe({ vorhanden, planTage: TAGE.slice(0, 10) }));
    const zahlen = zaehle(r.neu);
    expect(zahlen.get("p:a") ?? 0).toBeLessThan(zahlen.get("p:b") ?? 0);
    // Die bestehenden Plätze sind belegt: je Dienst und Tag höchstens so viele neue, wie fehlen
    const frueh = r.neu.filter(
      (n) => n.dienstId === "fruehstueck" && n.lagertagId === TAGE[0],
    );
    expect(frueh).toHaveLength(1);
    expect(frueh.some((n) => n.schluessel === "p:a")).toBe(false);
    expect(r.statistik.get("p:a")!.vorher).toBe(10);
  });

  test("wer nicht verfügbar ist, bekommt nie einen Dienst in diesem Feld", () => {
    const r = schlageVor(
      eingabe({
        verfuegbar: (k, tag, abschnitt) =>
          !(k === "p:a" && (tag < "tag05" || abschnitt === "nacht")) &&
          k !== "p:f",
      }),
    );
    expect(r.neu.some((n) => n.schluessel === "p:f")).toBe(false);
    expect(
      r.neu.some(
        (n) =>
          n.schluessel === "p:a" &&
          (n.lagertagId < "tag05" || n.dienstId === "nachtwache"),
      ),
    ).toBe(false);
    expect(r.unbesetzt).toEqual([]);
  });

  test("Plätze ohne genug Leute bleiben unbesetzt und werden genannt", () => {
    const r = schlageVor(
      eingabe({ kandidaten: ["p:a", "p:b"], planTage: [TAGE[0]!] }),
    );
    // Zwei Leute: Frühstück, Mittag und Abend je 2, Nachtwache 1
    expect(r.neu).toHaveLength(7);
    expect(r.unbesetzt).toEqual([]);
    const knapp = schlageVor(
      eingabe({ kandidaten: ["p:a"], planTage: [TAGE[0]!] }),
    );
    expect(knapp.neu).toHaveLength(4);
    expect(knapp.unbesetzt).toEqual([
      { lagertagId: TAGE[0], dienstId: "fruehstueck", fehlend: 1 },
      { lagertagId: TAGE[0], dienstId: "mittag", fehlend: 1 },
      { lagertagId: TAGE[0], dienstId: "abend", fehlend: 1 },
    ]);
    expect(schlageVor(eingabe({ kandidaten: [] })).neu).toEqual([]);
  });

  test("nur die gewünschten Tage werden gefüllt, bestehende Schichten ändern sich nie", () => {
    const vorhanden = [
      { lagertagId: TAGE[2]!, dienstId: "nachtwache", schluessel: "p:b" },
    ];
    const r = schlageVor(
      eingabe({ planTage: [TAGE[1]!, TAGE[2]!, TAGE[3]!], vorhanden }),
    );
    expect(new Set(r.neu.map((n) => n.lagertagId))).toEqual(
      new Set([TAGE[1], TAGE[2], TAGE[3]]),
    );
    // Die Nachtwache an Tag 2 ist besetzt, b bekommt weder davor noch danach eine
    expect(
      r.neu.some(
        (n) => n.dienstId === "nachtwache" && n.lagertagId === TAGE[2],
      ),
    ).toBe(false);
    expect(
      r.neu.some(
        (n) =>
          n.dienstId === "nachtwache" &&
          n.schluessel === "p:b" &&
          (n.lagertagId === TAGE[1] || n.lagertagId === TAGE[3]),
      ),
    ).toBe(false);
  });

  test("Personen, die nicht zur Auswahl stehen, belegen ihren Platz, bekommen aber keine Zähler", () => {
    const r = schlageVor(
      eingabe({
        planTage: [TAGE[0]!],
        vorhanden: [
          { lagertagId: TAGE[0]!, dienstId: "mittag", schluessel: "t:fremd" },
          { lagertagId: TAGE[0]!, dienstId: "mittag", schluessel: "t:fremd2" },
        ],
      }),
    );
    expect(r.neu.some((n) => n.dienstId === "mittag")).toBe(false);
    expect(r.statistik.has("t:fremd")).toBe(false);
  });

  test("ein Lauf ist auf MAX_VORSCHLAG Schichten begrenzt", () => {
    const viele = Array.from({ length: 100 }, (_, i) => `p:${i}`);
    const dienste = Array.from({ length: 50 }, (_, i) =>
      dienst(`d${i}`, `a${i % 12}`, 20),
    );
    const r = schlageVor(eingabe({ kandidaten: viele, dienste }));
    expect(r.neu).toHaveLength(MAX_VORSCHLAG);
    expect(r.gekuerzt).toBe(true);
  });
});
