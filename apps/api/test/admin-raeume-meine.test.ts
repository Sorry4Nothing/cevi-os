import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as nav from "../public/admin/navigation.js";

// «Meine Anfragen» der Räume (#671): reine Funktionen (Zeit in Zürich, Prüfung) und Quelltext-Prüfungen ohne Browser.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let raeume: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {}, history: {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  raeume = await lade("raeume-meine.js");
  vi.unstubAllGlobals();
});

const quelle = readFileSync(
  new URL("../public/admin/raeume-meine.js", import.meta.url),
  "utf8",
);
// Montag, 1. Februar 2027, 08:00 Zürcher Zeit
const JETZT = Date.parse("2027-02-01T07:00:00.000Z");

describe("Meine Anfragen: Zeit in Zürich", () => {
  test("Sommer- und Winterzeit", () => {
    expect(raeume.zuerichZuIso("2027-07-17", "14:00")).toBe(
      "2027-07-17T12:00:00.000Z",
    );
    expect(raeume.zuerichZuIso("2027-01-12", "18:40")).toBe(
      "2027-01-12T17:40:00.000Z",
    );
    // Umstellung am 28. März 2027 um 02:00 → 03:00
    expect(raeume.zuerichZuIso("2027-03-28", "09:00")).toBe(
      "2027-03-28T07:00:00.000Z",
    );
    expect(raeume.zuerichZuIso("2027-03-27", "09:00")).toBe(
      "2027-03-27T08:00:00.000Z",
    );
  });
});

describe("Meine Anfragen: Prüfung vor dem Senden", () => {
  const gut = {
    raumId: "r1",
    beginn: "2027-03-05T19:00",
    ende: "2027-03-05T21:30",
    zweck: "  Sitzung Leitungsteam ",
  };
  test("gültig: Körper für die API in Zürcher Zeit, Zweck ohne Rand", () => {
    expect(raeume.pruefeAnfrage(gut, JETZT)).toEqual({
      body: {
        beginn: "2027-03-05T18:00:00.000Z",
        ende: "2027-03-05T20:30:00.000Z",
        zweck: "Sitzung Leitungsteam",
      },
    });
  });
  test("alles leer: vier Fehler, je mit Feld und Text", () => {
    const r = raeume.pruefeAnfrage(
      { raumId: "", beginn: "", ende: "", zweck: " " },
      JETZT,
    );
    expect(r.fehler.map((f: { feld: string }) => f.feld)).toEqual([
      "raum",
      "zweck",
      "beginn",
      "ende",
    ]);
  });
  test("Vergangenheit, Ende vor Beginn, länger als 14 Tage, zu langer Zweck", () => {
    const f = (extra: object) =>
      raeume.pruefeAnfrage({ ...gut, ...extra }, JETZT).fehler;
    expect(
      f({ beginn: "2027-01-30T10:00", ende: "2027-01-30T12:00" })[0],
    ).toEqual({
      feld: "beginn",
      text: "Die Zeit muss in der Zukunft beginnen.",
    });
    expect(f({ ende: "2027-03-05T18:00" })[0].feld).toBe("ende");
    expect(f({ ende: "2027-03-05T19:00" })[0].text).toContain(
      "nach dem Beginn",
    );
    expect(f({ ende: "2027-03-20T19:00" })[0].text).toContain(
      "höchstens 14 Tage",
    );
    expect(f({ ende: "2027-03-19T19:00" })).toBeUndefined();
    expect(f({ zweck: "x".repeat(201) })[0].text).toContain("1 zu viel");
  });
});

describe("Meine Anfragen: Einbau", () => {
  test("Die Unterseite steht im Bereich Räume, nur für Leitende mit Belegung", () => {
    const raeumeBereich = nav.BEREICHE.find(
      (b: { schluessel: string }) => b.schluessel === "raeume",
    );
    const meine = raeumeBereich.unter.find(
      (u: { schluessel: string }) => u.schluessel === "meine",
    );
    expect(meine).toMatchObject({
      name: "Meine Anfragen",
      modul: "./raeume-meine.js",
      zugang: "belegung",
    });
  });
  test("Dieselben Routen wie die App, kein innerHTML, kein Browserspeicher", () => {
    for (const pfad of [
      '"/api/v1/raeume"',
      '"/api/v1/raeume/anfragen"',
      "/anfragen/meine",
      "/anfragen`",
    ]) {
      expect(quelle).toContain(pfad.replace(/^"|"$/g, ""));
    }
    const q = quelle.replace(/\/\/.*$/gm, "");
    expect(q).not.toMatch(
      /innerHTML|localStorage|sessionStorage|confirm\(|alert\(/,
    );
  });
  test("Zurückziehen fragt in der Zeile nach (zweistufig), kein Dialog des Browsers", () => {
    expect(quelle).toContain("zweistufig(");
  });
});
