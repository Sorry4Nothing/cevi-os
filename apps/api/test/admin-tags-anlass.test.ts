import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Gruppentyp «Anlass» (#626) in der Verwaltung: Die Module rufen nur vorhandene Routen auf und kennen den Typ überall, wo Typen aufgelistet werden
describe("Admin-Panel: Gruppentyp «Anlass»", () => {
  test("der Typ steht in der Typliste für Filter, Chips und Befehlspalette", () => {
    expect(lies("tags-detail.js")).toContain('["anlass", "Anlass"]');
    // Die Befehlspalette und die Personenliste nehmen den Namen aus typName()
    expect(lies("befehlspalette.js")).toContain("typName");
    for (const datei of ["termine-kategorien.js", "termine-raeume.js"]) {
      expect(lies(datei)).toContain('anlass: "Anlass"');
    }
  });

  test("das Anlegen schickt anlassId nur für den Typ «anlass» und kennt die beiden Fehlercodes", () => {
    const quelle = lies("tags-detail.js");
    expect(quelle).toContain("anlassId");
    expect(quelle).toContain("ANLASS_HAT_GRUPPE");
    expect(quelle).toContain("ANLASS_UNBEKANNT");
    expect(quelle).toContain("ladeFreieAnlaesse");
  });

  test("die Anlässe zum Auswählen kommen aus der Liste der Anlässe, ohne Lager und ohne Gruppe", () => {
    const quelle = lies("tags-anlass.js");
    expect(quelle).toContain("/api/v1/admin/anlaesse?limit=100");
    expect(quelle).toContain('a.art === "anlass" && !a.gruppe');
  });

  test("Liste, Detail und Anlass verweisen aufeinander", () => {
    expect(lies("tags.js")).toContain("anlassZeile(tag)");
    expect(lies("tags-anlass.js")).toContain("#anlaesse/");
    const anlass = lies("termine-anlaesse.js");
    expect(anlass).toContain("#personen/gruppen/");
    expect(anlass).toContain("OK anlegen");
  });

  test("keine nativen Popups", () => {
    for (const datei of ["tags-anlass.js", "tags-detail.js", "tags.js"]) {
      expect(lies(datei)).not.toMatch(/\b(alert|confirm|prompt)\(/);
    }
  });
});
