import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

const methoden = (modul: string) =>
  [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]).sort();

// Bereich «Räume» (#446, #447, A14 bis A16): «Räume» pflegt die Räume, «Anfragen» entscheidet über offene Raumanfragen
describe("Admin-Panel: Räume und Raumanfragen", () => {
  const raeume = lies("termine-raeume.js");
  const anfragen = lies("termine-anfragen.js");

  test("Module und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/termine-raeume.css"');
    const navigation = lies("navigation.js");
    expect(navigation).toContain('"./termine-raeume.js"');
    expect(navigation).toContain('"./termine-anfragen.js"');
  });

  test("Räume: lesen, anlegen, ändern und löschen nur über die Raum-Routen (und die Gruppen für das Team)", () => {
    expect(raeume).toContain('"/api/v1/admin/raeume"');
    expect(raeume).toContain('"/api/v1/admin/tags"');
    expect(methoden(raeume)).toEqual([
      "DELETE",
      "GET",
      "GET",
      "GET",
      "GET",
      "PATCH",
      "POST",
    ]);
    // Nur lesen, für die Zahl der offenen Anfragen je Raum; entscheiden tut die Seite «Anfragen»
    expect(raeume).toContain("/api/v1/raeume/anfragen/offen");
    expect(raeume).not.toContain("/entscheid");
  });

  test("Anfragen: lesen die offenen und entscheiden nur über die Anfrage-Routen", () => {
    expect(anfragen).toContain('"/api/v1/raeume/anfragen"');
    expect(anfragen).toContain("/entscheid`");
    expect(methoden(anfragen)).toEqual(["GET", "GET", "POST", "POST"]);
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    for (const modul of [raeume, anfragen]) {
      expect(modul).not.toMatch(/setInterval|\.style\b|setAttribute\("style"/);
    }
  });
});
