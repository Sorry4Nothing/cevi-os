import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Anmeldung mit Startpasswort (#724): Bis zum Pflichtwechsel antwortet die API auf jede Route ausser GET /api/v1/ich mit 403, auch auf die Konto-Route des Kopfs. Die Seite der Anmeldung muss die Person darum zu «Mein Konto» führen, wo der Wechsel steht.
const SKRIPT = readFileSync(
  new URL("../public/website/anmelden.js", import.meta.url),
  "utf8",
);

describe("Website: Anmeldung führt bei Startpasswort zum Passwortwechsel", () => {
  test("liest den Zustand der Sitzung und führt zu /konto", () => {
    expect(SKRIPT).toContain('"/api/auth/get-session"');
    expect(SKRIPT).toContain("mussPasswortAendern");
    expect(SKRIPT).toMatch(/mussPasswortAendern\s*\?\s*"\/konto"\s*:\s*ziel/);
  });

  test("beide Wege (ohne und mit zweitem Faktor) gehen durch dieselbe Funktion", () => {
    expect(SKRIPT).not.toContain("location.assign(ziel);\n}\n\n//");
    expect(SKRIPT.match(/\bweiter\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
