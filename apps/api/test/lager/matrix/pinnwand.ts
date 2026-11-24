import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L3a (#381): Pinnwand. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen: jede Rolle mit pinnwand.lesen (Lagerleitung, Abteilungsleitung, Leitung, Team, Lesen). Schreiben: pinnwand.bearbeiten (Standard: Lagerleitung, Abteilungsleitung, Leitung); Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Nicht-Mitglied und fremde Abteilung 404.
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

const gleichLesen = (erfolg: number) => ({
  aktiv: status(nichtMitglied, erfolg),
  abgeschlossen: status(nichtMitglied, erfolg),
});
const schreiben = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      leitung: erfolg,
      team: 403,
      lesen: 403,
    },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 409,
      lagerleitung: 409,
      leitung: 409,
      team: 403,
      lesen: 403,
    },
    403,
  ),
});

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Änderungen und Löschen es verbrauchen
async function neuerBeitrag(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.pinnwandBeitrag)
    .values({ lagerId: w.lagerId(z), titel: "Matrix-Beitrag", lagerSeq: 0 })
    .returning({ id: schema.pinnwandBeitrag.id });
  return `${lagerPfad(w, z)}/pinnwand/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/pinnwand": {
    url: (w, z) => `${lagerPfad(w, z)}/pinnwand`,
    erwartet: gleichLesen(200),
  },
  "POST /api/v1/lager/:id/pinnwand": {
    url: (w, z) => `${lagerPfad(w, z)}/pinnwand`,
    body: () => ({ titel: "Mitteilung", text: "Text" }),
    erwartet: schreiben(201),
  },
  "GET /api/v1/lager/:id/pinnwand/:beitragId": {
    url: neuerBeitrag,
    erwartet: gleichLesen(200),
  },
  // «Gesehen» (#520): pinnwand.lesen, auch im abgeschlossenen Lager (nur die eigene Zeile)
  "PUT /api/v1/lager/:id/pinnwand/gesehen": {
    url: (w, z) => `${lagerPfad(w, z)}/pinnwand/gesehen`,
    body: async (z, w) => {
      const [zeile] = await w.db
        .insert(schema.pinnwandBeitrag)
        .values({ lagerId: w.lagerId(z), titel: "Matrix-Beitrag", lagerSeq: 0 })
        .returning({ id: schema.pinnwandBeitrag.id });
      return { beitragIds: [zeile!.id] };
    },
    erwartet: gleichLesen(204),
    auchGeschlossen: true,
  },
  "PUT /api/v1/lager/:id/pinnwand/:beitragId/gesehen": {
    url: async (w, z) => `${await neuerBeitrag(w, z)}/gesehen`,
    erwartet: gleichLesen(204),
    auchGeschlossen: true,
  },
  "PATCH /api/v1/lager/:id/pinnwand/:beitragId": {
    url: neuerBeitrag,
    body: () => ({ version: 1, titel: "Anders" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/pinnwand/:beitragId": {
    url: async (w, z) => `${await neuerBeitrag(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
