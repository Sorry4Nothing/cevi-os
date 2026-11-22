import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von L0c (#366): Änderungsfeed. Jedes Mitglied darf den Feed abrufen (er filtert selbst nach Recht und Rolle, siehe sync.test.ts); wer kein Mitglied ist und die fremde Abteilung bekommen 404. Das abgeschlossene Lager lässt das Lesen zu
const lesen: Record<LagerPersona, number> = {
  abteilungsleitung: 200,
  lagerleitung: 200,
  leitung: 200,
  team: 200,
  lesen: 200,
  ohneMitgliedschaft: 404,
  fremdeAbteilung: 404,
  ohneLogin: 401,
};

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/aenderungen": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/aenderungen?seit=0`,
    erwartet: { aktiv: lesen, abgeschlossen: lesen },
  },
};
