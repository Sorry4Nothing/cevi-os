import { expect, test } from "vitest";
import { stufenFuerTitel } from "../../src/kalender/zuordnung.js";

const STUFEN = [
  { id: "s1", name: "Biber", kuerzel: "BI" },
  { id: "s2", name: "Wölfe", kuerzel: "WÖ" },
  { id: "s3", name: "Pfadi (Mädchen)", kuerzel: "PM" },
];

test("das Wort «Stufen» meint alle Stufen, gleich in welcher Schreibweise", () => {
  for (const titel of [
    "Waldtag Stufen",
    "STUFEN Waldtag",
    "Waldtag, stufen!",
  ]) {
    expect(stufenFuerTitel(titel, STUFEN)).toEqual(["s1", "s2", "s3"]);
  }
});

test("«Stufen» zählt nur als ganzes Wort", () => {
  for (const titel of ["Stufenleitung", "Oberstufen", "Stufenlager"]) {
    expect(stufenFuerTitel(titel, STUFEN)).toEqual([]);
  }
});

test("ein Stufenname oder ein Kürzel als ganzes Wort trifft die Stufe, unabhängig von der Schreibweise", () => {
  expect(stufenFuerTitel("Waldtag Biber", STUFEN)).toEqual(["s1"]);
  expect(stufenFuerTitel("wölfe-Nachmittag", STUFEN)).toEqual(["s2"]);
  expect(stufenFuerTitel("Waldtag wö", STUFEN)).toEqual(["s2"]);
});

test("mehrere Stufennamen ergeben mehrere Stufen", () => {
  expect(stufenFuerTitel("Biber und Wölfe im Wald", STUFEN)).toEqual([
    "s1",
    "s2",
  ]);
});

test("Teilwörter und Titel ohne Stufe treffen nichts; Sonderzeichen im Namen gelten wörtlich", () => {
  expect(stufenFuerTitel("Biberburg bauen", STUFEN)).toEqual([]);
  expect(stufenFuerTitel("Waldtag", STUFEN)).toEqual([]);
  expect(stufenFuerTitel("", STUFEN)).toEqual([]);
  expect(stufenFuerTitel("Pfadi (Mädchen) Hajk", STUFEN)).toEqual(["s3"]);
  expect(stufenFuerTitel("Pfadi Xxxx Mädchen", STUFEN)).toEqual([]);
});

test("ohne Stufen in der Abteilung trifft auch «Stufen» nichts", () => {
  expect(stufenFuerTitel("Stufen", [])).toEqual([]);
});
