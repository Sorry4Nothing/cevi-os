import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { gleicheAb } from "../../src/kalender/abgleich.js";
import { tagsFuerKategorien } from "../../src/kalender/tags-zuordnen.js";

// Erfundene Datei, nie der echte Feed
const ics = await readFile(
  new URL("./aufzeichnungen/kategorien.ics", import.meta.url),
  "utf8",
);
const { programme } = gleicheAb(ics, new Date("2027-09-01T00:00:00Z"));
const kategorien = (titel: string) =>
  programme.filter((p) => p.titel === titel).map((p) => p.kategorien);

test("eine Kategorie", () => {
  expect(kategorien("Eine Kategorie")).toEqual([["Wolfsstufe"]]);
});

test("mehrere Zeilen und Werte: getrimmt, ohne Doppelte (auch in anderer Schreibweise), leere fallen weg", () => {
  expect(kategorien("Mehrere Kategorien")).toEqual([
    ["Wolfsstufe", "Pfadistufe"],
  ]);
});

test("ohne Kategorie ist die Liste leer", () => {
  expect(kategorien("Ohne Kategorie")).toEqual([[]]);
});

test("Gross-/Kleinschreibung und Leerraum bleiben roh, nur getrimmt", () => {
  expect(kategorien("Gross und klein")).toEqual([["WOLFSSTUFE"]]);
});

test("ein maskiertes Komma gehört zum Namen", () => {
  expect(kategorien("Maskiertes Komma")).toEqual([
    ["Hockey, Eis", "Pfadistufe"],
  ]);
});

test("Serie: die Ausnahme mit eigener Kategorie ersetzt die der Serie, die übrigen Instanzen behalten sie", () => {
  const serie = programme
    .filter((p) => p.titel === "Serie mit Ausnahme")
    .sort((a, b) => a.beginn!.getTime() - b.beginn!.getTime());
  expect(serie.map((p) => p.kategorien)).toEqual([
    ["Wolfsstufe"],
    ["Pfadistufe"],
    ["Wolfsstufe"],
  ]);
});

test("Ort wird getrimmt, ohne LOCATION ist er null", () => {
  expect(programme.find((p) => p.titel === "Ohne Kategorie")?.ort).toBe(
    "Pfadiheim",
  );
  expect(programme.find((p) => p.titel === "Eine Kategorie")?.ort).toBeNull();
});

test("Obergrenzen: höchstens 20 Kategorien, Namen über 100 Zeichen fallen weg", () => {
  const viele = Array.from({ length: 30 }, (_, i) => `K${i}`).join(",");
  const lang = "x".repeat(101);
  const { programme: p } = gleicheAb(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:grenze0000000001",
      "DTSTART:20270904T120000Z",
      "DTEND:20270904T140000Z",
      "SUMMARY:Grenzen",
      `CATEGORIES:${viele},${lang}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
    new Date("2027-09-01T00:00:00Z"),
  );
  expect(p[0].kategorien).toHaveLength(20);
  expect(p[0].kategorien[0]).toBe("K0");
  expect(p[0].kategorien).not.toContain(lang);
});

test("Zuordnung: Abweichung vor Namensgleichheit, Name ohne Gross-/Kleinschreibung, Unbekanntes fällt weg", () => {
  const abweichungen = new Map([["hockey, eis", "t-pfadi"]]);
  const tags = new Map([
    ["wolfsstufe", "t-wolf"],
    ["pfadistufe", "t-pfadi"],
  ]);
  expect(
    tagsFuerKategorien(
      ["WOLFSSTUFE", " Hockey, Eis ", "Unbekannt", "Pfadistufe"],
      abweichungen,
      tags,
    ).sort(),
  ).toEqual(["t-pfadi", "t-wolf"]);
  expect(tagsFuerKategorien([], abweichungen, tags)).toEqual([]);
});
