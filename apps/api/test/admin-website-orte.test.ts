import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import { sichererKartenLink } from "../public/admin/orte-logik.js";

// Oberfläche der Orte der Samstagsangaben (#646): Einbindung, sichere Links, keine Rückfragen im Browser
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

describe("Orte in der Verwaltung", () => {
  test("Stil ist eingebunden, die Seite führt über die Samstagsangaben", () => {
    expect(lies("index.html")).toContain('href="/admin/website-orte.css"');
    const angaben = lies("website-stufenfakten.js");
    expect(angaben).toContain('ctx.pfad[0] === "orte"');
    expect(angaben).toContain("ortAuswahl(");
  });

  test("der Verweis zur Karte ist ein externer Link in neuem Tab ohne Referrer", () => {
    const orte = lies("website-orte.js");
    expect(orte).toContain('rel: "noopener noreferrer"');
    expect(orte).toContain('target: "_blank"');
    expect(orte).toContain("(Google Maps, öffnet in neuem Tab)");
  });

  test("der Verweis ist ein kleiner Knopf wie «Bearbeiten»: Symbol, Beschriftung, 44 px, kein Textlink (#661)", () => {
    const orte = lies("website-orte.js");
    expect(orte).toContain('class: "knopf knopf--klein ort-karte"');
    expect(orte).toContain('symbol("ort")');
    expect(orte).toContain('symbol("extern")');
    expect(orte).toContain('"Auf Karte ansehen"');
    // Er steht in der Gruppe der Aktionen der Zeile, nicht in der Spalte mit den Chips
    expect(orte).toMatch(
      /class: "aktionen" \},\s+kartenVerweis\(o\.kartenLink\)/,
    );
    const css = lies("website-orte.css");
    expect(css).not.toMatch(/ort-karte::after/);
    expect(css).toMatch(/a\.ort-karte \{[^}]*background: var\(--blau-f\)/);
  });

  test("Löschen geht mit Rückgängig, ein gebrauchter Ort fragt zuerst in zwei Stufen", () => {
    const orte = lies("website-orte.js");
    expect(orte).toContain("mitRueckgaengig");
    expect(orte).toContain("zweiStufig");
  });

  test("kein Popup des Browsers, kein HTML aus Text, kein natives Auswahlfeld mit eigenem Stil", () => {
    for (const datei of [
      "website-orte.js",
      "website-stufenfakten.js",
      "ort-suche.js",
    ]) {
      const q = lies(datei);
      expect(q, datei).not.toMatch(/\b(?:alert|confirm|prompt)\(/);
      expect(q, datei).not.toMatch(/innerHTML|insertAdjacentHTML/);
      expect(q, datei).not.toMatch(/style\s*[:=]/);
    }
    // Das Auswahlfeld ist das der Verwaltung (select wird von auswahl.js aufgewertet)
    expect(lies("website-orte.js")).toContain("ceviAuswahl");
  });
});

describe("Adresssuche der Orte (#695)", () => {
  test("Kombinationsfeld nach WAI-ARIA mit Tastatur, Abbruch alter Anfragen und Zuständen", () => {
    const q = lies("ort-suche.js");
    for (const teil of [
      'role: "combobox"',
      "aria-expanded",
      "aria-activedescendant",
      'role: "listbox"',
      'role: "option"',
      "ArrowDown",
      "Escape",
      "Enter",
      "AbortController",
      "Keine Adresse gefunden.",
      "Die Adresssuche ist gerade nicht erreichbar.",
    ]) {
      expect(q, teil).toContain(teil);
    }
    // Der Browser fragt nur den eigenen Server; kein Skript, kein Bild, keine Adresse von Dritten
    expect(q).toContain("/api/v1/redaktion/orte/suche");
    expect(q).not.toMatch(/https?:\/\//);
    expect(lies("website-orte.js")).not.toMatch(
      /geo\.admin|googleapis|maps\.google/,
    );
  });

  test("das Formular kennt «Adresse bestätigt», «noch nicht bestätigt» und den Knopf «Adresse suchen»; der Link von Hand bleibt", () => {
    const orte = lies("website-orte.js");
    for (const text of [
      "Adresse bestätigt",
      "Standort noch nicht bestätigt",
      "Adresse suchen",
      "Link oder Koordinaten von Hand eintragen",
    ]) {
      expect(orte, text).toContain(text);
    }
  });

  test("Stil: Bewegung nur ohne «Bewegung reduzieren»", () => {
    const css = lies("website-orte.css");
    const teil = css.slice(css.indexOf("Adresssuche (#695)"));
    expect(teil).toMatch(/prefers-reduced-motion: no-preference/);
    expect(teil).not.toMatch(/transition: all/);
  });
});

describe("sichererKartenLink", () => {
  test.each([
    "https://www.google.com/maps/search/?api=1&query=47.2,8.7",
    "https://maps.app.goo.gl/AbC123xyz",
    "https://goo.gl/maps/AbC123xyz",
  ])("lässt %s durch", (link) => {
    expect(sichererKartenLink(link)).toBe(link);
  });

  test.each([
    "javascript:alert(1)",
    "http://www.google.com/maps",
    "https://evil.example/maps",
    "https://www.google.com.evil.example/maps",
    "https://user:pw@www.google.com/maps",
    "//www.google.com/maps",
    "",
    null,
    undefined,
  ])("weist %s ab", (link) => {
    expect(sichererKartenLink(link)).toBeNull();
  });
});
