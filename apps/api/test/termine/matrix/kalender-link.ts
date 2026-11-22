import type { TermineMatrix } from "../matrix.js";

// TC1 #437: Der Link gehört jeder angemeldeten Person (kein zweiter Faktor, keine Rolle); jede verwaltet nur ihren eigenen, darum gibt es kein fremdes Objekt. Gesperrt sind nur die Konten ohne gültige Sitzung (401) und mit offenem Passwortwechsel (403). Von Hand gegengelesen, nicht berechnet.
const jede = (status: number): TermineMatrix[string]["erwartet"] => ({
  abteilungsleitung: status,
  adminOhneFaktor: status,
  stufenleitungA: status,
  stufenleitungB: status,
  leitungA: status,
  leitungB: status,
  leitungAElternB: status,
  elternA: status,
  elternB: status,
  passwortPflicht: 403,
  deaktiviert: 401,
  ohneLogin: 401,
  fremdeAbteilungsleitung: status,
  fremdeEltern: status,
});

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/ich/kalender-link": { erwartet: jede(200) },
  "POST /api/v1/ich/kalender-link": { erwartet: jede(201) },
  "DELETE /api/v1/ich/kalender-link": { erwartet: jede(204) },
};
