import { schlussZeitText, tagInZuerich, zeitText } from "../src/programme/zeit";

const mitZeit = (beginn: string, ende: string) => ({
  ganztaegig: false,
  beginn,
  ende,
  tagVon: null,
  tagBis: null,
});
const ganztaegig = (tagVon: string, tagBis = tagVon) => ({
  ganztaegig: true,
  beginn: null,
  ende: null,
  tagVon,
  tagBis,
});

// Erwartete Werte in Europe/Zurich; die CI läuft unter TZ=UTC, die Zeiten müssen trotzdem stimmen
test.each([
  [
    "Winterzeit",
    mitZeit("2026-03-28T13:00:00Z", "2026-03-28T16:00:00Z"),
    "Samstag, 28. März 2026, 14:00 bis 17:00 Uhr",
  ],
  [
    "Sommerzeit",
    mitZeit("2026-03-29T13:00:00Z", "2026-03-29T14:00:00Z"),
    "Sonntag, 29. März 2026, 15:00 bis 16:00 Uhr",
  ],
  [
    "nach der Zeitumstellung im Herbst",
    mitZeit("2026-10-25T12:00:00Z", "2026-10-25T14:00:00Z"),
    "Sonntag, 25. Oktober 2026, 13:00 bis 15:00 Uhr",
  ],
  [
    "kurz nach Mitternacht Schweizer Zeit",
    mitZeit("2026-10-31T23:30:00Z", "2026-11-01T01:00:00Z"),
    "Sonntag, 1. November 2026, 00:30 bis 02:00 Uhr",
  ],
  [
    "über Nacht nennt beide Tage",
    mitZeit("2026-10-31T13:00:00Z", "2026-11-01T10:00:00Z"),
    "Samstag, 31. Oktober 2026, 14:00 Uhr bis Sonntag, 1. November 2026, 11:00 Uhr",
  ],
  [
    "ganztägig als Datum",
    ganztaegig("2026-10-31"),
    "Samstag, 31. Oktober 2026",
  ],
  [
    "ein Lager nennt beide Tage",
    ganztaegig("2026-10-10", "2026-10-17"),
    "Samstag, 10. Oktober 2026 bis Samstag, 17. Oktober 2026",
  ],
  [
    "ein Lager über das Monatsende",
    ganztaegig("2026-10-30", "2026-11-02"),
    "Freitag, 30. Oktober 2026 bis Montag, 2. November 2026",
  ],
])("%s", (_name, programm, erwartet) => {
  expect(zeitText(programm)).toBe(erwartet);
});

test("schlussZeit ist eine Wanduhrzeit: HH:MM ohne Umrechnung", () => {
  expect(schlussZeitText("17:30:00")).toBe("17:30");
});

test("tagInZuerich nennt den Schweizer Kalendertag, egal wo das Gerät steht", () => {
  expect(tagInZuerich(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  expect(tagInZuerich(new Date("2026-03-29T13:00:00Z"))).toBe("2026-03-29");
});
