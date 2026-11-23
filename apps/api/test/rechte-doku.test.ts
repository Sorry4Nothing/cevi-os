import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LAGER_RECHTE, LAGER_ROLLEN } from "../src/lager/rechte-katalog.js";
import { PLATTFORM_RECHT_NAMEN } from "../src/plattform.js";
import { TERMINE_RECHTE } from "../src/termine/rechte-katalog.js";

// docs/rechte.md beschreibt, wer was darf. Dieser Test hält die Seite beim Code: Jedes Recht der Kataloge steht darin, und in den Tabellen der Kataloge steht kein Recht, das es nicht gibt. Er prüft nicht, ob die Beschreibung stimmt; das tun die Matrizen.
const doku = readFileSync(
  new URL("../../../docs/rechte.md", import.meta.url),
  "utf8",
);

// Der Text zwischen zwei Überschriften
function abschnitt(von: string, bis?: string) {
  const start = doku.indexOf(von);
  expect(start, `Überschrift «${von}» fehlt`).toBeGreaterThanOrEqual(0);
  const ende = bis ? doku.indexOf(bis, start) : doku.length;
  return doku.slice(start, ende < 0 ? doku.length : ende);
}

// Namen am Anfang einer Tabellenzeile: «| `recht.name` | …»
const tabellenNamen = (text: string) =>
  [...text.matchAll(/^\| `([a-z_]+\.[a-z_]+)`/gm)].map((m) => m[1]);

describe("docs/rechte.md", () => {
  test("jedes Plattformrecht steht in Abschnitt 2, und dort steht kein anderes", () => {
    const tabelle = abschnitt(
      "## 2. Der Rechtekatalog der Plattform",
      "## 3. Grundregeln",
    );
    expect(tabellenNamen(tabelle).sort()).toEqual(
      [...PLATTFORM_RECHT_NAMEN].sort(),
    );
  });

  test("jedes Recht des Lagers steht in Anhang A, und dort steht kein anderes", () => {
    const tabelle = abschnitt("## Anhang A", "## Anhang B");
    expect(tabellenNamen(tabelle).sort()).toEqual([...LAGER_RECHTE].sort());
  });

  test("jedes Recht der Termine steht in Anhang B, und dort steht kein anderes", () => {
    const tabelle = abschnitt("## Anhang B");
    expect(tabellenNamen(tabelle).sort()).toEqual(
      Object.keys(TERMINE_RECHTE).sort(),
    );
  });

  test.each(LAGER_ROLLEN)("die Lager-Rolle «%s» kommt vor", (rolle) => {
    expect(doku).toContain(`\`${rolle}\``);
  });
});
