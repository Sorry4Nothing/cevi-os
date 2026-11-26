import * as schema from "../../../src/db/schema.js";
import { legeProgrammAn } from "../../hilfen/programme.js";
import type { Welt } from "../../hilfen/personas.js";
import type { TermineMatrix, TerminePersona } from "../matrix.js";

// Matrix-Zeilen von TE1 (#442): Anlässe verwalten. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Nur die Abteilungsleitung darf (Annahme A10): jede andere Rolle der Abteilung 403, auch Stufenleitung und Leitung. Mit Anlass im Pfad ist ein fremder Anlass 404 (auch für die Abteilungsleitung der anderen Abteilung), ohne Anlass im Pfad bekommt sie die Antwort ihrer eigenen Abteilung.
const status = (
  werte: Partial<Record<TerminePersona, number>>,
): Record<TerminePersona, number> => ({
  abteilungsleitung: 200,
  adminOhneFaktor: 403,
  stufenleitungA: 403,
  stufenleitungB: 403,
  leitungA: 403,
  leitungB: 403,
  leitungAElternB: 403,
  elternA: 403,
  elternB: 403,
  passwortPflicht: 403,
  deaktiviert: 401,
  ohneLogin: 401,
  fremdeAbteilungsleitung: 404,
  fremdeEltern: 404,
  ...werte,
});

async function neuerAnlass(welt: Welt) {
  const termin = await legeProgrammAn(welt.db, {
    abteilungId: welt.testabteilungId,
  });
  const [zeile] = await welt.db
    .insert(schema.anlass)
    .values({
      abteilungId: welt.testabteilungId,
      programmId: termin.id,
      sichtbarkeit: "angemeldet",
    })
    .returning({ id: schema.anlass.id });
  return { programmId: termin.id, anlassId: zeile.id };
}

export async function VORBEREITUNG(welt: Welt) {
  const vorhanden = await neuerAnlass(welt);
  // Ein Termin ohne Anlass für die Zeile «anlegen»
  const frei = await legeProgrammAn(welt.db, {
    abteilungId: welt.testabteilungId,
  });
  return { anlass: vorhanden.anlassId, programm: frei.id };
}

const BASIS = "/api/v1/admin/anlaesse";

export const ZEILEN: TermineMatrix = {
  "POST /api/v1/admin/anlaesse": {
    // Die Abteilungsleitung der anderen Abteilung kennt den Termin nicht: 404, wie jede fremde ID
    erwartet: status({ abteilungsleitung: 201, fremdeEltern: 403 }),
    body: (k) => ({
      programmId: k.ids["admin-anlaesse"]!.programm,
      anmeldungOffen: true,
      sichtbarkeit: { art: "angemeldet" },
      felder: [],
    }),
  },
  "GET /api/v1/admin/anlaesse": {
    // Ohne Objekt im Pfad: Die fremde Abteilungsleitung sieht ihre eigene (leere) Liste, fremde Eltern bekommen 403
    erwartet: status({ fremdeAbteilungsleitung: 200, fremdeEltern: 403 }),
  },
  // Die Gruppen für die Sichtbarkeit (nur Name und Typ): wer Anlässe verwalten darf, sonst niemand; die fremde Abteilungsleitung sieht ihre eigene Liste
  "GET /api/v1/admin/anlaesse/gruppen": {
    erwartet: status({ fremdeAbteilungsleitung: 200, fremdeEltern: 403 }),
  },
  "GET /api/v1/admin/anlaesse/:id": {
    erwartet: status({}),
    url: (k) => `${BASIS}/${k.ids["admin-anlaesse"]!.anlass}`,
  },
  "PATCH /api/v1/admin/anlaesse/:id": {
    erwartet: status({ abteilungsleitung: 204 }),
    url: (k) => `${BASIS}/${k.ids["admin-anlaesse"]!.anlass}`,
    body: () => ({ anmeldungOffen: true }),
  },
  "PUT /api/v1/admin/anlaesse/:id/felder": {
    erwartet: status({}),
    url: (k) => `${BASIS}/${k.ids["admin-anlaesse"]!.anlass}/felder`,
    body: () => ({ felder: [] }),
  },
  // Jede Anfrage bekommt einen frischen Anlass, weil das Löschen ihn verbraucht
  "DELETE /api/v1/admin/anlaesse/:id": {
    erwartet: status({ abteilungsleitung: 204 }),
    url: async (k) => `${BASIS}/${(await neuerAnlass(k.welt)).anlassId}`,
  },
};
