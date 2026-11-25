import { describe, expect, test } from "vitest";
// @ts-expect-error TS7016: kein Typ für die JavaScript-Datei
import * as l from "../public/admin/website-fotos-logik.js";

// Fotos, Albumliste (#794): Suchen, Filtern, Sortieren, Gruppieren, schrittweise Anzeige; reine Funktionen, erfundene Alben
type Album = {
  id: string;
  titel: string;
  eigenerTitel: string | null;
  anzahl: number;
  datum: string | null;
  sichtbar: boolean;
  version: number;
};
const album = (id: string, mit: Partial<Album> = {}): Album => ({
  id,
  titel: `Album ${id}`,
  eigenerTitel: null,
  anzahl: 10,
  datum: "2026-05-28",
  sichtbar: false,
  version: 0,
  ...mit,
});
const ids = (alben: Album[]) => alben.map((a) => a.id);

describe("Suche", () => {
  const a = album("1", { titel: "Pfingstlager Bäume", eigenerTitel: "Wald" });
  test("jedes Wort muss vorkommen, gross und klein egal", () => {
    expect(l.trifftFrage(a, "")).toBe(true);
    expect(l.trifftFrage(a, "  ")).toBe(true);
    expect(l.trifftFrage(a, "wald")).toBe(true);
    expect(l.trifftFrage(a, "PFINGST wald")).toBe(true);
    expect(l.trifftFrage(a, "pfingst sommer")).toBe(false);
  });
  test("findet den eigenen Titel und den von Flickr", () => {
    expect(l.trifftFrage(a, "wald")).toBe(true);
    expect(l.trifftFrage(a, "bäume")).toBe(true);
  });
  test("ä gilt auch als a und ae", () => {
    expect(l.trifftFrage(a, "baeume")).toBe(true);
    expect(l.trifftFrage(a, "baume")).toBe(true);
    expect(l.trifftFrage(album("2", { titel: "Strasse" }), "straße")).toBe(
      true,
    );
    expect(l.trifftFrage(album("3", { titel: "Café" }), "cafe")).toBe(true);
  });
});

describe("Filter", () => {
  const alben = [
    album("1", { sichtbar: true, datum: "2026-01-02" }),
    album("2", { datum: "2025-03-04" }),
    album("3", { datum: null }),
    album("4", { sichtbar: true, datum: "2025-12-31", titel: "Herbst" }),
  ];
  const f = { frage: "", sicht: "alle", jahr: "" };
  test("Sicht, Jahr und Frage zusammen", () => {
    expect(ids(l.filtere(alben, f))).toEqual(["1", "2", "3", "4"]);
    expect(ids(l.filtere(alben, { ...f, sicht: "sichtbar" }))).toEqual([
      "1",
      "4",
    ]);
    expect(ids(l.filtere(alben, { ...f, sicht: "nicht" }))).toEqual(["2", "3"]);
    expect(ids(l.filtere(alben, { ...f, jahr: "2025" }))).toEqual(["2", "4"]);
    expect(ids(l.filtere(alben, { ...f, jahr: "ohne" }))).toEqual(["3"]);
    expect(
      ids(
        l.filtere(alben, { frage: "herbst", sicht: "sichtbar", jahr: "2025" }),
      ),
    ).toEqual(["4"]);
  });
  test("Zahlen der Sicht berücksichtigen Suche und Jahr, nicht die Sicht", () => {
    expect(l.zaehleSicht(alben, f)).toEqual({ alle: 4, sichtbar: 2, nicht: 2 });
    expect(l.zaehleSicht(alben, { ...f, jahr: "2025" })).toEqual({
      alle: 2,
      sichtbar: 1,
      nicht: 1,
    });
    expect(l.zaehleSicht(alben, { ...f, sicht: "nicht" }).alle).toBe(4);
  });
  test("Jahre: neueste zuerst, «ohne» am Ende", () => {
    expect(l.jahre(alben)).toEqual(["2026", "2025", "ohne"]);
    expect(l.jahre([alben[0]])).toEqual(["2026"]);
    expect(l.jahre([])).toEqual([]);
  });
});

