import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeile von L1e (#375): Schnelleingabe. Literale Werte, nicht aus der Policy berechnet. Das Recht ist aufgaben.bearbeiten (Standard: Lagerleitung, Abteilungsleitung, Leitung); Team und Lesen bekommen 403, Nicht-Mitglied und fremde Abteilung 404. Die Route schreibt nichts, hängt aber am Schreibschutz wie jede POST-Route: im abgeschlossenen Lager antworten die Rollen mit dem Recht 409.
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
const verwalter = (erfolg: number) => ({
  abteilungsleitung: erfolg,
  lagerleitung: erfolg,
  leitung: erfolg,
});

export const ZEILEN: LagerMatrix = {
  "POST /api/v1/lager/:id/aufgaben/schnell": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/aufgaben/schnell`,
    body: () => ({ text: "Offerte morgen" }),
    erwartet: {
      aktiv: status(
        { ...nichtMitglied, ...verwalter(200), team: 403, lesen: 403 },
        403,
      ),
      abgeschlossen: status(
        { ...nichtMitglied, ...verwalter(409), team: 403, lesen: 403 },
        403,
      ),
    },
  },
};
