import { describe, expect, test } from "vitest";
import {
  fuehreZusammen,
  regelverstoesse,
  TERMINE_MATRIX,
  TERMINE_PERSONAS,
  type TermineMatrix,
  type TerminePersona,
} from "./matrix.js";

const alle = (status: number) =>
  Object.fromEntries(TERMINE_PERSONAS.map((p) => [p, status])) as Record<
    TerminePersona,
    number
  >;

describe("Termine-Matrix: Regeln über alle Zeilen aller Module", () => {
  // Ohne Folge-Issues hat die Matrix keine Zeilen; die Regeln gelten für jede, die dazukommt
  test("keine Zeile der gefundenen Dateien verletzt eine Regel", () => {
    expect(regelverstoesse(TERMINE_MATRIX)).toEqual([]);
  });

  // Ein Selbsttest, dass die Regeln etwas fangen: Zeilen, die alles erlauben, verletzen jede
  test("Selbsttest: Zeilen mit falschen Erwartungen fallen auf", () => {
    const schlecht: TermineMatrix = {
      "PUT /api/v1/admin/termine/:id": { erwartet: alle(204) },
      "GET /api/v1/admin/termine/liste": { erwartet: alle(200) },
    };
    const fehler = regelverstoesse(schlecht).join("\n");
    expect(fehler).toContain(
      "PUT /api/v1/admin/termine/:id: Pfad-Parameter ohne url",
    );
    expect(fehler).toContain("ohneLogin muss 401 sein");
    expect(fehler).toContain("deaktiviert muss 401 sein");
    expect(fehler).toContain("passwortPflicht muss 403 sein");
    expect(fehler).toContain("fremdeAbteilungsleitung muss 404 sein");
    expect(fehler).toContain("fremdeEltern muss 404 sein");
    expect(fehler).toContain(
      "GET /api/v1/admin/termine/liste: stufenleitungA muss 403 sein",
    );
    expect(fehler).toContain(
      "GET /api/v1/admin/termine/liste: fremdeEltern muss 403 sein",
    );
  });

  test("eine korrekte Zeile und eine öffentliche Route ohne Sitzung bestehen", () => {
    const gut: TermineMatrix = {
      "GET /api/v1/termine/mein": {
        erwartet: {
          ...alle(200),
          passwortPflicht: 403,
          deaktiviert: 401,
          ohneLogin: 401,
        },
      },
      // Der Feed kennt keine Sitzung: Anmeldung und Rollen spielen keine Rolle
      "GET /ical/:token": {
        url: () => "/ical/x",
        oeffentlich: true,
        erwartet: alle(404),
      },
    };
    expect(regelverstoesse(gut)).toEqual([]);
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
