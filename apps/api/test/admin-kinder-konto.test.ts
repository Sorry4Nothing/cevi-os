import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Konto eines Kindes in der Verwaltung (#644): reine Funktionen und Quelltext-Prüfungen.
// dom.js hängt beim Laden Zuhörer an document; ohne Browser genügt eine Attrappe.
type Modul = Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let konto: Modul;

beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener: () => {} });
  vi.stubGlobal("window", { addEventListener: () => {} });
  const name: string = "kinder-konto.js";
  konto = (await import(/* @vite-ignore */ `../public/admin/${name}`)) as Modul;
  vi.unstubAllGlobals();
});

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

describe("kinder-konto.js", () => {
  test("zugangVon folgt derselben Regel wie der Server", () => {
    expect(konto.zugangVon!(0, false, true)).toBe("keiner");
    expect(konto.zugangVon!(2, false, true)).toBe("eltern");
    // Ohne Konto zählt die Einsicht der Eltern nie
    expect(konto.zugangVon!(2, false, false)).toBe("eltern");
    expect(konto.zugangVon!(0, true, true)).toBe("konto");
    expect(konto.zugangVon!(1, true, true)).toBe("beides");
    expect(konto.zugangVon!(1, true, false)).toBe("konto");
  });

  test("zugangText nennt jeden Zustand mit Worten", () => {
    expect(konto.zugangText!("keiner")).toBe("Kein Zugang");
    expect(konto.zugangText!("eltern")).toBe("Eltern verknüpft");
    expect(konto.zugangText!("konto")).toBe("Eigenes Konto");
    expect(konto.zugangText!("beides")).toBe("Eltern und eigenes Konto");
    expect(konto.zugangText!("unbekannt")).toBe("Kein Zugang");
  });

  test("Benutzernamen-Vorschlag: nur erlaubte Zeichen, Umlaute aufgelöst, höchstens 64", () => {
    expect(konto.benutzernameVorschlag!("Mia", "Müller")).toBe("mia.mueller");
    expect(konto.benutzernameVorschlag!("Jean-Luc", "Dupré")).toBe(
      "jean-luc.dupre",
    );
    expect(konto.benutzernameVorschlag!("  ", "")).toBe("");
    const lang = konto.benutzernameVorschlag!("a".repeat(50), "b".repeat(50));
    expect(lang.length).toBeLessThanOrEqual(64);
    expect(lang).toMatch(/^[a-z0-9._-]*$/);
  });
});

describe("Quelltext", () => {
  test("Die Seite Kinder zeigt Zugang, Aktionen und Einstellungen; kein Popup, kein natives Feld", () => {
    const kinder = lies("kinder.js");
    expect(kinder).toContain("kontoKarte");
    expect(kinder).toContain("oeffneKontoEinstellung");
    const k = lies("kinder-konto.js");
    for (const text of [
      "Eigenes Konto erstellen",
      "Konto übergeben",
      "Konto sperren",
      "Konto entfernen",
      "Neues Startpasswort",
      "Die Eltern sind informiert und einverstanden",
    ]) {
      expect(k, text).toContain(text);
    }
    for (const datei of [kinder, k]) {
      expect(datei).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(datei).not.toContain('type: "date"');
      expect(datei).not.toContain('type: "number"');
    }
    // Rückfragen am Knopf
    expect(k).toContain("zweistufig(");
    expect(k).toContain("datumsfeld(");
  });
});
