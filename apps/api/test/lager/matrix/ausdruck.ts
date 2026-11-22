import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeile von #405: Aushänge als PDF. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet. Die Zeile gilt für den Schichtplan (einteilung.lesen): Lagerleitung, Abteilungsleitung, Leitung, Team und Lesen 200, auch im abgeschlossenen Lager (lesend); Nicht-Mitglied und fremde Abteilung 404. Die anderen Arten (Zimmerliste, Türschilder, Gruppenlisten und Fahrtenliste mit teilnehmer.lesen, Organigramm mit ressorts.lesen, dort 403 für das Team) prüft aushaenge.test.ts je Persona und Art.
const status = (
  werte: Partial<Record<LagerPersona, number>>,
): Record<LagerPersona, number> => ({
  abteilungsleitung: 200,
  lagerleitung: 200,
  leitung: 200,
  team: 200,
  lesen: 200,
  ohneMitgliedschaft: 404,
  fremdeAbteilung: 404,
  ohneLogin: 401,
  ...werte,
});

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/aushaenge/:art": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/aushaenge/schichtplan`,
    erwartet: { aktiv: status({}), abgeschlossen: status({}) },
  },
};
