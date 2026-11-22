import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5d (#393): Packliste. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Rechte (Standard): packliste.lesen Lagerleitung, Abteilungsleitung, Leitung, Team, Lesen; packliste.abhaken Lagerleitung, Abteilungsleitung, Leitung, Team (nicht Lesen); packliste.bearbeiten nur Lagerleitung und Abteilungsleitung. Nicht-Mitglied und fremde Abteilung 404; Recht 403 vor dem Schreibschutz 409.
// Die eigene Kopie und die eigenen Punkte gehören einer Person: Die Zeile gehört hier einem Wegwerf-Konto, also treffen PATCH und DELETE auf einen eigenen Punkt für jede Persona mit dem Recht auf eine fremde Zeile (404). Erfolge stehen in lagerinfos.test.ts.
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

// Alle Mitglieder
const lesenAlle = (erfolg: number) => {
  const e = status(nichtMitglied, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
// packliste.bearbeiten: nur Lagerleitung und Abteilungsleitung
const nurBearbeiten = (erfolg: number, abgeschlossen = 409) => ({
  aktiv: status(
    { ...nichtMitglied, abteilungsleitung: erfolg, lagerleitung: erfolg },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: abgeschlossen,
      lagerleitung: abgeschlossen,
    },
    403,
  ),
});
// packliste.abhaken: alle ausser Lesen
const abhaken = (erfolg: number) => ({
  aktiv: status({ ...nichtMitglied, lesen: 403 }, erfolg),
  abgeschlossen: status({ ...nichtMitglied, lesen: 403 }, 409),
});

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/packliste`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerPunkt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.packlistePunkt)
    .values({
      lagerId: w.lagerId(z),
      abschnitt: "Matrix",
      text: "Matrix-Punkt",
      lagerSeq: 0,
    })
    .returning({ id: schema.packlistePunkt.id });
  return `${pfad(w, z)}/punkte/${zeile!.id}`;
}
// Ein eigener Punkt eines Wegwerf-Kontos: Keine Persona ist seine Besitzerin
async function neuerEigener(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.packlisteEigen)
    .values({
      lagerId: w.lagerId(z),
      personId: await w.wegwerfPersonId(),
      abschnitt: "Matrix",
      text: "Matrix-Punkt",
    })
    .returning({ id: schema.packlisteEigen.id });
  return `${pfad(w, z)}/eigene/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/packliste": {
    url: (w, z) => pfad(w, z),
    erwartet: lesenAlle(200),
  },
  "POST /api/v1/lager/:id/packliste/punkte": {
    url: (w, z) => `${pfad(w, z)}/punkte`,
    body: () => ({ abschnitt: "Matrix", text: "Neuer Punkt" }),
    erwartet: nurBearbeiten(201),
  },
  "PATCH /api/v1/lager/:id/packliste/punkte/:punktId": {
    url: neuerPunkt,
    body: () => ({ version: 1, text: "Geändert" }),
    erwartet: nurBearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/packliste/punkte/:punktId": {
    url: async (w, z) => `${await neuerPunkt(w, z)}?version=1`,
    erwartet: nurBearbeiten(204),
  },
  "PUT /api/v1/lager/:id/packliste/punkte/:punktId/zustand": {
    url: async (w, z) => `${await neuerPunkt(w, z)}/zustand`,
    body: () => ({ zustand: "abgehakt" }),
    erwartet: abhaken(200),
  },
  "POST /api/v1/lager/:id/packliste/eigene": {
    url: (w, z) => `${pfad(w, z)}/eigene`,
    body: () => ({ abschnitt: "Matrix", text: randomUUID() }),
    erwartet: abhaken(201),
  },
  "PATCH /api/v1/lager/:id/packliste/eigene/:eigenId": {
    url: neuerEigener,
    body: () => ({ abgehakt: true }),
    erwartet: abhaken(404),
  },
  "DELETE /api/v1/lager/:id/packliste/eigene/:eigenId": {
    url: neuerEigener,
    erwartet: abhaken(404),
  },
};
