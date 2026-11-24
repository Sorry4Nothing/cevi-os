import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// «Konto löschen» im Blatt einer Person (#769): Die Quelle sichert die Regeln der Oberfläche; die Route selbst deckt test/konto-loeschen.test.ts und test/entwickler-alle-rechte.test.ts ab
describe("Konto löschen im Blatt der Person (#769)", () => {
  const blatt = lies("personen-blatt.js");
  const karte = blatt.slice(
    blatt.indexOf("function kontoLoeschenKarte"),
    blatt.indexOf("function faktorZuruecksetzen"),
  );

  test("Karte am Ort mit dem Namen zum Eintippen, kein Browserdialog, kein Rückgängig", () => {
    expect(blatt).toContain(
      'import { bestaetigungAmOrt } from "./aktionen.js"',
    );
    expect(karte).toContain("bestaetigungAmOrt");
    expect(karte).toContain("erwartet: person.name");
    expect(karte).toContain('bestaetigenText: "Endgültig löschen"');
    expect(karte).toContain("endgültig löschen?");
    expect(karte).not.toMatch(/mitRueckgaengig|confirm\(|dialog/);
  });

  test("die Frage sagt, was weg ist, was bleibt und wie man es zurücknimmt", () => {
    for (const teil of [
      "Konto",
      "Anmeldung",
      "Chats",
      "Verknüpfungen zu Gruppen und Rollen",
      "Änderungsprotokoll bleiben",
      "deaktiviere die Person stattdessen",
    ])
      expect(karte).toContain(teil);
  });

  test("die Anfrage ist DELETE auf die Person; danach Blatt zu, Liste neu, Toast", () => {
    expect(karte).toContain(
      'anfrage("DELETE", `/api/v1/admin/personen/${person.id}`)',
    );
    const reihe = [
      "anfrage(",
      "neu()",
      "fertig()",
      'document.querySelector("h1")?.focus()',
      "ctx.melde(`Konto von ${person.name} gelöscht.`)",
    ].map((t) => karte.indexOf(t));
    expect(reihe).not.toContain(-1);
    expect([...reihe].sort((x, y) => x - y)).toEqual(reihe);
  });

  test("Fehler bleiben in der Karte (kein Toast), Text aus fehlertext()", () => {
    expect(karte).toContain("Nicht gelöscht. ${fehlertext(f)}");
    expect(karte).not.toContain('"fehler"');
  });

  test("der Knopf erscheint nur für Abteilungsleitung und Entwickler und nie beim eigenen Konto", () => {
    const abschnitt = blatt.slice(blatt.indexOf("function kontoAbschnitt"));
    expect(abschnitt).toMatch(/eigenes\s*\?\s*el\(/);
    const eigene = abschnitt.indexOf("eigenes");
    const loeschen = abschnitt.indexOf("kontoLoeschenKarte(");
    // Er steht im Zweig für fremde Konten, hinter «Deaktivieren», und nur mit siehtAlles()
    expect(loeschen).toBeGreaterThan(abschnitt.indexOf('"Deaktivieren"'));
    expect(loeschen).toBeGreaterThan(eigene);
    expect(abschnitt).toMatch(
      /siehtAlles\(ctx\?\.ich\)\s*&&\s*kontoAktion\(\s*"Konto löschen"/,
    );
  });

  test("die Karte ist zugänglich: Beschreibung, Eingabefeld zuerst, Escape, Enter schickt das Formular nicht ab", () => {
    const aktionen = lies("aktionen.js");
    expect(aktionen).toContain('karte.setAttribute("aria-describedby"');
    expect(aktionen).toContain("(eingabe ?? abbrechen).focus()");
    expect(aktionen).toContain('e.key === "Escape"');
    expect(aktionen).toMatch(
      /e\.key !== "Enter"[\s\S]{0,80}e\.preventDefault\(\)/,
    );
    expect(aktionen).toContain("los.disabled = Boolean(erwartet)");
  });
});
