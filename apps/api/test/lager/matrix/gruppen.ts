import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L4d (#387): Programmgruppen, Zuordnen, «nicht dabei» und Mischen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (einteilung.lesen): Lagerleitung, Abteilungsleitung, Leitung, Team und Lesen. Ändern (einteilung.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Das Mischen mit uebernehmen=false ist eine Vorschau, hat aber dasselbe Recht und denselben Schreibschutz. Nicht-Mitglied und fremde Abteilung 404.
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

// Zeile direkt in die Datenbank: Jede Anfrage bekommt eine frische Gruppe (Version 1), weil Ändern und Löschen sie verbrauchen
async function neueGruppe(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.gruppe)
    .values({ lagerId: w.lagerId(z), name: "Matrix", lagerSeq: 0 })
    .returning({ id: schema.gruppe.id });
  return zeile!.id;
}

const unbekannt = "00000000-0000-4000-8000-000000000000";
// Wer ändern darf, bekommt für eine unbekannte ID 404 (der Erfolg steht in gruppen.test.ts); die Rechte und der Schreibschutz greifen davor
const unbekannteId = () => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 404,
      lagerleitung: 404,
      leitung: 404,
    },
    403,
  ),
  abgeschlossen: bearbeiten(200).abgeschlossen,
});

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/gruppen": {
    url: (w, z) => `${lagerPfad(w, z)}/gruppen`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/gruppen": {
    url: (w, z) => `${lagerPfad(w, z)}/gruppen`,
    body: () => ({ name: "Neue Gruppe" }),
    erwartet: bearbeiten(201),
  },
  "POST /api/v1/lager/:id/gruppen/mischen": {
    url: (w, z) => `${lagerPfad(w, z)}/gruppen/mischen`,
    // Vorschau: schreibt nichts; das Übernehmen steht in gruppen.test.ts
    body: () => ({ anzahl: 2, uebernehmen: false, seed: 1 }),
    erwartet: bearbeiten(200),
  },
  "PUT /api/v1/lager/:id/gruppen/zuordnung": {
    url: (w, z) => `${lagerPfad(w, z)}/gruppen/zuordnung`,
    body: () => ({ gruppeId: null, teilnehmerIds: [unbekannt] }),
    erwartet: unbekannteId(),
  },
  "PUT /api/v1/lager/:id/gruppen/abgewaehlt": {
    url: (w, z) => `${lagerPfad(w, z)}/gruppen/abgewaehlt`,
    body: () => ({ abgewaehlt: true, teilnehmerIds: [unbekannt] }),
    erwartet: unbekannteId(),
  },
  "PATCH /api/v1/lager/:id/gruppen/:gruppeId": {
    url: async (w, z) => `${lagerPfad(w, z)}/gruppen/${await neueGruppe(w, z)}`,
    body: () => ({ version: 1, name: "Umbenannt" }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/gruppen/:gruppeId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/gruppen/${await neueGruppe(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
};
