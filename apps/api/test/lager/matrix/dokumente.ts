import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L6a (#396): Dokumente. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen: Lagerleitung, Abteilungsleitung, Leitung und Lesen (dokumente.lesen_alle) sehen alle Dokumente; das Team (dokumente.team_lesen) nur die freigegebenen. Die Ziele der Zeilen sind freigegeben, damit auch das Team 200 bekommt; ein nicht freigegebenes Dokument ist für das Team 404 (dokumente.test.ts). Schreiben (dokumente.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Nicht-Mitglied und fremde Abteilung 404.
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
const schreiben = (erfolg: number) => ({
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

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Änderungen und Löschen es verbrauchen
async function neueDatei(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.lagerDatei)
    .values({
      lagerId: w.lagerId(z),
      anzeigename: "Matrix.pdf",
      link: "https://cevi.sharepoint.com/sites/lager/Matrix.pdf",
      lagerSeq: 0,
    })
    .returning({ id: schema.lagerDatei.id });
  return zeile!.id;
}
async function neuesDokument(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.dokument)
    .values({
      lagerId: w.lagerId(z),
      titel: "Matrix-Dokument",
      dateiId: await neueDatei(w, z),
      teamSichtbar: true,
      lagerSeq: 0,
    })
    .returning({ id: schema.dokument.id });
  return `${lagerPfad(w, z)}/dokumente/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/dokumente": {
    url: (w, z) => `${lagerPfad(w, z)}/dokumente`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/dokumente": {
    url: (w, z) => `${lagerPfad(w, z)}/dokumente`,
    // Die Datei kommt aus der Datenbank (die Matrix legt sie je Anfrage neu an); der Body ist ein Wert pro Aufruf
    body: () => ({
      titel: "Neu",
      dateiId: "00000000-0000-4000-8000-000000000000",
    }),
    // Mit unbekannter Datei: Wer schreiben darf, bekommt 400 (der Erfolg steht in dokumente.test.ts); Recht und Schreibschutz greifen davor
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
      abgeschlossen: schreiben(201).abgeschlossen,
    },
  },
  "GET /api/v1/lager/:id/dokumente/:dokumentId": {
    url: neuesDokument,
    erwartet: lesen(200),
  },
  "PATCH /api/v1/lager/:id/dokumente/:dokumentId": {
    url: neuesDokument,
    body: () => ({ version: 1, titel: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/dokumente/:dokumentId": {
    url: async (w, z) => `${await neuesDokument(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
