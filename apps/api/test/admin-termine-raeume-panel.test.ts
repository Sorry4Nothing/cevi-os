import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Reiter «Räume» (#446): Er ruft nur die Routen der Abteilungsleitung aus #446 auf
describe("Admin-Panel: Termine, Reiter Räume", () => {
  const modul = lies("termine-raeume.js");

  test("Modul und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/termine-raeume.css"');
    expect(lies("termine.js")).toContain('"./termine-raeume.js"');
  });

  test("lesen, anlegen, ändern und löschen nur über die Raum-Routen (und die Tags für das Team)", () => {
    expect(modul).toContain('"/api/v1/admin/raeume"');
    expect(
      [...modul.matchAll(/anfrage\(\s*"(\w+)"/g)].map((t) => t[1]).sort(),
    ).toEqual(["DELETE", "GET", "GET", "GET", "PATCH", "POST"]);
    expect(modul).toContain('"/api/v1/admin/tags"');
  });

  test("kein Polling und keine Inline-Stile (strenge CSP)", () => {
    expect(modul).not.toMatch(/setInterval|\.style\b|setAttribute\("style"/);
  });
});
