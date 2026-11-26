import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5f (#395): Aggregate «Heute», «Meine Woche» und Start. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Rechte (Standard): Heute und Meine Woche lesen alle vier Rollen (jeder hat mindestens einen Teil, den er lesen darf); im abgeschlossenen Lager geht Lesen weiter. Der Start ist der Lagerleitung (auch der Abteilungsleitung) und der Leitung vorbehalten: Team und Lesen bekommen 403. Nicht-Mitglied und fremde Abteilung 404.
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

const pfad = (teil: string) => (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/${teil}`;

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/heute": {
    url: pfad("heute"),
    erwartet: {
      aktiv: status({ ...nichtMitglied }, 200),
      abgeschlossen: status({ ...nichtMitglied }, 200),
    },
  },
  "GET /api/v1/lager/:id/meine-woche": {
    url: pfad("meine-woche"),
    erwartet: {
      aktiv: status({ ...nichtMitglied }, 200),
      abgeschlossen: status({ ...nichtMitglied }, 200),
    },
  },
  // Widget-Stand (#848): jedes Mitglied, auch im abgeschlossenen Lager (Tage und Glocke gehören jeder Rolle)
  "GET /api/v1/lager/:id/widget": {
    url: pfad("widget"),
    erwartet: {
      aktiv: status({ ...nichtMitglied }, 200),
      abgeschlossen: status({ ...nichtMitglied }, 200),
    },
  },
  "GET /api/v1/lager/:id/start": {
    url: pfad("start"),
    erwartet: {
      aktiv: status({ ...nichtMitglied, team: 403, lesen: 403 }, 200),
      abgeschlossen: status({ ...nichtMitglied, team: 403, lesen: 403 }, 200),
    },
  },
};
