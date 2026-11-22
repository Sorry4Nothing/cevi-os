import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L4a (#384): Teilnehmende, Import und Abzählen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (teilnehmer.lesen): Lagerleitung, Abteilungsleitung, Leitung, Team und Lesen. Erfassen, ändern, löschen, importieren (teilnehmer.bearbeiten): nur Lagerleitung und Abteilungsleitung; Leitung, Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die beiden anderen 409. Abhaken und Zurücksetzen (abzaehlen.schreiben): Lagerleitung, Abteilungsleitung, Leitung und Team; Lesen 403. Nicht-Mitglied und fremde Abteilung 404.
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
// Nur Lagerleitung und Abteilungsleitung
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
// Lagerleitung, Abteilungsleitung, Leitung und Team
const abzaehlen = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
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

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Zeile direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerTeilnehmer(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.teilnehmer)
    .values({
      lagerId: w.lagerId(z),
      vorname: "Matrix",
      nachname: "Kind",
      stufe: "Wolf",
      lagerSeq: 0,
    })
    .returning({ id: schema.teilnehmer.id });
  return zeile!.id;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/teilnehmer": {
    url: (w, z) => `${lagerPfad(w, z)}/teilnehmer`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/teilnehmer": {
    url: (w, z) => `${lagerPfad(w, z)}/teilnehmer`,
    body: () => ({ vorname: "Neu", nachname: "Kind", stufe: "Biber" }),
    erwartet: bearbeiten(201),
  },
  "POST /api/v1/lager/:id/teilnehmer/import": {
    url: (w, z) => `${lagerPfad(w, z)}/teilnehmer/import`,
    // Vorschau: schreibt nichts; der Import selbst steht in teilnehmer.test.ts
    body: () => ({ text: "Import;Kind;Wolf", uebernehmen: false }),
    erwartet: bearbeiten(200),
  },
  "GET /api/v1/lager/:id/teilnehmer/:teilnehmerId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/teilnehmer/${await neuerTeilnehmer(w, z)}`,
    erwartet: lesen(200),
  },
  "PATCH /api/v1/lager/:id/teilnehmer/:teilnehmerId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/teilnehmer/${await neuerTeilnehmer(w, z)}`,
    body: () => ({ version: 1, stufe: "Pfadi" }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/teilnehmer/:teilnehmerId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/teilnehmer/${await neuerTeilnehmer(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
  "GET /api/v1/lager/:id/abzaehlen": {
    url: (w, z) => `${lagerPfad(w, z)}/abzaehlen`,
    erwartet: lesen(200),
  },
  "PUT /api/v1/lager/:id/abzaehlen": {
    url: (w, z) => `${lagerPfad(w, z)}/abzaehlen`,
    // Eine unbekannte ID: Wer abhaken darf, bekommt 404 (der Erfolg steht in teilnehmer.test.ts); die Rechte und der Schreibschutz greifen davor
    body: () => ({
      geprueft: true,
      teilnehmerIds: ["00000000-0000-4000-8000-000000000000"],
    }),
    erwartet: {
      aktiv: status(
        {
          ...nichtMitglied,
          abteilungsleitung: 404,
          lagerleitung: 404,
          leitung: 404,
          team: 404,
        },
        403,
      ),
      abgeschlossen: abzaehlen(200).abgeschlossen,
    },
  },
  "POST /api/v1/lager/:id/abzaehlen/zuruecksetzen": {
    url: (w, z) => `${lagerPfad(w, z)}/abzaehlen/zuruecksetzen`,
    body: () => ({ bestaetigt: true }),
    erwartet: abzaehlen(200),
  },
};
