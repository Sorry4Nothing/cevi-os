import { describe, expect, test } from "vitest";
import {
  fuehreZusammen,
  LAGER_MATRIX,
  LAGER_PERSONAS,
  regelverstoesse,
  type LagerMatrix,
  type LagerPersona,
} from "./matrix.js";

describe("Lager-Matrix: Regeln über alle Zeilen aller Module", () => {
  test("die gefundenen Dateien haben Zeilen, und keine Zeile verletzt eine Regel", () => {
    expect(Object.keys(LAGER_MATRIX).length).toBeGreaterThan(0);
    expect(regelverstoesse(LAGER_MATRIX)).toEqual([]);
  });

  // Ein Selbsttest, dass die Regeln etwas fangen: Zeilen, die alles erlauben, verletzen jede
  test("Selbsttest: Zeilen mit falschen Erwartungen fallen auf", () => {
    const alle = (status: number) =>
      Object.fromEntries(LAGER_PERSONAS.map((p) => [p, status])) as Record<
        LagerPersona,
        number
      >;
    const schlecht: LagerMatrix = {
      "PUT /api/v1/admin/lager/:id": {
        erwartet: { aktiv: alle(204), abgeschlossen: alle(204) },
      },
      "PUT /api/v1/lager/:id/x": {
        url: () => "/",
        erwartet: { aktiv: alle(204), abgeschlossen: alle(204) },
      },
    };
    const fehler = regelverstoesse(schlecht).join("\n");
    expect(fehler).toContain(
      "PUT /api/v1/admin/lager/:id: Pfad-Parameter ohne url",
    );
    expect(fehler).toContain("ohneLogin muss 401 sein");
    expect(fehler).toContain("fremdeAbteilung muss 404 sein");
    expect(fehler).toContain("lagerleitung muss 403 sein");
    expect(fehler).toContain("ohneMitgliedschaft muss 404 sein");
    expect(fehler).toContain(
      "PUT /api/v1/lager/:id/x (abgeschlossen): team darf nicht schreiben",
    );
  });

  test("dieselbe Zeile in zwei Dateien ist ein Fehler", () => {
    const zeile = { erwartet: undefined as never };
    expect(() =>
      fuehreZusammen({
        "./matrix/a.ts": { ZEILEN: { "GET /x": zeile } },
        "./matrix/b.ts": { ZEILEN: { "GET /x": zeile } },
      }),
    ).toThrow(/Doppelte Matrix-Zeile «GET \/x»/);
  });
});
