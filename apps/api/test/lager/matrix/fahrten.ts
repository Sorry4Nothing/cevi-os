import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L4c (#386): Fahrten und Mitfahrende. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (einteilung.lesen): Lagerleitung, Abteilungsleitung, Leitung, Team und Lesen; das Team sieht nur die eigene Fahrt (eine fremde Fahrt ist für das Team 404, «Personen ohne Fahrt» 403). Schreiben (einteilung.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Nicht-Mitglied und fremde Abteilung 404.
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

const lesen = (erfolg: number) => ({
  aktiv: status(nichtMitglied, erfolg),
  abgeschlossen: status(nichtMitglied, erfolg),
});
// Das Team sieht die Zeile nicht, die die Anfrage anlegt: Fremde Fahrt gleich 404, «ohne Fahrt» 403
const lesenOhneTeam = (erfolg: number, team: number) => ({
  aktiv: status({ ...nichtMitglied, team }, erfolg),
  abgeschlossen: status({ ...nichtMitglied, team }, erfolg),
});
// Lagerleitung, Abteilungsleitung und Leitung
const bearbeiten = (erfolg: number) => ({
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

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Zeile direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neueFahrt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.fahrt)
    .values({
      lagerId: w.lagerId(z),
      richtung: "hin",
      art: "oev",
      name: "Matrix",
      lagerSeq: 0,
    })
    .returning({ id: schema.fahrt.id });
  return zeile!.id;
}
async function neueMitfahrt(w: LagerWelt, z: LagerZustand) {
  const fahrtId = await neueFahrt(w, z);
  const personId = await w.wegwerfMitgliedId(w.lagerId(z));
  const [zeile] = await w.db
    .insert(schema.fahrtMitfahrer)
    .values({
      lagerId: w.lagerId(z),
      fahrtId,
      richtung: "hin",
      personId,
      lagerSeq: 0,
    })
    .returning({ id: schema.fahrtMitfahrer.id });
  return `${fahrtId}/mitfahrer/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/fahrten": {
    url: (w, z) => `${lagerPfad(w, z)}/fahrten`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/fahrten": {
    url: (w, z) => `${lagerPfad(w, z)}/fahrten`,
    body: () => ({ richtung: "hin", art: "oev", name: "Matrix-Gruppe" }),
    erwartet: bearbeiten(201),
  },
  "GET /api/v1/lager/:id/fahrten/ohne": {
    url: (w, z) => `${lagerPfad(w, z)}/fahrten/ohne?richtung=hin`,
    erwartet: lesenOhneTeam(200, 403),
  },
  "GET /api/v1/lager/:id/fahrten/:fahrtId": {
    url: async (w, z) => `${lagerPfad(w, z)}/fahrten/${await neueFahrt(w, z)}`,
    erwartet: lesenOhneTeam(200, 404),
  },
  "PATCH /api/v1/lager/:id/fahrten/:fahrtId": {
    url: async (w, z) => `${lagerPfad(w, z)}/fahrten/${await neueFahrt(w, z)}`,
    body: () => ({ version: 1, name: "Neu" }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/fahrten/:fahrtId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/fahrten/${await neueFahrt(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
  "POST /api/v1/lager/:id/fahrten/:fahrtId/mitfahrer": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/fahrten/${await neueFahrt(w, z)}/mitfahrer`,
    // Eine unbekannte Person: Wer schreiben darf, bekommt 400 (der Erfolg steht in fahrten.test.ts); die Rechte und der Schreibschutz greifen davor
    body: () => ({ personId: "00000000-0000-4000-8000-000000000000" }),
    erwartet: {
      aktiv: status(
        {
          ...nichtMitglied,
          abteilungsleitung: 400,
          lagerleitung: 400,
          leitung: 400,
        },
        403,
      ),
      abgeschlossen: bearbeiten(0).abgeschlossen,
    },
  },
  "DELETE /api/v1/lager/:id/fahrten/:fahrtId/mitfahrer/:mitfahrerId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/fahrten/${await neueMitfahrt(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
};
