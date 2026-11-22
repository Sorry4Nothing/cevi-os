import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von L0f (#369): Benachrichtigungen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet
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

// Die eigene Glocke kennt keine Rolle: Jedes Mitglied, auch «lesen», liest und leert sie; wer nicht Mitglied ist oder zu einer anderen Abteilung gehört, bekommt 404
const mitglied = (erfolg: number) =>
  gleich(status({ ohneMitgliedschaft: 404, fremdeAbteilung: 404 }, erfolg));

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/benachrichtigungen": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/benachrichtigungen`,
    erwartet: mitglied(200),
  },
  "GET /api/v1/lager/:id/benachrichtigungen/ungelesen": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/benachrichtigungen/ungelesen`,
    erwartet: mitglied(200),
  },
  "POST /api/v1/lager/:id/benachrichtigungen/gelesen": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/benachrichtigungen/gelesen`,
    body: () => ({}),
    // Auch im abgeschlossenen Lager: Die Glocke leeren ändert keine Lagerdaten
    auchGeschlossen: true,
    erwartet: mitglied(204),
  },
  // Ein Ziel, für das niemand benachrichtigt wurde: für jede Persona dasselbe 404, auch für die Lagerleitung
  "GET /api/v1/lager/aufloesen/:typ/:id": {
    url: () =>
      "/api/v1/lager/aufloesen/lager_aufgabe/00000000-0000-4000-8000-000000000000",
    erwartet: gleich(status({}, 404)),
  },
  "GET /api/v1/ich/lager-benachrichtigungen": {
    erwartet: gleich(status({}, 200)),
  },
  "PUT /api/v1/ich/lager-benachrichtigungen": {
    body: () => ({ arten: [{ art: "frist", aktiv: true }] }),
    erwartet: gleich(status({}, 204)),
  },
};
