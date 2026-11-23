import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const lies = (pfad: string) =>
  readFileSync(new URL(`../public/${pfad}`, import.meta.url), "utf8");

// Die Verwaltung hat dieselbe Breite und denselben Seitenrand wie die Website (#607)
describe("Verwaltung: Breite wie die Website", () => {
  const website = lies("website/website.css");
  const admin = lies("admin/admin.css");

  test("Maximalbreite und Seitenrand sind die Werte der Website", () => {
    const breite = /\.wrap\s*\{[^}]*max-width:\s*([^;]+);/.exec(website)?.[1];
    const rand = /--rand:\s*([^;]+);/.exec(website)?.[1];
    expect(breite).toBe("105rem");
    expect(admin).toContain(`--seitenbreite: ${breite};`);
    expect(admin).toContain(`--seitenrand: ${rand};`);
  });

  test("Kopf, Leisten, Hinweisband und Inhalt nehmen die Tokens, keine eigenen Werte", () => {
    const klammer = "clamp(1rem, 4vw, 4.5rem)";
    for (const datei of ["admin", "geruest", "system", "toast"]) {
      const css = lies(`admin/${datei}.css`);
      expect(css, datei).not.toContain("max-width: 90rem");
      // Der Wert steht nur einmal, als Definition des Tokens
      expect(css.split(klammer).length - 1, datei).toBe(
        datei === "admin" ? 1 : 0,
      );
    }
    expect(lies("admin/geruest.css")).toContain(
      "max-width: var(--seitenbreite)",
    );
    expect(admin).toContain("max-width: var(--seitenbreite)");
  });
});
