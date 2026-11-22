import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L4b (#385): Zimmer und Zelte. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (einteilung.lesen): Lagerleitung, Abteilungsleitung, Leitung, Team und Lesen. Zimmer anlegen, ändern, löschen, einteilen, entfernen und die Auswahl der Nichteingeteilten (einteilung.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409 (die Auswahl ist lesend: dort 200). Nicht-Mitglied und fremde Abteilung 404.
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
// Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen haben das Recht nicht
const darfBearbeiten = (erfolg: number, geschlossen: number) => ({
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
      abteilungsleitung: geschlossen,
      lagerleitung: geschlossen,
      leitung: geschlossen,
    },
    403,
  ),
});
const bearbeiten = (erfolg: number) => darfBearbeiten(erfolg, 409);

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;
const UNBEKANNT = "00000000-0000-4000-8000-000000000000";

// Zeile direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuesZimmer(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.zimmer)
    .values({
      lagerId: w.lagerId(z),
      name: "Matrix-Zimmer",
      art: "zimmer",
      plaetze: 4,
      lagerSeq: 0,
    })
    .returning({ id: schema.zimmer.id });
  return zeile!.id;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/zimmer": {
    url: (w, z) => `${lagerPfad(w, z)}/zimmer`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/zimmer": {
    url: (w, z) => `${lagerPfad(w, z)}/zimmer`,
    body: () => ({ name: "Neues Zelt", art: "zelt", plaetze: 6 }),
    erwartet: bearbeiten(201),
  },
  "GET /api/v1/lager/:id/zimmer/offen": {
    url: (w, z) => `${lagerPfad(w, z)}/zimmer/offen`,
    erwartet: darfBearbeiten(200, 200),
  },
  "PATCH /api/v1/lager/:id/zimmer/:zimmerId": {
    url: async (w, z) => `${lagerPfad(w, z)}/zimmer/${await neuesZimmer(w, z)}`,
    body: () => ({ version: 1, plaetze: 5 }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/zimmer/:zimmerId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/zimmer/${await neuesZimmer(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
  "POST /api/v1/lager/:id/zimmer/:zimmerId/zuordnung": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/zimmer/${await neuesZimmer(w, z)}/zuordnung`,
    // Eine unbekannte ID: Wer einteilen darf, bekommt 404 (der Erfolg steht in zimmer.test.ts); die Rechte und der Schreibschutz greifen davor
    body: () => ({ teilnehmerIds: [UNBEKANNT] }),
    erwartet: {
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
    },
  },
  "POST /api/v1/lager/:id/zimmer/:zimmerId/zuordnung/entfernen": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/zimmer/${await neuesZimmer(w, z)}/zuordnung/entfernen`,
    body: () => ({ teilnehmerIds: [UNBEKANNT] }),
    erwartet: bearbeiten(200),
  },
};
