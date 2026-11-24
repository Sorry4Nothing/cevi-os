import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// «Konto löschen» im Blatt einer Person (#769, #771): Die Quelle sichert die Regeln der Oberfläche; die Route selbst deckt test/konto-loeschen.test.ts und test/entwickler-alle-rechte.test.ts ab
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

  test("der Knopf erscheint mit dem Recht konto.loeschen und nie beim eigenen Konto (#771)", () => {
    const abschnitt = blatt.slice(blatt.indexOf("function kontoAbschnitt"));
    expect(abschnitt).toMatch(/eigenes\s*\?\s*el\(/);
    const eigene = abschnitt.indexOf("eigenes");
    const loeschen = abschnitt.indexOf("kontoLoeschenAktion(");
    // Er steht im Zweig für fremde Konten, hinter «Deaktivieren»
    expect(loeschen).toBeGreaterThan(abschnitt.indexOf('"Deaktivieren"'));
    expect(loeschen).toBeGreaterThan(eigene);
    // Nicht mehr an siehtAlles gebunden, sondern an das Recht
    const aktion = blatt.slice(
      blatt.indexOf("function kontoLoeschenAktion"),
      blatt.indexOf("function faktorZuruecksetzen"),
    );
    expect(aktion).toContain('r.recht === "konto.loeschen"');
    expect(aktion).toContain("ctx?.ich?.rechte");
    expect(aktion).not.toMatch(/siehtAlles\(ctx\?\.ich\)\s*&&/);
  });

  test("geschützte Konten zeigen den Grund statt des Knopfs, wie der Server sie schützt", () => {
    const aktion = blatt.slice(
      blatt.indexOf("function kontoLoeschenAktion"),
      blatt.indexOf("function faktorZuruecksetzen"),
    );
    expect(aktion).toContain("person.entwickler && !istEntwickler(ctx.ich)");
    expect(aktion).toContain("Dieses Konto darf nur ein Entwickler löschen.");
    expect(aktion).toContain(
      "person.abteilungsleitung && !siehtAlles(ctx.ich)",
    );
    expect(aktion).toContain(
      "Dieses Konto darf nur die Abteilungsleitung oder ein Entwickler löschen.",
    );
    expect(aktion).toContain("grund ? null : kontoLoeschenKarte(");
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
