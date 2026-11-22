import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as nav from "../public/admin/navigation.js";

type Unter = { schluessel: string; name: string; modul?: string };
type Bereich = { schluessel: string; name: string; unter: Unter[] };
const BEREICHE = nav.BEREICHE as Bereich[];
const admin = { istAdmin: true, zugang: null };
const redaktion = {
  istAdmin: false,
  zugang: { bereiche: ["website", "plattform"] },
};
const alle = nav.sichtbareBereiche(admin) as Bereich[];

describe("Verwaltung: navigation.js", () => {
  test("die Bereiche stehen in der Reihenfolge des Designs", () => {
    expect(BEREICHE.map((b) => b.name)).toEqual([
      "Übersicht",
      "Personen",
      "Website",
      "Termine",
      "Räume",
      "Anlässe",
      "Lager",
      "Mitteilungen",
      "System",
    ]);
  });

  test("Schlüssel sind eindeutig und jedes Modul ist eine vorhandene Datei", () => {
    expect(new Set(BEREICHE.map((b) => b.schluessel)).size).toBe(
      BEREICHE.length,
    );
    for (const b of BEREICHE) {
      expect(new Set(b.unter.map((u) => u.schluessel)).size).toBe(
        b.unter.length,
      );
      for (const u of b.unter) {
        if (!u.modul) continue;
        expect(
          existsSync(new URL(`../public/admin/${u.modul}`, import.meta.url)),
          u.modul,
        ).toBe(true);
      }
    }
  });

  test("loese: Bereich, Unterseite und Rest der Adresse", () => {
    expect(nav.loese("", alle).unter.schluessel).toBe("uebersicht");
    expect(nav.loese("#termine", alle).unter.schluessel).toBe("vorschlaege");
    const r = nav.loese("#termine/vorschlaege/abc", alle);
    expect(r.unter.schluessel).toBe("vorschlaege");
    expect(r.pfad).toEqual(["abc"]);
    // Bei einer einzigen Unterseite gehört alles nach dem Bereich dem Modul
    expect(nav.loese("#website/seiten/12", alle).pfad).toEqual([
      "seiten",
      "12",
    ]);
    expect(nav.loese("#gibtsnicht", alle)).toBeNull();
    expect(nav.loese("#termine/gibtsnicht", alle)).toBeNull();
  });

  test("alte Adressen führen zur neuen Heimat", () => {
    expect(nav.neueAdresse("#tags")).toBe("#personen/gruppen");
    expect(nav.neueAdresse("#termine/anlaesse/42")).toBe(
      "#anlaesse/anlaesse/42",
    );
    expect(nav.neueAdresse("#termine/raeume")).toBe("#raeume/raeume");
    expect(nav.neueAdresse("#personen/personen")).toBe("#personen/personen");
    for (const [, neu] of nav.ALIASE as [string, string][]) {
      expect(nav.loese(`#${neu}`, alle), neu).not.toBeNull();
    }
  });

  test("Redaktion sieht nur Übersicht, Website und die Plattform", () => {
    const sicht = nav.sichtbareBereiche(redaktion) as Bereich[];
    expect(sicht.map((b) => b.schluessel)).toEqual([
      "uebersicht",
      "website",
      "system",
    ]);
    expect(sicht.at(-1)!.unter.map((u) => u.schluessel)).toEqual(["plattform"]);
    const nurWebsite = nav.sichtbareBereiche({
      istAdmin: false,
      zugang: { bereiche: ["website"] },
    }) as Bereich[];
    expect(nurWebsite.map((b) => b.schluessel)).toEqual([
      "uebersicht",
      "website",
    ]);
  });
});
