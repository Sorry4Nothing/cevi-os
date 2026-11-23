import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von L0b (#365): Rechte der Rollen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet. Die Bodys ändern nichts am Wert (Standard bleibt Standard), damit die Personas nacheinander dasselbe Lager treffen
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
const gleich = (e: Record<LagerPersona, number>) => ({
  aktiv: e,
  abgeschlossen: e,
});

// Lager-Route: Lagerleitung und Abteilungsleitung kommen durch, Leitung, Team und Lesen bekommen 403 (vor dem Schreibschutz), Nicht-Mitglieder und die fremde Abteilung 404
const leitung = (erfolg: number) =>
  status(
    {
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      ohneMitgliedschaft: 404,
      fremdeAbteilung: 404,
    },
    403,
  );
// Verwaltungsroute: nur die Abteilungsleitung, die fremde Abteilung 404, alle anderen 403
const admin = (erfolg: number) =>
  status({ abteilungsleitung: erfolg, fremdeAbteilung: 404 }, 403);

const body = () => ({
  rechte: [{ rolle: "team", recht: "wetter.lesen", erlaubt: true }],
});

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/rechte": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/rechte`,
    erwartet: gleich(leitung(200)),
  },
  "PUT /api/v1/lager/:id/rechte": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/rechte`,
    body,
    erwartet: {
      aktiv: leitung(204),
      abgeschlossen: status(
        {
          abteilungsleitung: 409,
          lagerleitung: 409,
          ohneMitgliedschaft: 404,
          fremdeAbteilung: 404,
        },
        403,
      ),
    },
  },
  "POST /api/v1/lager/:id/rechte/zuruecksetzen": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/rechte/zuruecksetzen`,
    erwartet: {
      aktiv: leitung(204),
      abgeschlossen: status(
        {
          abteilungsleitung: 409,
          lagerleitung: 409,
          ohneMitgliedschaft: 404,
          fremdeAbteilung: 404,
        },
        403,
      ),
    },
  },
  "GET /api/v1/admin/lager/:id/rechte": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}/rechte`,
    erwartet: gleich(admin(200)),
  },
  "PUT /api/v1/admin/lager/:id/rechte": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}/rechte`,
    body,
    erwartet: { aktiv: admin(204), abgeschlossen: admin(409) },
  },
  "POST /api/v1/admin/lager/:id/rechte/zuruecksetzen": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}/rechte/zuruecksetzen`,
    erwartet: { aktiv: admin(204), abgeschlossen: admin(409) },
  },
};
