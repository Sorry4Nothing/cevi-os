import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (datei: string) =>
  readFileSync(new URL(`../public/admin/${datei}`, import.meta.url), "utf8");

// Personen, Gruppen und Tags im neuen Design (#525): Die Module rufen nur vorhandene Routen auf
describe("Admin-Panel: Personen, Gruppen und Tags", () => {
  test("Module und Stilvorlage sind eingebunden", () => {
    expect(lies("index.html")).toContain('href="/admin/personen.css"');
    const navigation = lies("navigation.js");
    expect(navigation).toContain('"./personen.js"');
    expect(navigation).toContain('"./tags.js"');
  });

  test("die Liste der Gruppen braucht nur einen Abruf, das Detail den Einzelabruf", () => {
    const liste = lies("tags.js");
    expect(liste.match(/anfrage\(/g)).toHaveLength(1);
    expect(liste).toContain('"/api/v1/admin/tags"');
    expect(lies("tags-detail.js")).toContain("/api/v1/admin/tags/${");
  });

  test("alle Routen der Module stehen im Vertrag", () => {
    const vertrag = readFileSync(
      new URL("../../../docs/api/openapi.yaml", import.meta.url),
      "utf8",
    );
    const quelle = [
      "personen.js",
      "personen-blatt.js",
      "tags.js",
      "tags-detail.js",
    ]
      .map(lies)
      .join("\n");
    const pfade = new Set(
      [...quelle.matchAll(/["`](\/api\/v1\/admin\/[^"`]+)["`]/g)].map((t) =>
        t[1]!.replace(/\$\{[^}]+\}/g, "{x}"),
      ),
    );
    // Der Pfad für Aktivieren und Deaktivieren wird zusammengesetzt und fällt hier heraus
    for (const pfad of pfade) if (pfad.includes("$")) pfade.delete(pfad);
    expect(pfade.size).toBeGreaterThan(5);
    const vertragsPfade = [
      ...vertrag.matchAll(/^ {2}(\/api\/v1\/admin\/\S+):$/gm),
    ].map((t) => t[1]!.replace(/\{[^}]+\}/g, "{x}"));
    for (const pfad of pfade) expect(vertragsPfade).toContain(pfad);
  });
});
