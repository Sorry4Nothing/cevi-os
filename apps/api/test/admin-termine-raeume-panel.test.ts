import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Reiter «Räume» (#446, #447): Er ruft nur die Routen der Räume und der Raumanfragen auf
describe("Admin-Panel: Termine, Reiter Räume", () => {
  const modul = lies("termine-raeume.js");

  test("Modul und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/termine-raeume.css"');
    expect(lies("termine.js")).toContain('"./termine-raeume.js"');
  });

  test("lesen, anlegen, ändern und löschen nur über die Raum-Routen (und die Tags für das Team), entscheiden nur über die Anfrage-Routen", () => {
    expect(modul).toContain('"/api/v1/admin/raeume"');
    expect(modul).toContain('"/api/v1/raeume/anfragen"');
    expect(
      [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]).sort(),
    ).toEqual([
      "DELETE",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "PATCH",
      "POST",
      "POST",
    ]);
    expect(modul).toContain('"/api/v1/admin/tags"');
    expect(modul).toContain("/entscheid`");
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    expect(modul).not.toMatch(/setInterval|\.style\b|setAttribute\("style"/);
  });
});
