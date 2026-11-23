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
      "Lädeli",
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
    // Website hat mehrere Unterseiten: «seiten» ist die Unterseite, «12» der Rest
    const w = nav.loese("#website/seiten/12", alle);
    expect(w.unter.schluessel).toBe("seiten");
    expect(w.pfad).toEqual(["12"]);
    expect(nav.loese("#gibtsnicht", alle)).toBeNull();
    expect(nav.loese("#termine/gibtsnicht", alle)).toBeNull();
  });

  test("alte Adressen führen zur neuen Heimat", () => {
    expect(nav.neueAdresse("#tags")).toBe("#personen/gruppen");
    expect(nav.neueAdresse("#termine/anlaesse/42")).toBe("#anlaesse/42");
    expect(nav.neueAdresse("#anlaesse/anlaesse/42/felder")).toBe(
      "#anlaesse/42/felder",
    );
    expect(nav.neueAdresse("#anlaesse/anlaesse")).toBe("#anlaesse");
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

  const unterVon = (person: object, bereich: string) =>
    (nav.sichtbareBereiche(person) as Bereich[])
      .find((b) => b.schluessel === bereich)
      ?.unter.map((u) => u.schluessel);

  test("«Komponenten» und «Anmeldungen» stehen für niemanden im Menü (#607)", () => {
    const personen = [
      admin,
      { ...admin, entwickler: true },
      redaktion,
      { ...redaktion, entwickler: true },
    ];
    for (const person of personen) {
      expect(unterVon(person, "system")).not.toContain("komponenten");
      expect(unterVon(person, "anlaesse") ?? []).not.toContain("anmeldungen");
    }
  });

  test("Die alte Adresse der Anmeldungen führt zum Anlass, ohne Kennung zur Liste (#607)", () => {
    expect(nav.neueAdresse("#anlaesse/anmeldungen")).toBe("#anlaesse");
    expect(nav.neueAdresse("#anlaesse/anmeldungen/abc")).toBe("#anlaesse/abc");
  });

  test("Einstellungen der Website nur mit dem Recht «Seiten veröffentlichen»", () => {
    const stufenleitung = {
      istAdmin: false,
      zugang: { bereiche: ["website"], rechte: [] },
    };
    // Die Route der Einstellungen liefe für die Stufenleitung in ein 403
    expect(unterVon(stufenleitung, "website")).toEqual([
      "seiten",
      "medien",
      "stufenfakten",
    ]);
    const webmaster = {
      istAdmin: false,
      zugang: {
        bereiche: ["website"],
        rechte: ["seiten.bearbeiten", "seiten.veroeffentlichen"],
      },
    };
    expect(unterVon(webmaster, "website")).toContain("einstellungen");
    expect(unterVon(admin, "website")).toContain("einstellungen");
  });

  test("die Seite für Wartung und Sperre heisst nach ihrem Inhalt", () => {
    const system = BEREICHE.find((b) => b.schluessel === "system")!;
    expect(system.unter.find((u) => u.schluessel === "plattform")!.name).toBe(
      "Wartung und Sperre",
    );
  });

  test("rolleVon nennt die echte Rolle statt «Redaktion»", () => {
    const profil = {
      rollen: [{ stufeId: "s1", typ: "stufenleitung" }],
      stufen: [{ id: "s1", name: "Pilami" }],
    };
    expect(nav.rolleVon({ istAdmin: true })).toBe("Abteilungsleitung");
    expect(nav.rolleVon({ istAdmin: true, entwickler: true })).toBe(
      "Entwickler · Abteilungsleitung",
    );
    expect(
      nav.rolleVon({ istAdmin: false, zugang: { rechte: [] }, profil }),
    ).toBe("Stufenleitung Pilami");
    expect(
      nav.rolleVon({
        istAdmin: false,
        zugang: { rechte: ["seiten.bearbeiten"] },
        profil: null,
      }),
    ).toBe("Website-Redaktion");
    expect(
      nav.rolleVon({
        istAdmin: false,
        zugang: { rechte: ["wartungsmodus.website"] },
        profil: { rollen: [], stufen: [] },
      }),
    ).toBe("Wartung der Website");
    expect(nav.rolleVon({ istAdmin: false, zugang: { rechte: [] } })).toBe(
      "Konto mit Zugang",
    );
  });
});

describe("Zugang nach Rechten des Katalogs (#648)", () => {
  const seite = (zugang: string) => ({ zugang });
  const person = (katalogRechte: string[], rechte: string[] = []) => ({
    istAdmin: false,
    zugang: { bereiche: [], rechte, katalogRechte },
  });

  test("«recht:» prüft Plattformrechte und Katalogrechte, «|» lässt eines genügen", () => {
    const laden = seite("recht:laden.ansehen|laden.artikel_pflegen");
    expect(nav.darfSehen(laden, person(["laden.artikel_pflegen"]))).toBe(true);
    expect(nav.darfSehen(laden, person(["laden.einstellungen"]))).toBe(false);
    expect(nav.darfSehen(laden, person([]))).toBe(false);
    const web = seite("recht:seiten.veroeffentlichen");
    expect(nav.darfSehen(web, person([], ["seiten.veroeffentlichen"]))).toBe(
      true,
    );
    expect(nav.darfSehen(web, person(["seiten.veroeffentlichen"]))).toBe(true);
  });

  test("Lädeli, Lager und System zeigen nur, was das Recht öffnet", () => {
    const sicht = (rechte: string[]) =>
      nav
        .sichtbareBereiche(person(rechte))
        .map((b) => `${b.schluessel}:${b.unter.map((u) => u.schluessel)}`);
    expect(sicht(["laden.einstellungen"])).toEqual(["laedeli:einstellungen"]);
    expect(sicht(["system.lesen", "zeitregeln.verwalten"])).toEqual([
      "system:system,zeitregeln",
    ]);
    expect(sicht(["lager.vorlagen_pflegen"])).toEqual(["lager:vorlagen"]);
    expect(sicht([])).toEqual([]);
  });
});
