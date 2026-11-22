import type { TermineMatrix } from "../matrix.js";

// TG1 #446: Die Räume lesen alle angemeldeten Personen einer Abteilung (Annahme R2), auch Eltern. Die Liste hat kein Objekt im Pfad: Die fremde Abteilung sieht ihre eigene (leere) Liste. Gesperrt sind nur Konten ohne gültige Sitzung (401) und mit offenem Passwortwechsel (403). Von Hand gegengelesen, nicht berechnet.
export const ZEILEN: TermineMatrix = {
  "GET /api/v1/raeume": {
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
};
