import * as schema from "../../../src/db/schema.js";
import type { Welt } from "../../hilfen/personas.js";
import type { TermineMatrix, TerminePersona } from "../matrix.js";

// Matrix-Zeilen von TG1 (#446): Räume verwalten. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Nur die Abteilungsleitung darf (Annahme R1): jede andere Rolle der Abteilung 403, auch Stufenleitung und Leitung. Mit Raum im Pfad ist ein fremder Raum 404 (auch für die Abteilungsleitung der anderen Abteilung), ohne Raum im Pfad bekommt sie die Antwort ihrer eigenen Abteilung.
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

let zaehler = 0;
async function neuerRaum(welt: Welt) {
  const [zeile] = await welt.db
    .insert(schema.raum)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Matrixraum ${Date.now()}-${zaehler++}`,
    })
    .returning({ id: schema.raum.id });
  return zeile.id;
}

export async function VORBEREITUNG(welt: Welt) {
  return { raum: await neuerRaum(welt) };
}

const BASIS = "/api/v1/admin/raeume";

export const ZEILEN: TermineMatrix = {
  // Jede Anfrage braucht einen neuen Namen: Der Name ist je Abteilung eindeutig
  "POST /api/v1/admin/raeume": {
    // Die Abteilungsleitung der anderen Abteilung legt in ihrer eigenen einen Raum an
    erwartet: status({
      abteilungsleitung: 201,
      fremdeAbteilungsleitung: 201,
      fremdeEltern: 403,
    }),
    body: () => ({ name: `Neu ${Date.now()}-${zaehler++}` }),
  },
  "GET /api/v1/admin/raeume": {
    // Ohne Objekt im Pfad: Die fremde Abteilungsleitung sieht ihre eigene (leere) Liste, fremde Eltern bekommen 403
    erwartet: status({ fremdeAbteilungsleitung: 200, fremdeEltern: 403 }),
  },
  "PATCH /api/v1/admin/raeume/:id": {
    erwartet: status({ abteilungsleitung: 204 }),
    url: (k) => `${BASIS}/${k.ids["admin-raeume"]!.raum}`,
    body: () => ({ kapazitaet: 12 }),
  },
  // Jede Anfrage bekommt einen frischen Raum, weil das Löschen ihn verbraucht
  "DELETE /api/v1/admin/raeume/:id": {
    erwartet: status({ abteilungsleitung: 204 }),
    url: async (k) => `${BASIS}/${await neuerRaum(k.welt)}`,
  },
};
