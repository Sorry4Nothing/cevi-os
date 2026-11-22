import { randomUUID } from "node:crypto";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L4f (#389): Diensttausch. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Rechte (Standard): diensttausch.anfragen Lagerleitung, Abteilungsleitung, Leitung und Team; diensttausch.entscheiden Lagerleitung, Abteilungsleitung und Leitung. Nicht-Mitglied und fremde Abteilung 404; Recht 403 vor dem Schreibschutz 409.
// Die Abteilungsleitung ist kein Mitglied: Anfragen stellt sie nicht (403 KEIN_MITGLIED, im abgeschlossenen Lager greift davor der Schreibschutz 409). Erfolge, die einen Stand brauchen (Anfrage stellen, entscheiden, zurückziehen), stehen in diensttausch.test.ts: Hier trifft jede Anfrage eine unbekannte Schicht oder Tauschanfrage (404).
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

// diensttausch.entscheiden lesen (Lagerleitung, Abteilungsleitung, Leitung)
const alleLesen = (erfolg: number) => {
  const e = status({ ...nichtMitglied, team: 403, lesen: 403 }, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
// diensttausch.anfragen lesen (Lagerleitung, Abteilungsleitung, Leitung, Team)
const eigeneLesen = (erfolg: number) => {
  const e = status({ ...nichtMitglied, lesen: 403 }, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
// Schreiben mit diensttausch.anfragen; der Handler fragt die Mitgliedschaft (Abteilungsleitung 403)
const anfragenSchreiben = (erfolg: number, abteilungsleitung: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung,
      lagerleitung: erfolg,
      leitung: erfolg,
      team: erfolg,
    },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 409,
      lagerleitung: 409,
      leitung: 409,
      team: 409,
    },
    403,
  ),
});
// Schreiben mit diensttausch.entscheiden
const entscheidenSchreiben = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      leitung: erfolg,
    },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 409,
      lagerleitung: 409,
      leitung: 409,
    },
    403,
  ),
});

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/diensttausch`;

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/diensttausch": {
    url: (w, z) => pfad(w, z),
    erwartet: alleLesen(200),
  },
  "GET /api/v1/lager/:id/diensttausch/eigene": {
    url: (w, z) => `${pfad(w, z)}/eigene`,
    erwartet: eigeneLesen(200),
  },
  "POST /api/v1/lager/:id/diensttausch": {
    url: (w, z) => pfad(w, z),
    body: () => ({ schichtId: randomUUID() }),
    erwartet: anfragenSchreiben(404, 403),
  },
  "POST /api/v1/lager/:id/diensttausch/:tauschId/entscheid": {
    url: (w, z) => `${pfad(w, z)}/${randomUUID()}/entscheid`,
    body: () => ({ entscheid: "abgelehnt", version: 1 }),
    erwartet: entscheidenSchreiben(404),
  },
  "POST /api/v1/lager/:id/diensttausch/:tauschId/zurueckziehen": {
    url: (w, z) => `${pfad(w, z)}/${randomUUID()}/zurueckziehen`,
    body: () => ({ version: 1 }),
    erwartet: anfragenSchreiben(404, 404),
  },
};
