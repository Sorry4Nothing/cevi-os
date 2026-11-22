import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const methoden = (modul: string) =>
  [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]).sort();

// Die übrigen Unterseiten von «Termine» und «Anlässe» (A8, A11, A12, A13, A17 bis A19): Jede ruft nur ihre Routen auf
describe("Admin-Panel: Termine und Anlässe", () => {
  test("Kalender liest nur die Termine der Abteilung", () => {
    const modul = lies("termine-kalender.js");
    expect(modul).toContain('"/api/v1/termine/alle"');
    expect(methoden(modul)).toEqual(["GET", "GET"]);
  });

  test("Ohne Kategorie liest nur die Warnliste", () => {
    const modul = lies("termine-warnliste.js");
    expect(modul).toContain("/api/v1/admin/termine/warnungen");
    expect(methoden(modul)).toEqual(["GET", "GET"]);
  });

  test("Kategorien schreibt nur über die Zuordnungen", () => {
    const modul = lies("termine-kategorien.js");
    expect(modul).toContain('"/api/v1/admin/kategorie-zuordnungen"');
    expect(methoden(modul)).toEqual([
      "DELETE",
      "GET",
      "GET",
      "GET",
      "GET",
      "PUT",
      "PUT",
    ]);
  });

  test("Outlook liest den Stand des Abgleichs und stösst ihn an, schreibt nie nach Outlook", () => {
    const modul = lies("termine-outlook.js");
    expect(modul).toContain('"/api/v1/admin/system/syncs"');
    expect(methoden(modul)).toEqual(["GET", "POST"]);
  });

  test("Anlässe und Anmeldungen: nur die Routen der Anlässe", () => {
    const anlaesse = lies("termine-anlaesse.js");
    const anmeldungen = lies("termine-anmeldungen.js");
    expect(anlaesse).toContain('"/api/v1/admin/anlaesse"');
    expect(anmeldungen).toContain('"/api/v1/admin/anlaesse"');
    expect(methoden(anmeldungen)).toEqual(["GET", "GET", "GET", "GET"]);
    // Der Export holt die Datei mit der Sitzung; es gibt keine Excel- oder Word-Dateien
    expect(anmeldungen).toContain("/anmeldungen.csv?status=");
    expect(anmeldungen).not.toMatch(/xlsx|docx/);
    expect(anlaesse).toContain("/felder`");
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    for (const datei of [
      "kalenderhilfen.js",
      "termine-kalender.js",
      "termine-warnliste.js",
      "termine-kategorien.js",
      "termine-outlook.js",
      "termine-anlaesse.js",
      "termine-anmeldungen.js",
    ]) {
      expect(lies(datei), datei).not.toMatch(
        /setInterval|\.style\b|setAttribute\("style"/,
      );
    }
  });

  test("jedes Modul meldet sich in der Navigation an", () => {
    const navigation = lies("navigation.js");
    for (const modul of [
      "termine-kalender",
      "termine-outlook",
      "termine-anmeldungen",
    ]) {
      expect(navigation).toContain(`"./${modul}.js"`);
    }
  });
});
