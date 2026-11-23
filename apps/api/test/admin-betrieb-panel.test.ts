import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Anmeldung, System, Plattform, Erinnerungen, Mitteilungen und das Hinweisband (#593): reine Funktionen ohne Browser und Quelltext-Prüfungen.
// dom.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let zeitregeln: Modul;
let band: Modul;
let system: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  const lade = (name: string) =>
    import(/* @vite-ignore */ `../public/admin/${name}`) as Promise<Modul>;
  zeitregeln = await lade("zeitregeln.js");
  band = await lade("hinweisband.js");
  system = await lade("system.js");
  vi.unstubAllGlobals();
});

const quelle = (name: string) =>
  readFileSync(new URL(`../public/admin/${name}`, import.meta.url), "utf8");
const ohneKommentar = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(?<=[;{}\s])\/\/ .*$/gm, "");

const tag = (d: Date) => d.toISOString().slice(0, 10);

describe("zeitregeln.js: naechsteTermine", () => {
  // 2026-11-23 ist ein Montag
  const montagMorgen = new Date("2026-11-23T05:00:00Z"); // 06:00 in Zürich

  test("ein späterer Wochentag liegt in dieser Woche, danach jede Woche", () => {
    const t = zeitregeln.naechsteTermine!(3, "08:00", montagMorgen, 3);
    expect(t.map((x: { tag: Date }) => tag(x.tag))).toEqual([
      "2026-11-25",
      "2026-12-02",
      "2026-12-09",
    ]);
    expect(t[0].uhrzeit).toBe("08:00");
  });

  test("heute zählt nur, wenn die Uhrzeit noch nicht vorbei ist", () => {
    const vor = zeitregeln.naechsteTermine!(1, "08:00", montagMorgen, 2);
    expect(tag(vor[0].tag)).toBe("2026-11-23");
    const nach = zeitregeln.naechsteTermine!(1, "05:00", montagMorgen, 2);
    expect(tag(nach[0].tag)).toBe("2026-11-30");
  });

  test("gerechnet wird in Schweizer Zeit, nicht in der des Geräts", () => {
    // 22:30 UTC ist in Zürich schon 23:30 am Montag, 23:45 ist noch nicht vorbei, 23:00 schon
    const spaet = new Date("2026-11-23T22:30:00Z");
    expect(tag(zeitregeln.naechsteTermine!(1, "23:45", spaet, 1)[0].tag)).toBe(
      "2026-11-23",
    );
    expect(tag(zeitregeln.naechsteTermine!(1, "23:00", spaet, 1)[0].tag)).toBe(
      "2026-11-30",
    );
    // 23:30 UTC am Sonntag ist in Zürich schon Montag 00:30
    const naheMitternacht = new Date("2026-11-22T23:30:00Z");
    expect(
      tag(zeitregeln.naechsteTermine!(1, "08:00", naheMitternacht, 1)[0].tag),
    ).toBe("2026-11-23");
  });

  test("ungültige Angaben ergeben keine Termine", () => {
    expect(zeitregeln.naechsteTermine!(0, "08:00")).toEqual([]);
    expect(zeitregeln.naechsteTermine!(8, "08:00")).toEqual([]);
    expect(zeitregeln.naechsteTermine!(3, "")).toEqual([]);
    expect(zeitregeln.naechsteTermine!(3, "8:00")).toEqual([]);
    expect(zeitregeln.naechsteTermine!(3, undefined)).toEqual([]);
  });
});

