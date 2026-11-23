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
    // Gruppen für den Filter, eine Seite des Monats, die Liste und «Weitere laden»; nie schreiben
    expect(methoden(modul)).toEqual(["GET", "GET", "GET", "GET"]);
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

  test("Anlässe, Zusatzfelder und Anmeldungen: nur die Routen der Anlässe", () => {
    const anlaesse = lies("termine-anlaesse.js");
    const gemeinsam = lies("anlass-gemeinsam.js");
    const anmeldungen = lies("anlass-anmeldungen.js");
    const felder = lies("anlass-felder.js");
    expect(gemeinsam).toContain('"/api/v1/admin/anlaesse"');
    // Liste, weitere Seite, Termine und Gruppen zum Anlegen, Gruppen der Einstellungen (GET); Anlegen (POST); Ändern (zwei Stellen: Anmeldung öffnen und Einstellungen); Löschen. Den Anlass selbst lädt anlass-gemeinsam.js
    expect(methoden(anlaesse)).toEqual([
      "DELETE",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "PATCH",
      "PATCH",
      "POST",
    ]);
    expect(methoden(gemeinsam)).toEqual(["GET"]);
    // Anmeldungen: nur lesen (Seite mit Summen), der Export holt die Datei mit der Sitzung; es gibt keine Excel- oder Word-Dateien
    expect(methoden(anmeldungen)).toEqual(["GET"]);
    expect(anmeldungen).toContain("/anmeldungen.csv?status=");
    expect(anmeldungen).not.toMatch(/xlsx|docx/);
    expect(methoden(felder)).toEqual(["GET", "PUT"]);
    expect(felder).toContain("/felder`");
  });

  test("Anmeldungen gibt es nur über den Anlass: kein eigenes Modul, alte Adressen leiten auf den Anlass", () => {
    const anlaesse = lies("termine-anlaesse.js");
    // Die alte Unterseite ist nur noch eine Weiterleitung und ruft keine Route auf
    const alt = lies("termine-anmeldungen.js");
    expect(alt).toContain("leiteAltAdresseUm");
    expect(alt).not.toContain("anfrage");
    expect(anlaesse).toContain('pfad[0] === "anmeldungen"');
    expect(lies("anlass-gemeinsam.js")).toContain(
      'adresse(rest[0], "anmeldungen")',
    );
    // Die Liste verweist nie auf eine zweite Anlass-Auswahl
    for (const datei of ["termine-anlaesse.js", "termine-monat.js"]) {
      expect(lies(datei), datei).not.toMatch(
        /href:\s*[`"']#anlaesse\/anmeldungen/,
      );
    }
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    for (const datei of [
      "kalenderhilfen.js",
      "termine-kalender.js",
      "termine-monat.js",
      "termine-warnliste.js",
      "termine-kategorien.js",
      "termine-outlook.js",
      "termine-anlaesse.js",
      "anlass-gemeinsam.js",
      "anlass-anmeldungen.js",
      "anlass-felder.js",
    ]) {
      expect(lies(datei), datei).not.toMatch(
        /setInterval|\.style\b|setAttribute\("style"/,
      );
    }
  });

  test("jedes Modul meldet sich in der Navigation an", () => {
    const navigation = lies("navigation.js");
    // Die Anmeldungen sind kein eigener Menüpunkt mehr (#607)
    for (const modul of [
      "termine-kalender",
      "termine-outlook",
      "termine-anlaesse",
    ]) {
      expect(navigation).toContain(`"./${modul}.js"`);
    }
  });
});
