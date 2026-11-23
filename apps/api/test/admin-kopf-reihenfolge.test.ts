import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Kopf der Verwaltung: Konto, Suche, «Abmelden», ganz rechts der Umschalter Hell und Dunkel, wie im Kopf der Website
test("der Umschalter steht hinter «Abmelden», auf der Anmeldeseite bleibt er allein", () => {
  const rahmen = readFileSync(
    new URL("../public/admin/rahmen.js", import.meta.url),
    "utf8",
  );
  const kopf = rahmen.slice(rahmen.indexOf("export function logozeile"));
  expect(kopf.indexOf('"Abmelden"')).toBeGreaterThan(0);
  expect(kopf.indexOf("themaSchalter()")).toBeGreaterThan(
    kopf.indexOf('"Abmelden"'),
  );
});