describe("hinweisband.js: zeilenVon", () => {
  test("Sperren stehen vor der Wartung, der Zustand steht im Wort", () => {
    const zeilen = band.zeilenVon!([
      {
        art: "wartung",
        bereich: "website",
        hinweis: "Update",
        ende: "2026-12-05T17:00:00.000Z",
        ausgeloestAm: "2026-11-23T03:00:00.000Z",
      },
      {
        art: "sperre",
        bereich: "lager",
        hinweis: null,
        websiteOffline: false,
        ausgeloestAm: "2026-11-23T03:10:00.000Z",
      },
    ]);
    expect(zeilen.map((z: { art: string }) => z.art)).toEqual([
      "sperre",
      "wartung",
    ]);
    expect(zeilen[0].titel).toBe("Informationssperre: Lager");
    expect(zeilen[1].titel).toBe("Wartung: Website ist nur lesbar");
    expect(zeilen[1].hinweis).toBe("Update");
    expect(zeilen[1].teile.join(" ")).toContain("Geplantes Ende");
  });

  test("ohne Schalter keine Zeilen; ein unbekannter Bereich zeigt seinen Schlüssel", () => {
    expect(band.zeilenVon!([])).toEqual([]);
    expect(
      band.zeilenVon!([
        { art: "sperre", bereich: "neu", ausgeloestAm: null },
      ])[0].titel,
    ).toBe("Informationssperre: neu");
  });

  test("die Bereiche sind dieselben wie auf der Seite Plattform", () => {
    const schluessel = (band.BEREICHE as unknown as string[][]).map(
      (b) => b[0],
    );
    expect(schluessel).toEqual([
      "alles",
      "website",
      "lager",
      "chat",
      "programme",
      "verwaltung",
    ]);
    expect(quelle("plattform.js")).toContain(
      'import { BEREICHE, GEAENDERT } from "./hinweisband.js"',
    );
  });
});

describe("system.js: Kennzahlen der Anfragen (#606)", () => {
  const MIN = 60_000;
  const jetzt = Date.parse("2026-11-23T12:00:00Z");
  // 24 Stunden, ab = Anfang des Fensters; je Stunde 10 Anfragen, davon 1 mit 4xx; die letzte Stunde 40 mit 4 mal 5xx
  const stunden = Array.from({ length: 24 }, (_, i) => ({
    ab: new Date(jetzt - (24 - i) * 60 * MIN).toISOString(),
    anzahl: i === 23 ? 40 : 10,
    fehler4xx: 1,
    fehler5xx: i === 23 ? 4 : 0,
  }));
  const minuten = Array.from({ length: 60 }, (_, i) => ({
    ab: new Date(jetzt - (60 - i) * MIN).toISOString(),
    anzahl: i === 30 ? 9 : 1,
    fehler4xx: 0,
    fehler5xx: 0,
  }));
  const lang = (seit: number) => ({
    seit: new Date(seit).toISOString(),
    stunden,
    minuten,
  });

  test("24 Stunden: Summe, Spitze und Vergleich der letzten Stunde mit dem Schnitt davor", () => {
    const w = system.auswerten!(lang(jetzt - 30 * 60 * MIN), "stunden");
    expect(w.gesamt).toEqual({ anzahl: 270, fehler4xx: 24, fehler5xx: 4 });
    expect(w.spitze.anzahl).toBe(40);
    expect(w.letzte.anzahl).toBe(40);
    expect(w.basis.anzahl).toBe(230);
    expect(w.stundenImVergleich).toBe(23);
  });

  test("letzte Stunde: verglichen wird mit der Stunde davor", () => {
    const w = system.auswerten!(lang(jetzt - 30 * 60 * MIN), "minuten");
    expect(w.gesamt.anzahl).toBe(68);
    expect(w.spitze.anzahl).toBe(9);
    expect(w.basis.anzahl).toBe(10);
    expect(w.stundenImVergleich).toBe(1);
  });

  test("lief die API erst kurz, gibt es keinen Vergleich und keine Erfindung", () => {
    const w = system.auswerten!(lang(jetzt - 30 * MIN), "stunden");
    expect(w.basis).toBeNull();
    const leer = system.auswerten!(
      {
        seit: new Date(jetzt).toISOString(),
        stunden: stunden.map((s) => ({
          ...s,
          anzahl: 0,
          fehler4xx: 0,
          fehler5xx: 0,
        })),
        minuten,
      },
      "stunden",
    );
    expect(leer.spitze).toBeNull();
  });

  test("Veränderung in Prozent und in Prozentpunkten", () => {
    expect(system.veraenderung!(112, 100)).toBe("+12 %");
    expect(system.veraenderung!(90, 100)).toBe("−10 %");
    expect(system.veraenderung!(5, 5)).toBe("±0 %");
    expect(system.veraenderung!(0, 0)).toBe("±0");
    expect(system.veraenderung!(3, 0)).toBe("neu");
    expect(system.punkteVon!(0.014, 0.01)).toBe("+0.4 Prozentpunkte");
    expect(system.punkteVon!(0.01, 0.01)).toBe("±0 Prozentpunkte");
  });

  test("Zustand je Zeitraum: Schwelle 1 % wie in der Lage", () => {
    const z = system.zustandVon!;
    expect(z({ anzahl: 0, fehler4xx: 0, fehler5xx: 0 })).toBe("leer");
    expect(z({ anzahl: 50, fehler4xx: 3, fehler5xx: 0 })).toBe("ruhig");
    expect(z({ anzahl: 200, fehler4xx: 0, fehler5xx: 2 })).toBe("vereinzelt");
    expect(z({ anzahl: 100, fehler4xx: 0, fehler5xx: 2 })).toBe("erhoeht");
  });
});

