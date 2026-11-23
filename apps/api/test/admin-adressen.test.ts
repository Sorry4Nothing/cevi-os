import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

// Die Module der Verwaltung hängen beim Laden Ereignisse an window und document: eine leere Hülle genügt, gezeichnet wird nichts
const leer = {
  addEventListener() {},
  location: { hash: "" },
  history: {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
vi.stubGlobal("window", leer);
vi.stubGlobal("document", { ...leer, querySelector: () => null });
// Browser-Module ohne Typen: der Pfad steht in einer Variablen, damit TypeScript sie nicht auflöst
const laden = (datei: string) =>
  import(/* @vite-ignore */ `../public/admin/${datei}`);
const { kennungGueltig } = await laden("api.js");
const { adresseGueltig } = await laden("rechte-modell.js");
const { ansichtAusPfad, gueltigerTag } = await laden("termine-monat.js");

// Ungültige Adressen (#667): Ein Teil der Adresse, der als Kennung in einen Pfad der API geht, ist eine UUID, sonst zeigt die Verwaltung «Diese Seite gibt es nicht» und fragt den Server nichts (vorher: 400 vom Server)
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const ID = "0190a3f2-7c11-7e0e-9a3b-1f2d3c4b5a69";
const ID2 = "0190a3f2-7c11-7e0e-9a3b-1f2d3c4b5a70";

describe("Kennungen in Adressen", () => {
  test("nur eine echte UUID gilt", () => {
    expect(kennungGueltig(ID)).toBe(true);
    expect(kennungGueltig(ID.toUpperCase())).toBe(true);
    for (const falsch of [
      "",
      "x",
      "protokoll",
      "../x",
      `${ID}/x`,
      `${ID}?a`,
      "00000000-0000-0000-0000-00000000000z",
    ]) {
      expect(kennungGueltig(falsch)).toBe(false);
    }
  });

  test("Datum: es muss den Tag geben (2026-13-45 wirft nicht, sondern gilt nicht)", () => {
    expect(gueltigerTag("2026-11-23")).toBe(true);
    expect(gueltigerTag("2026-13-45")).toBe(false);
    expect(gueltigerTag("2026-02-30")).toBe(false);
    expect(gueltigerTag("abc")).toBe(false);
    // Eine ungültige Adresse fällt auf den heutigen Monat zurück, ohne Fehler
    expect(ansichtAusPfad(["2026-13-45"], "2026-11-23")).toEqual({
      art: "monat",
      monat: "2026-11",
      tag: null,
    });
  });
});

describe("«Rollen und Rechte»: Adresse gültig?", () => {
  test("bekannte Adressen", () => {
    expect(adresseGueltig("gruppen", [])).toBe(true);
    expect(adresseGueltig("gruppen", [ID])).toBe(true);
    expect(adresseGueltig("gruppen", [ID, "rolle", ID2])).toBe(true);
    expect(adresseGueltig("rollen", [])).toBe(true);
    expect(adresseGueltig("rollen", ["abteilungsleitung"])).toBe(true);
    expect(adresseGueltig("uebersicht", [])).toBe(true);
    expect(adresseGueltig("uebersicht", ["person", ID])).toBe(true);
    expect(adresseGueltig("uebersicht", ["recht", "termine.verwalten"])).toBe(
      true,
    );
    expect(adresseGueltig("uebersicht", ["verlauf"])).toBe(true);
  });

  test("unbekannter Reiter und Kennungen ohne UUID gelten nicht", () => {
    // #personen/rechte/system/protokoll fiel auf «Gruppen» zurück und fragte nach der «Gruppe» protokoll
    expect(adresseGueltig("system", ["protokoll"])).toBe(false);
    expect(adresseGueltig("system", [])).toBe(false);
    expect(adresseGueltig("gruppen", ["protokoll"])).toBe(false);
    expect(adresseGueltig("gruppen", [ID, "rolle", "x"])).toBe(false);
    expect(adresseGueltig("gruppen", [ID, "rolle"])).toBe(false);
    expect(adresseGueltig("gruppen", [ID, "was", ID2])).toBe(false);
    expect(adresseGueltig("rollen", ["a", "b"])).toBe(false);
    expect(adresseGueltig("uebersicht", ["foo"])).toBe(false);
    expect(adresseGueltig("uebersicht", ["person", "a", "b"])).toBe(false);
  });
});

describe("Module fragen bei einer ungültigen Adresse den Server nichts", () => {
  const fake = (pfad: string[]) => ({
    pfad,
    nichtGefunden: vi.fn(),
    lade: vi.fn(),
    erstelleLader: vi.fn(),
    kopfAktion: vi.fn(),
    zugang: { termine: {} },
  });

  test("Gruppe und Anlass mit einer Kennung, die keine UUID ist", async () => {
    const tags = await laden("tags.js");
    const anlaesse = await laden("termine-anlaesse.js");
    for (const zeige of [tags.zeige, anlaesse.zeige]) {
      const ctx = fake(["nicht-da"]);
      zeige({}, ctx);
      expect(ctx.nichtGefunden).toHaveBeenCalledOnce();
      expect(ctx.lade).not.toHaveBeenCalled();
    }
    const ctx = fake([ID, "zu", "viel"]);
    tags.zeige({}, ctx);
    expect(ctx.nichtGefunden).toHaveBeenCalledOnce();
  });

  test("Rollen und Rechte mit unbekanntem Reiter", async () => {
    const rechte = await laden("rechte.js");
    for (const pfad of [
      ["system", "protokoll"],
      ["rechte", "system", "protokoll"],
      ["gruppen", "protokoll"],
      ["gruppen", ID, "rolle", "x"],
    ]) {
      const ctx = fake(pfad);
      rechte.zeige({}, ctx);
      expect(ctx.nichtGefunden).toHaveBeenCalledOnce();
      expect(ctx.lade).not.toHaveBeenCalled();
    }
    // Gültig: es wird geladen, nichts als «nicht gefunden» gemeldet
    const gut = fake(["gruppen", ID]);
    rechte.zeige({}, gut);
    expect(gut.nichtGefunden).not.toHaveBeenCalled();
    expect(gut.lade).toHaveBeenCalledOnce();
  });

  test("der Router stellt ctx.nichtGefunden bereit und zeigt die Seite des toten Links", () => {
    const admin = lies("admin.js");
    expect(admin).toMatch(
      /nichtGefunden: \(\) => \{\s+if \(meine === navigation\) zeigeNichtGefunden\(\);/,
    );
    expect(admin).toContain('titel: "Diese Seite gibt es nicht."');
  });
});
