import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as nav from "../public/admin/navigation.js";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

type Unter = { schluessel: string; zugang?: string };
type Bereich = { schluessel: string; start?: string; unter: Unter[] };
const sichtbar = (person: object) =>
  (nav.sichtbareBereiche(person) as Bereich[]).map((b) => [
    b.schluessel,
    b.unter.map((u) => u.schluessel),
  ]);

// Unterseite «Belegung» im Bereich «Räume» (#628): Alle Leitenden sehen, wie die Räume belegt sind
describe("Panel der Abteilungsleitung: Belegungsplan", () => {
  const modul = lies("termine-belegung.js");
  const css = lies("termine-belegung.css");

  test("Modul, Rechenmodul und Stilvorlage sind eingebunden; die Seite ist die Startseite des Bereichs", () => {
    expect(lies("index.html")).toContain('href="/admin/termine-belegung.css"');
    const raeume = (nav.BEREICHE as Bereich[]).find(
      (b) => b.schluessel === "raeume",
    )!;
    expect(raeume.start).toBe("belegung");
    expect(raeume.unter.map((u) => u.schluessel)).toEqual([
      "belegung",
      "raeume",
      "anfragen",
    ]);
    expect(raeume.unter[0]!.zugang).toBe("belegung");
    expect(modul).toContain('from "./belegung-layout.js"');
  });

  test("Leitende sehen nur die Belegung; Räume und Anfragen bleiben bei der Abteilungsleitung", () => {
    const leitung = {
      istAdmin: false,
      zugang: { bereiche: [], belegung: true },
    };
    expect(sichtbar(leitung)).toEqual([["raeume", ["belegung"]]]);
    // Mit Zugang zur Website kommen deren Bereiche dazu, die Räume bleiben bei der Belegung
    const sl = {
      istAdmin: false,
      zugang: { bereiche: ["website"], rechte: [], belegung: true },
    };
    const raumBereich = sichtbar(sl).find(([b]) => b === "raeume");
    expect(raumBereich).toEqual(["raeume", ["belegung"]]);
    const admin = sichtbar({ istAdmin: true, zugang: null });
    expect(admin.find(([b]) => b === "raeume")).toEqual([
      "raeume",
      ["belegung", "raeume", "anfragen"],
    ]);
  });

  test("ohne das Signal «belegung» fehlt der Bereich ganz; die Übersicht gehört nur dem Zugang zur Website", () => {
    expect(
      sichtbar({
        istAdmin: false,
        zugang: { bereiche: ["website"], rechte: [], belegung: false },
      }).some(([b]) => b === "raeume"),
    ).toBe(false);
    expect(
      sichtbar({
        istAdmin: false,
        zugang: { bereiche: [], belegung: true },
      }).some(([b]) => b === "uebersicht"),
    ).toBe(false);
    expect(
      sichtbar({
        istAdmin: false,
        zugang: { bereiche: ["website"], rechte: [] },
      }).some(([b]) => b === "uebersicht"),
    ).toBe(true);
  });

  test("die Verwaltung lässt Leitende ohne Zugang zur Website ein, die Tür bleibt am Signal des Servers", () => {
    const admin = lies("admin.js");
    expect(admin).toContain("zugang.belegung !== true");
  });

  test("eine Abfrage je Woche, nur lesen, kein Polling, nur Tokens", () => {
    expect(modul).toContain("/api/v1/raeume/belegung");
    expect(
      [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]),
    ).toEqual(["GET"]);
    // setTimeout nur für das Mattwerden der alten Ansicht nach 150 ms, kein Abfragen im Takt
    expect(modul).not.toMatch(/setInterval/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );
    // Das Seitenschema der CSP verbietet style-Attribute: Lagen setzt das Skript über das Objektmodell
    expect(modul).not.toMatch(/setAttribute\(\s*["']style/);
    expect(modul).not.toMatch(/\bstyle:\s*[`"']/);
  });

  test("Zustand nie nur über Farbe, Bewegung nur auf Wunsch, erzwungene Farben", () => {
    // Bestätigt ist gefüllt, angefragt gestrichelt und schraffiert; beide tragen Symbol und Wort
    expect(css).toContain("dashed");
    expect(css).toContain("repeating-linear-gradient");
    expect(modul).toContain('symbol: "haken"');
    expect(modul).toContain('symbol: "uhr"');
    expect(modul).toContain('text: "Angefragt"');
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("forced-colors: active");
  });

  test("Wechsel ohne Grössensprung, mit Bewegung nur auf Wunsch", () => {
    expect(modul).toContain("prefers-reduced-motion: reduce");
    // die alte Seite bleibt stehen, bis die neuen Daten da sind, und die Höhe gleitet
    expect(modul).toContain("bl-seite--alt");
    expect(modul).toContain("hoeheAlt");
    expect(modul).toContain("wechselRichtung");
    expect(css).toContain("bl-flaeche--wechsel");
  });

  test("Tastatur: Pfeile zwischen Blöcken, Escape schliesst die Karte", () => {
    expect(modul).toContain("naechsterBlock");
    expect(modul).toContain("ArrowLeft");
    expect(modul).toContain('e.key === "Escape"');
    expect(modul).toContain('"aria-label": blockBeschriftung');
  });
});
