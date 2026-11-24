import type { TermineMatrix, TermineModulDatei } from "../matrix.js";
import { legeProgrammAn } from "../../hilfen/programme.js";

// Matrix-Zeilen von TB1 (#435): «Mein Kalender» für die Apps. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Liste antwortet jeder angemeldeten Person mit 200 (auch leer); wer keinen Tag hat, sieht nichts, auch die Abteilungsleitung. Das Detail trägt einen Termin mit dem Tag der Stufe A: wer ihn nicht sieht, bekommt 404 (nie 403)
export const VORBEREITUNG: NonNullable<
  TermineModulDatei["VORBEREITUNG"]
> = async (welt) => {
  const termin = await legeProgrammAn(welt.db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: "eltern",
    // Der Termin trägt den Tag der Stufe A (legeProgrammAn setzt programm_tag)
    stufen: [welt.stufeAId],
    titel: "Matrix-Termin",
  });
  return { terminId: termin.id };
};

const FENSTER = "von=2027-03-01&bis=2027-03-07";

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/termine/mein": {
    url: () => `/api/v1/termine/mein?${FENSTER}`,
    erwartet: {
      abteilungsleitung: 200,
      adminOhneFaktor: 200,
      stufenleitungA: 200,
      stufenleitungB: 200,
      leitungA: 200,
      leitungB: 200,
      leitungAElternB: 200,
      elternA: 200,
      elternB: 200,
      passwortPflicht: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      fremdeAbteilungsleitung: 200,
      fremdeEltern: 200,
    },
  },
  "GET /api/v1/termine/:id": {
    url: (k) => `/api/v1/termine/${k.ids.mein.terminId}`,
    erwartet: {
      abteilungsleitung: 404,
      adminOhneFaktor: 404,
      stufenleitungA: 200,
      stufenleitungB: 404,
      leitungA: 200,
      leitungB: 404,
      leitungAElternB: 200,
      elternA: 200,
      elternB: 404,
      passwortPflicht: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      fremdeAbteilungsleitung: 404,
      fremdeEltern: 404,
    },
  },
};
