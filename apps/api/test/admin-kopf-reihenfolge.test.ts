import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Kopf der Verwaltung: Suche, Profil mit Konto-Menü, ganz rechts der Umschalter Hell und Dunkel, wie im Kopf der Website (Konto-Menü vor dem Umschalter)
test("der Umschalter steht hinter dem Konto-Menü, auf der Anmeldeseite bleibt er allein", () => {
  const rahmen = readFileSync(
    new URL("../public/admin/rahmen.js", import.meta.url),
    "utf8",
  );
  const kopf = rahmen.slice(rahmen.indexOf("export function logozeile"));
  const suche = kopf.indexOf("suche?.()");
  const menue = kopf.indexOf("erstelleKontoMenue(");
  const thema = kopf.indexOf("themaSchalter()");
  expect(suche).toBeGreaterThan(0);
  expect(menue).toBeGreaterThan(suche);
  expect(thema).toBeGreaterThan(menue);
  // «Abmelden» gehört ins Menü, nicht mehr als Knopf in die Leiste
  expect(kopf).not.toContain('"Abmelden"');
  expect(rahmen).toContain('"Abmelden"');
});
