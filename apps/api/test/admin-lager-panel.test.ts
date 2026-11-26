import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const DATEIEN = [
  "lager.js",
  "lager-detail.js",
  "lager-rahmen.js",
  "lager-module.js",
  "lager-gemeinsam.js",
  "lager-anlegen.js",
  "lager-mitglieder.js",
  "lager-personenwahl.js",
  "lager-rechte.js",
  "lager-ausdrucke.js",
  "lager-vorlagen.js",
];
const alle = DATEIEN.map(lies).join("\n");
const methoden = (quelle: string) =>
  [...quelle.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]);

// Bereich «Lager» der Verwaltung (#527): Er ruft nur Routen auf, die die API kennt
describe("Panel der Abteilungsleitung: Lager", () => {
  test("Module und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/lager.css"');
    expect(lies("index.html")).toContain('href="/admin/lager-rahmen.css"');
    const navigation = lies("navigation.js");
    expect(navigation).toContain('"./lager.js"');
    expect(navigation).toContain('"./lager-vorlagen.js"');
  });

  test("Lager, Mitglieder und Rechte nur über die Verwaltungsrouten", () => {
    expect(alle).toContain('"/api/v1/admin/lager"');
    expect(alle).toContain("/mitglieder");
    expect(alle).toContain("/rechte");
    expect(alle).toContain("/rechte/zuruecksetzen");
    expect(alle).toContain('"/api/v1/admin/personen"');
    expect(alle).toContain('"/api/v1/admin/vorlagen"');
  });

  test("Aushänge nur als PDF über die Aushang-Route, Vorlagen über die Anwenden-Route", () => {
    expect(lies("lager-ausdrucke.js")).toContain("/aushaenge/");
    expect(alle).toContain("/vorlagen/");
    expect(alle).toContain("/anwenden");
  });

  test("Entfallenes (Sicherungen, Übernahme, Übungslager, Word, Excel) kommt nicht vor", () => {
    expect(alle).not.toMatch(
      /Sicherung|Übernahme|Übungslager|\.docx|\.xlsx|Word|Excel/,
    );
  });

  test("Löschen nur am Ort mit der Eingabe des Namens und dem Titel im Body", () => {
    const lager = lies("lager-detail.js");
    expect(lager).toMatch(
      /anfrage\(\s*"DELETE",\s*`\$\{BASIS\}\/\$\{lager\.id\}`,\s*\{/,
    );
    expect(lager).toContain("bestaetigungAmOrt");
    expect(lager).toContain("erwartet: lager.titel");
    expect(methoden(alle)).toContain("DELETE");
  });

  // Seite des Lagers (#838): Anlegen nur mit dem Recht und nur ohne Seite, sonst der Link in den Editor; der Editor führt nur zurück, wenn die API den Bezug nennt
  test("Seite des Lagers: «Seite anlegen» oder «Zur Seite», im Editor «Zum Lager» und «Zum Anlass»", () => {
    const lager = lies("lager-detail.js");
    expect(lager).toMatch(
      /anfrage\("POST", `\$\{BASIS\}\/\$\{lager\.id\}\/seite`\)/,
    );
    expect(lager).toContain('darf("seiten.anlegen_loeschen")');
    expect(lager).toContain("`#website/seiten/${lager.seiteId}`");
    expect(lager).toContain('setAttribute("aria-busy", "true")');
    const editor = lies("website-editor.js");
    expect(editor).toMatch(/seite\.anlassId &&\s+el\(\s+"a"/);
    expect(editor).toContain("`#anlaesse/${seite.anlassId}`");
    expect(editor).toMatch(/seite\.lagerId &&\s+el\(\s+"a"/);
    expect(editor).toContain("`#lager/lager/${seite.lagerId}/angaben`");
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    expect(alle).not.toMatch(/setInterval|\.style\b|setAttribute\("style"/);
    // Farben nur über Variablen: kein Hex-Wert in einer Deklaration
    expect(lies("lager.css")).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });
});
