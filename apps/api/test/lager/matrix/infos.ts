import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5d (#393): Infos. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Rechte (Standard): infos.lesen Lagerleitung, Abteilungsleitung, Leitung, Team, Lesen; infos.bearbeiten nur Lagerleitung und Abteilungsleitung. Nicht-Mitglied und fremde Abteilung 404; Recht 403 vor dem Schreibschutz 409. Abschnitte mit nur_lagerleitung und das Merkmal «notfall» stehen in lagerinfos.test.ts.
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

const lesenAlle = (erfolg: number) => {
  const e = status(nichtMitglied, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
const nurBearbeiten = (erfolg: number) => ({
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
  `/api/v1/lager/${w.lagerId(z)}/infos`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerAbschnitt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.infoAbschnitt)
    .values({ lagerId: w.lagerId(z), titel: "Matrix-Abschnitt", lagerSeq: 0 })
    .returning({ id: schema.infoAbschnitt.id });
  return `${pfad(w, z)}/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/infos": {
    url: (w, z) => pfad(w, z),
    erwartet: lesenAlle(200),
  },
  "POST /api/v1/lager/:id/infos": {
    url: (w, z) => pfad(w, z),
    body: () => ({ titel: "Neuer Abschnitt" }),
    erwartet: nurBearbeiten(201),
  },
  "PUT /api/v1/lager/:id/infos/reihenfolge": {
    url: (w, z) => `${pfad(w, z)}/reihenfolge`,
    // Eine unbekannte ID: Wer das Recht hat, erreicht den Handler (404)
    body: () => ({ eintraege: [{ id: randomUUID(), version: 1 }] }),
    erwartet: {
      aktiv: status(
        { ...nichtMitglied, abteilungsleitung: 404, lagerleitung: 404 },
        403,
      ),
      abgeschlossen: nurBearbeiten(404).abgeschlossen,
    },
  },
  "GET /api/v1/lager/:id/infos/:abschnittId": {
    url: neuerAbschnitt,
    erwartet: lesenAlle(200),
  },
  "PATCH /api/v1/lager/:id/infos/:abschnittId": {
    url: neuerAbschnitt,
    body: () => ({ version: 1, titel: "Geändert" }),
    erwartet: nurBearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/infos/:abschnittId": {
    url: async (w, z) => `${await neuerAbschnitt(w, z)}?version=1`,
    erwartet: nurBearbeiten(204),
  },
};