describe("Sortierung", () => {
  const alben = [
    album("1", { datum: "2024-01-01", titel: "B", anzahl: 5 }),
    album("2", { datum: null, titel: "A", anzahl: 50 }),
    album("3", { datum: "2026-06-01", titel: "C", anzahl: 5 }),
    album("4", { datum: "2026-06-01", titel: "A2", anzahl: 5 }),
  ];
  test("neu und alt: ohne Datum zuletzt, gleiches Datum nach Titel", () => {
    expect(ids(l.sortiere(alben, "neu"))).toEqual(["4", "3", "1", "2"]);
    expect(ids(l.sortiere(alben, "alt"))).toEqual(["1", "4", "3", "2"]);
  });
  test("Titel A–Z mit Zahlen in natürlicher Reihenfolge", () => {
    expect(ids(l.sortiere(alben, "titel"))).toEqual(["2", "4", "1", "3"]);
    const z = [album("a", { titel: "Tag 10" }), album("b", { titel: "Tag 9" })];
    expect(ids(l.sortiere(z, "titel"))).toEqual(["b", "a"]);
  });
  test("Grösse: die meisten Fotos zuerst; die Eingabe bleibt unverändert", () => {
    const vorher = ids(alben);
    expect(ids(l.sortiere(alben, "gross"))[0]).toBe("2");
    expect(ids(alben)).toEqual(vorher);
  });
  test("der eigene Titel zählt, wo es einen gibt", () => {
    const z = [
      album("a", { titel: "Z", eigenerTitel: "A" }),
      album("b", { titel: "M" }),
    ];
    expect(ids(l.sortiere(z, "titel"))).toEqual(["a", "b"]);
  });
});

describe("Gruppen und schrittweise Anzeige", () => {
  const alben = [
    album("1", { datum: "2024-01-01" }),
    album("2", { datum: null }),
    album("3", { datum: "2026-06-01" }),
    album("4", { datum: "2026-02-01" }),
  ];
  test("nach Jahr nur bei Sortierung nach Datum", () => {
    const g = l.gruppiere(alben, "neu");
    expect(g.map((x: { schluessel: string }) => x.schluessel)).toEqual([
      "2026",
      "2024",
      "ohne",
    ]);
    expect(g[2].titel).toBe("Ohne Datum");
    expect(l.gruppiere(alben, "alt")[0].schluessel).toBe("2024");
    const flach = l.gruppiere(alben, "titel");
    expect(flach).toHaveLength(1);
    expect(flach[0].titel).toBe("");
    expect(flach[0].alben).toHaveLength(4);
  });
  test("schneide baut nur Zeilen offener Gruppen, höchstens limit", () => {
    const viele = Array.from({ length: 100 }, (_, i) =>
      album(String(i), { datum: "2026-01-01" }),
    );
    const g = l.gruppiere(
      [...viele, album("x", { datum: "2020-01-01" })],
      "neu",
    );
    const s = l.schneide(g, (_g: unknown, i: number) => i === 0, 40);
    expect(s.gruppen[0].gezeigt).toHaveLength(40);
    expect(s.gruppen[1].gezeigt).toHaveLength(0);
    expect(s.gruppen[1].offen).toBe(false);
    expect(s.rest).toBe(60);
    const alle = l.schneide(g, () => true, 120);
    expect(alle.rest).toBe(0);
    expect(alle.gruppen[1].gezeigt).toHaveLength(1);
    // Das Limit gilt über Gruppen hinweg
    const knapp = l.schneide(g, () => true, 100);
    expect(knapp.gruppen[1].gezeigt).toHaveLength(0);
    expect(knapp.rest).toBe(1);
  });
});

describe("Sammelaktion", () => {
  const alben = [album("1", { sichtbar: true }), album("2"), album("3")];
  test("ändert nur, was noch nicht so steht, in der Reihenfolge der Liste", () => {
    expect(ids(l.zuAendern(alben, new Set(["3", "1", "2"]), true))).toEqual([
      "2",
      "3",
    ]);
    expect(ids(l.zuAendern(alben, new Set(["1", "2"]), false))).toEqual(["1"]);
    expect(l.zuAendern(alben, new Set(), true)).toEqual([]);
  });
  test("Bestätigung erst bei mehr als 5 neu sichtbaren Alben", () => {
    expect(l.brauchtBestaetigung(5)).toBe(false);
    expect(l.brauchtBestaetigung(6)).toBe(true);
  });
});

describe("Texte", () => {
  test("Zähler und Einzahl", () => {
    expect(l.zaehlText(87, 87)).toBe("87 Alben");
    expect(l.zaehlText(23, 87)).toBe("23 von 87 Alben");
    expect(l.zaehlText(1, 1)).toBe("1 Album");
    expect(l.zaehlText(0, 1)).toBe("0 von 1 Album");
    expect(l.fotosText(1)).toBe("1 Foto");
    expect(l.fotosText(393)).toBe("393 Fotos");
    expect(l.sammelText(1, true)).toBe(
      "1 Album ist jetzt auf der Website zu sehen.",
    );
    expect(l.sammelText(12, false)).toBe("12 Alben sind ausgeblendet.");
  });
  test("Datum kurz", () => {
    expect(l.datumKurz("2026-10-04")).toMatch(/^Okt\.? 2026$/);
    expect(l.datumKurz(null)).toBe("");
    expect(l.datumKurz("kaputt")).toBe("");
  });
});
