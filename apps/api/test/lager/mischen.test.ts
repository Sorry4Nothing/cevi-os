import { describe, expect, test } from "vitest";
import { mische, type Mischling } from "../../src/lager/mischen.js";

const personen = (...stufen: [string | null, number][]) =>
  stufen.flatMap(([stufe, n], s) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${String(s).padStart(2, "0")}-${String(i).padStart(3, "0")}`,
      stufe,
    })),
  );
const stufeVon = (liste: Mischling[]) =>
  new Map(liste.map((p) => [p.id, p.stufe]));
const je = (gruppen: string[][], liste: Mischling[], stufe: string | null) =>
  gruppen.map(
    (g) => g.filter((id) => stufeVon(liste).get(id) === stufe).length,
  );

describe("mische", () => {
  const liste = personen(["Biber", 7], ["Wolf", 10], ["Pfadi", 5], [null, 3]);

  test("gleiche Eingabe und gleicher Startwert geben dieselbe Einteilung, unabhängig von der Reihenfolge der Eingabe", () => {
    const a = mische(liste, 4, 42);
    expect(mische(liste, 4, 42)).toEqual(a);
    expect(mische([...liste].reverse(), 4, 42)).toEqual(a);
    expect(mische(liste, 4, 43)).not.toEqual(a);
  });

  test("jede Person kommt genau einmal vor, die Gruppen unterscheiden sich um höchstens eins", () => {
    const g = mische(liste, 4, 7);
    expect(g.flat().sort()).toEqual(liste.map((p) => p.id).sort());
    const grössen = g.map((x) => x.length);
    expect(Math.max(...grössen) - Math.min(...grössen)).toBeLessThanOrEqual(1);
  });

  test.each([2, 3, 5, 7, 20])(
    "jede Stufe verteilt sich auf %i Gruppen um höchstens eins",
    (anzahl) => {
      const g = mische(liste, anzahl, 99);
      for (const stufe of ["Biber", "Wolf", "Pfadi", null]) {
        const n = je(g, liste, stufe);
        expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1);
      }
    },
  );

  test("Stufen werden ohne Beachtung der Gross- und Kleinschreibung zusammengefasst", () => {
    const l = personen(["Wolf", 3], ["wolf", 3]);
    const g = mische(l, 3, 1);
    expect(g.map((x) => x.length)).toEqual([2, 2, 2]);
    // Eine Stufe von sechs auf drei Gruppen: je zwei
    expect(g.every((x) => x.length === 2)).toBe(true);
  });

  test("ohne Personen sind die Gruppen leer; mehr Gruppen als Personen lassen Gruppen leer", () => {
    expect(mische([], 3, 1)).toEqual([[], [], []]);
    const g = mische(personen(["Wolf", 2]), 5, 1);
    expect(g.map((x) => x.length)).toEqual([1, 1, 0, 0, 0]);
  });

  test("verschiedene Startwerte mischen die Reihenfolge innerhalb der Stufe", () => {
    const l = personen(["Wolf", 20]);
    const verschieden = new Set(
      Array.from({ length: 8 }, (_, s) => JSON.stringify(mische(l, 2, s))),
    );
    expect(verschieden.size).toBeGreaterThan(1);
  });
});
