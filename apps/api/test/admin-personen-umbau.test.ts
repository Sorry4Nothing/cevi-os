import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Bereich «Personen» im neuen Aufbau (#594): Die Module nutzen die gemeinsamen Bausteine statt eigener Nachbauten
describe("Admin-Panel: Personen, Gruppen, Kinder, Stufen, Import (#594)", () => {
  test("Personenliste: Filterleiste, Rückgängig für Tags, Person als Seite", () => {
    const liste = lies("personen.js");
    expect(liste).toContain('from "./filterleiste.js"');
    expect(liste).toContain("ctx.mitRueckgaengig");
    expect(liste).toContain("oeffnePerson");
    // Keine Dialoge mehr für Erfassen und Sammelaktion
    expect(liste).not.toContain("dialogFormular");
    const seite = lies("personen-blatt.js");
    expect(seite).toContain('from "./formularraster.js"');
    expect(seite).toContain("normalisiereTelefon");
    expect(seite).toContain("bildUrl");
  });

  test("Spalte und Rolle zeigen keine Rohwerte und mischen keine Begriffe", () => {
    const blatt = lies("personen-blatt.js");
    expect(blatt).toContain("export function kontoChips");
    expect(blatt).toContain('"Stufenleitung"');
    expect(lies("personen.js")).toContain('"Konto"');
    expect(lies("personen.js")).not.toContain('"Status"');
    expect(lies("tags-detail.js")).toContain("ROLLENNAME");
  });

  test("Gruppe: Mitgliederliste mit Live-Filter, Hinzufügen und Entfernen mit Rückgängig", () => {
    const detail = lies("tags-detail.js");
    expect(detail).toContain("kandidatenSuche");
    expect(
      detail.match(/ctx\.mitRueckgaengig/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(detail).toContain("Mitglieder filtern");
  });

  test("Stufen: Reihenfolge der Leitung per Sortierliste mit Rückgängig, ohne eigenen Dialog", () => {
    const stufen = lies("stufen.js");
    expect(stufen).toContain('from "./sortieren.js"');
    expect(stufen).toContain("mitRueckgaengig: ctx.mitRueckgaengig");
    expect(stufen).not.toContain('Cevi-Logo"');
    expect(stufen).not.toContain("function reihenfolge");
  });

  test("Kinder: Eltern per Suche statt Checkliste, Leerzustand", () => {
    const kinder = lies("kinder.js");
    expect(kinder).toContain("suchWahl");
    expect(kinder).not.toContain("scrollen: true");
    expect(kinder).toContain("Es gibt noch keine Kinder");
  });

  test("Dateien werden mit dem eigenen Dateifeld gewählt, nicht mit dem des Browsers", () => {
    for (const datei of ["stufen.js", "import.js"]) {
      const quelle = lies(datei);
      expect(quelle).toContain("dateiFeld");
      expect(quelle).not.toContain('typ: "file"');
    }
  });

  test("Import: Schritte sind Seiten im Fluss mit Schrittleiste", () => {
    const quelle = lies("import.js");
    expect(quelle).toContain("seitenSchritt");
    expect(quelle).toContain("schrittLeiste");
    expect(quelle).toContain('"aria-current"');
    expect(quelle).toContain("oeffneFluss");
  });

  test("die Telefonnummer wird in einer eigenen reinen Datei geschrieben", () => {
    expect(lies("telefon.js")).toContain("normalisiereTelefon");
  });
});
