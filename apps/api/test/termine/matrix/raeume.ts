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
  // #628: Die Belegung sehen nur Leitende (Abteilungsleitung, Leitung und Stufenleitung einer Stufe); Eltern 403. Wunsch des Nutzers, vom Nutzer zu bestätigen. Die fremde Abteilungsleitung sieht ihre eigene (leere) Belegung. Die Wirkung steht in test/termine/belegung.test.ts
  "GET /api/v1/raeume/belegung": {
    erwartet: {
      abteilungsleitung: 200,
      adminOhneFaktor: 200,
      stufenleitungA: 200,
      stufenleitungB: 200,
      leitungA: 200,
      leitungB: 200,
      leitungAElternB: 200,
      elternA: 403,
      elternB: 403,
      passwortPflicht: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      fremdeAbteilungsleitung: 200,
      fremdeEltern: 403,
    },
    url: () => "/api/v1/raeume/belegung?von=2099-01-01&bis=2099-01-07",
  },
};