describe("Quelltext der Bereiche (#593)", () => {
  test("keine nativen Datum-, Zeit- und Zahlenfelder und kein Polling", () => {
    for (const datei of [
      "plattform.js",
      "zeitregeln.js",
      "system.js",
      "hinweisband.js",
      "mitteilungen.js",
    ]) {
      const text = ohneKommentar(quelle(datei));
      expect(text, datei).not.toMatch(
        /datetime-local|typ: "(time|date|number)"|type: "(time|date|number)"/,
      );
      expect(text, datei).not.toMatch(/setInterval|\.style\b/);
    }
  });

  test("die Seite System lädt nur auf Wunsch neu", () => {
    const system = quelle("system.js");
    expect(system).toContain("export function aufWunsch");
    expect(system).not.toContain("laufend(");
  });

  test("system.css: Tokens statt Hex-Farben, Bewegung nur bei erlaubter Bewegung", () => {
    const css = ohneKommentar(quelle("system.css"));
    expect(css).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
    const animationen = css.match(/animation:[^;]+;/g) ?? [];
    expect(animationen.length).toBeGreaterThan(0);
    const bewegt = css.slice(
      css.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    for (const a of animationen) expect(bewegt).toContain(a);
  });

  test("das Hinweisband steht in der Verwaltung zwischen Kopf und Inhalt und nur für die Plattform", () => {
    const admin = quelle("admin.js");
    const aufbau = admin.slice(admin.indexOf("function zeigeVerwaltung()"));
    expect(aufbau.indexOf("hinweisband.wurzel")).toBeGreaterThan(
      aufbau.indexOf("leisten.wurzel"),
    );
    expect(aufbau.indexOf("hinweisband.wurzel")).toBeLessThan(
      aufbau.indexOf('"main"'),
    );
    expect(admin).toContain('zugang?.bereiche.includes("plattform")');
    expect(quelle("index.html")).toContain("/admin/system.css");
  });

  test("Mitteilungen und Plattform fragen weiter in zwei Stufen, Löschen der Erinnerung geht mit Rückgängig", () => {
    expect(quelle("mitteilungen.js")).toMatch(/zweiStufig/);
    expect(quelle("plattform.js")).toMatch(/zweistufig/);
    expect(quelle("zeitregeln.js")).toContain("mitRueckgaengig");
  });

  test("Lager: ohne Lagerleitung ist «Aktivieren» gesperrt und erklärt", () => {
    const lager = quelle("lager.js");
    expect(lager).toContain('rolle("lagerleitung") > 0');
    expect(lager).toContain("aktivieren.haupt.disabled = true");
    expect(lager).toContain('"aria-describedby", "lg-ohne-leitung"');
    expect(lager).toContain("Zum Aktivieren fehlt die Lagerleitung");
  });

  test("Stufenfelder: 403 auf eine fremde Stufe führt zur eigenen Stufe", () => {
    const stufenfakten = quelle("website-stufenfakten.js");
    expect(stufenfakten).toContain("f?.status === 403");
    expect(stufenfakten).toContain("keinRecht");
  });

  test("Tabellenrahmen: die Beschriftung für Screenreader verbreitert die Seite nicht", () => {
    expect(quelle("admin.css")).toMatch(
      /\.tabellenrahmen \{\s*position: relative;/,
    );
  });

  test("Komponenten-Galerie nur für Entwickler", () => {
    expect(quelle("komponenten.js")).toMatch(/nameAenderbar\s*===\s*true/);
  });
});
