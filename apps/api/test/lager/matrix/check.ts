import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1g (#377): Lager-Check. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Rechte (Standard): check.lesen Lagerleitung, Abteilungsleitung, Leitung und Lesen (nicht das Team); die eigenen Punkte ändern zeitplan.bearbeiten (nur Lagerleitung und Abteilungsleitung) und check.lesen. Nicht-Mitglied und fremde Abteilung 404; Recht 403 vor dem Schreibschutz 409.
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

const lesen = (erfolg: number) => {
  const e = status(
    {
      ...nichtMitglied,
      leitung: erfolg,
      lesen: erfolg,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
    },
    403,
  );
  return { aktiv: e, abgeschlossen: e };
};
const bearbeiten = (erfolg: number) => ({
  aktiv: status(
    { ...nichtMitglied, abteilungsleitung: erfolg, lagerleitung: erfolg },
    403,
  ),
  abgeschlossen: status(
    { ...nichtMitglied, abteilungsleitung: 409, lagerleitung: 409 },
    403,
  ),
});

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/check`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerPunkt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.lagerCheckPunkt)
    .values({ lagerId: w.lagerId(z), titel: "Matrix-Punkt", lagerSeq: 0 })
    .returning({ id: schema.lagerCheckPunkt.id });
  return `${pfad(w, z)}/punkte/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/check": {
    url: (w, z) => pfad(w, z),
    erwartet: lesen(200),
  },
  "GET /api/v1/lager/:id/check/punkte": {
    url: (w, z) => `${pfad(w, z)}/punkte`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/check/punkte": {
    url: (w, z) => `${pfad(w, z)}/punkte`,
    body: () => ({ titel: "Versicherung geklärt" }),
    erwartet: bearbeiten(201),
  },
  "PATCH /api/v1/lager/:id/check/punkte/:punktId": {
    url: neuerPunkt,
    body: () => ({ version: 1, erledigt: true }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/check/punkte/:punktId": {
    url: async (w, z) => `${await neuerPunkt(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
};
