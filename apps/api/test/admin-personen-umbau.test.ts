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

  test("Import: eine Schrittfolge mit Zustand je Schritt, Verlauf je Schritt und Zusammenfassung", () => {
    const quelle = lies("import.js");
    expect(quelle).toContain('from "./schrittfolge.js"');
    // Browser-Zurück geht schrittweise zurück, die Eingaben bleiben im Schritt
    expect(quelle).toContain("importSchritt");
    expect(quelle).toContain('addEventListener("popstate"');
    expect(quelle).toContain("zusammen:");
    // Keine Seiten im Fluss und kein zweiter Import über «Zurück»
    expect(quelle).not.toContain("oeffneFluss");
    expect(quelle).toContain("zweiStufig");
    const folge = lies("schrittfolge.js");
    for (const zustand of ["offen", "aktuell", "erledigt", "fehler"]) {
      expect(folge).toContain(`${zustand}:`);
    }
    expect(folge).toContain('"aria-current"');
    expect(folge).toContain('role: "status"');
    // Nie nur Farbe: Zahl, Haken oder Warnsymbol im Marker, Zustand im Namen des Schritts
    expect(folge).toContain('icon("haken")');
    expect(folge).toContain('icon("warnung")');
    expect(folge).toContain("nur-leser");
  });

  test("Stufen: ruhige Karten ohne doppelte Angaben, Leitung als Sortierliste", () => {
    const stufen = lies("stufen.js");
    expect(stufen).toContain("st-leitung");
    expect(stufen).not.toContain("Keine Stufenleitung");
    expect(stufen).not.toContain("chip(");
  });

  test("Kinder: Zugang statt «ohne Eltern», Kind als Seite im Fluss", () => {
    const kinder = lies("kinder.js");
    expect(kinder).toContain("oeffneKind");
    expect(kinder).toContain('from "./formularraster.js"');
    expect(kinder).not.toContain("dialogFormular");
    expect(kinder).toContain("Ohne Zugang");
    expect(kinder).not.toContain("Ohne Eltern");
    // Ein Kind ohne Elternteil ist ein Hinweis, keine Warnung
    expect(kinder).not.toContain("hinweis--warn");
  });

  test("Website nach Rolle (#610): kein Schalter, nur ein Hinweis; Stufen werden zugewiesen, nicht vorab gezeigt", () => {
    const blatt = lies("personen-blatt.js");
    // Der Schalter und sein Feld im Aufruf sind weg
    expect(blatt).not.toContain("websiteFreigabe");
    expect(blatt).not.toContain("auf der Website zeigen");
    // Der Hinweis nennt die Regel und die Rollen
    expect(blatt).toContain("keine Auswahl, es folgt der Rolle");
    expect(blatt).toContain("Leitung oder Stufenleitung");
    // Stufe hinzufügen mit Rolle, Entfernen mit Rückgängig; «Teilnehmer» gibt es im Rechtemodell nicht
    expect(blatt).toContain('"Stufe hinzufügen"');
    expect(blatt).toContain('"Rückgängig"');
    expect(blatt).toContain("Rolle in der Stufe");
    expect(blatt).not.toContain('"Teilnehmer"');
    // Die Karte «Gruppen und Tags» bietet keine Stufen-Tags an, sie nennt sie nur
    expect(blatt).toContain('tag.typ !== "stufe"');
    expect(blatt).toContain("über «Rechte und Rollen»");
  });

  test("Gruppe einer Stufe: Leitung und Stufenleitung ändert man nur bei der Person", () => {
    const detail = lies("tags-detail.js");
    expect(detail).toContain("istStufenrolle");
    expect(detail).toContain("Bei der Person ändern");
  });

  test("die Telefonnummer wird in einer eigenen reinen Datei geschrieben", () => {
    expect(lies("telefon.js")).toContain("normalisiereTelefon");
  });
});
