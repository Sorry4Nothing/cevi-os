import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import * as liste from "../public/admin/protokoll-text.js";
// @ts-expect-error: Die Verwaltung besteht aus Browser-Modulen ohne Typen
import { BEREICHE, darfSehen } from "../public/admin/navigation.js";

// Die Seite «Protokoll» der Verwaltung (#637): Einbindung, Sichtbarkeit nur für den Entwickler, reine Logik der Zeitleiste
const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");
const DATEIEN = [
  "protokoll.js",
  "protokoll-liste.js",
  "protokoll-text.js",
  "protokoll.css",
];

describe("Einbindung und Zugang", () => {
  const eintrag = BEREICHE.find(
    (b: { schluessel: string }) => b.schluessel === "system",
  ).unter.find((u: { schluessel: string }) => u.schluessel === "protokoll");

  test("Seite und Stile sind eingebunden", () => {
    expect(eintrag.modul).toBe("./protokoll.js");
    expect(lies("index.html")).toContain('href="/admin/protokoll.css"');
  });

  test("sichtbar nur für den Entwickler: nicht für die Abteilungsleitung, nicht für andere Rollen", () => {
    expect(eintrag.zugang).toBe("entwickler");
    expect(darfSehen(eintrag, { istAdmin: true, entwickler: false })).toBe(
      false,
    );
    expect(
      darfSehen(eintrag, {
        istAdmin: false,
        zugang: { bereiche: ["website", "plattform"], rechte: [] },
      }),
    ).toBe(false);
    expect(darfSehen(eintrag, { istAdmin: true, entwickler: true })).toBe(true);
  });
});

describe("Quelltext", () => {
  const alle = DATEIEN.slice(0, 3).map(lies).join("\n");

  test("sie ruft nur die Routen des Protokolls auf", () => {
    expect(alle).toContain("/api/v1/admin/protokoll");
    expect(alle).toContain("/verlauf");
    expect(alle).toContain("/export.csv");
    expect(alle).not.toMatch(/\/api\/v1\/(?!admin\/protokoll)/);
  });

  test("kein Popup, kein Polling, keine Inline-Stile, keine Farbwerte, kein HTML aus Daten", () => {
    expect(alle).not.toMatch(
      /\balert\(|\bconfirm\(|\bprompt\(|setInterval|\.style\b|setAttribute\("style"|<dialog|innerHTML/,
    );
    expect(lies("protokoll.css")).not.toMatch(/:\s*[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });

  test("Bewegung nur unter prefers-reduced-motion: no-preference", () => {
    const css = lies("protokoll.css");
    const ausserhalb = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g,
      "",
    );
    expect(ausserhalb).not.toMatch(/transition|animation/);
  });
});

describe("Zeitleiste (reine Funktionen)", () => {
  const jetzt = new Date("2026-11-23T12:00:00Z");

  test("relative Zeit: eben, Minuten, Stunden, sonst die Uhrzeit", () => {
    const vor = (s: number) =>
      liste.relativ(
        new Date(jetzt.getTime() - s * 1000).toISOString(),
        jetzt.getTime(),
      );
    expect(vor(10)).toBe("gerade eben");
    expect(vor(5 * 60)).toMatch(/5 Minuten/);
    expect(vor(3 * 3600)).toMatch(/3 Stunden/);
    expect(vor(30 * 3600)).toMatch(/^\d{2}:\d{2}$/);
  });

  test("Tageskopf: Heute, Gestern, sonst Wochentag und Datum in Schweizer Zeit", () => {
    expect(liste.tagText("2026-11-23T08:00:00Z", jetzt)).toBe("Heute");
    expect(liste.tagText("2026-11-22T08:00:00Z", jetzt)).toBe("Gestern");
    expect(liste.tagText("2026-11-01T08:00:00Z", jetzt)).toMatch(
      /Sonntag, 1\. November 2026/,
    );
    // 23:30 UTC ist in Zürich schon der nächste Tag
    expect(liste.tagSchluessel("2026-11-22T23:30:00Z")).toBe("2026-11-23");
  });

  test("Wer: Name, sonst die Art des Akteurs", () => {
    const eintrag = (benutzer: object) => ({ benutzer });
    expect(liste.wer(eintrag({ name: "Muster", akteur: "person" }))).toBe(
      "Muster",
    );
    expect(liste.wer(eintrag({ name: null, akteur: "anonym" }))).toBe(
      "Nicht angemeldet",
    );
    expect(liste.wer(eintrag({ name: null, akteur: "cli" }))).toBe(
      "Kommandozeile",
    );
    expect(liste.wer(eintrag({ name: null, akteur: "system" }))).toBe("System");
  });
});
