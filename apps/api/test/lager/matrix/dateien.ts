import { randomUUID } from "node:crypto";
import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von L0g (#370): Dateien im Lager als Verknüpfung. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
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
const nichtMitglied = { ohneMitgliedschaft: 404, fremdeAbteilung: 404 };

// Anlegen und Löschen: Lagerleitung, Abteilungsleitung und Leitung (Standardrecht pinnwand.bearbeiten) kommen durch, Team und Lesen bekommen 403 (vor dem Schreibschutz), Nicht-Mitglieder und die fremde Abteilung 404
const verwalten = (erfolg: number) =>
  status(
    {
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      leitung: erfolg,
      ...nichtMitglied,
    },
    403,
  );
const verwaltenZu = status(
  { abteilungsleitung: 409, lagerleitung: 409, leitung: 409, ...nichtMitglied },
  403,
);

// Lesen eines Eintrags ohne Verweis: Jede Person sieht ihn nur selbst (404, auch für die Lagerleitung); Anfragen in der Matrix kommen von verschiedenen Personen, darum die UUID eines unbekannten Eintrags
const unbekannt = status({}, 404);

export const ZEILEN: LagerMatrix = {
  "POST /api/v1/lager/:id/dateien": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/dateien`,
    body: () => ({
      anzeigename: "Lagerplan",
      link: "https://cevi.sharepoint.com/sites/lager/Plan.pdf",
    }),
    erwartet: { aktiv: verwalten(201), abgeschlossen: verwaltenZu },
  },
  "GET /api/v1/lager/:id/dateien/:dateiId": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/dateien/${randomUUID()}`,
    erwartet: { aktiv: unbekannt, abgeschlossen: unbekannt },
  },
  "DELETE /api/v1/lager/:id/dateien/:dateiId": {
    url: (w, z) =>
      `/api/v1/lager/${w.lagerId(z)}/dateien/${randomUUID()}?version=1`,
    erwartet: {
      // Das Recht (403) kommt vor dem Eintrag (404)
      aktiv: status({ team: 403, lesen: 403 }, 404),
      abgeschlossen: verwaltenZu,
    },
  },
  "GET /api/v1/admin/lager-dateien/hosts": {
    url: () => "/api/v1/admin/lager-dateien/hosts",
    erwartet: {
      aktiv: status({ abteilungsleitung: 200 }, 403),
      abgeschlossen: status({ abteilungsleitung: 200 }, 403),
    },
  },
  "PUT /api/v1/admin/lager-dateien/hosts": {
    url: () => "/api/v1/admin/lager-dateien/hosts",
    body: () => ({ hosts: null }),
    erwartet: {
      aktiv: status({ abteilungsleitung: 204 }, 403),
      abgeschlossen: status({ abteilungsleitung: 204 }, 403),
    },
  },
};
