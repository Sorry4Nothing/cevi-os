import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von #520: Mitglieder ohne Abteilungsleitung. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Recht einteilung.lesen (Standard: Lagerleitung, Abteilungsleitung, Leitung, Team, Lesen); Nicht-Mitglied und fremde Abteilung 404. Was das Team sieht, steht in mitglieder.test.ts.
const status = (
  werte: Partial<Record<LagerPersona, number>>,
  grundlage: number,
): Record<LagerPersona, number> => ({
  abteilungsleitung: grundlage,
  lagerleitung: grundlage,
  leitung: grundlage,
  team: grundlage,
  lesen: grundlage,
  ohneMitgliedschaft: grundlage,
  fremdeAbteilung: grundlage,
  ohneLogin: 401,
  ...werte,
});
const lesen = status({ ohneMitgliedschaft: 404, fremdeAbteilung: 404 }, 200);

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/mitglieder": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/mitglieder`,
    erwartet: { aktiv: lesen, abgeschlossen: lesen },
  },
};
