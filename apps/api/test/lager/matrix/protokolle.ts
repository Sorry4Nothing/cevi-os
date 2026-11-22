import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L2b (#379): Protokolle (Verknüpfung auf eine Datei) und Beschlüsse. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (protokolle.lesen): Lagerleitung, Abteilungsleitung, Leitung und Lesen; das Team hat das Recht im Standard nicht und bekommt 403. Schreiben (protokolle.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Nicht-Mitglied und fremde Abteilung 404. Die Sicht auf Protokolle der Lagerleitung testet protokolle.test.ts.
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
  const zeile = status({ ...nichtMitglied, team: 403 }, erfolg);
  return { aktiv: zeile, abgeschlossen: zeile };
};
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
async function neuesProtokoll(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.protokoll)
    .values({
      lagerId: w.lagerId(z),
      art: "notiz",
      titel: "Matrix-Protokoll",
      datum: "2027-07-12",
      dateiId: await neueDatei(w, z),
      lagerSeq: 0,
    })
    .returning({ id: schema.protokoll.id });
  return `${lagerPfad(w, z)}/protokolle/${zeile!.id}`;
}
async function neuerBeschluss(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.beschluss)
    .values({ lagerId: w.lagerId(z), text: "Matrix-Beschluss", lagerSeq: 0 })
    .returning({ id: schema.beschluss.id });
  return `${lagerPfad(w, z)}/beschluesse/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/protokolle": {
    url: (w, z) => `${lagerPfad(w, z)}/protokolle`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/protokolle": {
    url: (w, z) => `${lagerPfad(w, z)}/protokolle`,
    // Die Datei kommt aus der Datenbank; mit unbekannter Datei bekommt, wer schreiben darf, 400 (der Erfolg steht in protokolle.test.ts); Recht und Schreibschutz greifen davor
    body: () => ({
      art: "notiz",
      titel: "Neu",
      datum: "2027-07-12",
      dateiId: "00000000-0000-4000-8000-000000000000",
    }),
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
  "GET /api/v1/lager/:id/protokolle/:protokollId": {
    url: neuesProtokoll,
    erwartet: lesen(200),
  },
  "PATCH /api/v1/lager/:id/protokolle/:protokollId": {
    url: neuesProtokoll,
    body: () => ({ version: 1, titel: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/protokolle/:protokollId": {
    url: async (w, z) => `${await neuesProtokoll(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "GET /api/v1/lager/:id/beschluesse": {
    url: (w, z) => `${lagerPfad(w, z)}/beschluesse`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/beschluesse": {
    url: (w, z) => `${lagerPfad(w, z)}/beschluesse`,
    body: () => ({ text: "Neuer Beschluss" }),
    erwartet: schreiben(201),
  },
  "GET /api/v1/lager/:id/beschluesse/:beschlussId": {
    url: neuerBeschluss,
    erwartet: lesen(200),
  },
  "PATCH /api/v1/lager/:id/beschluesse/:beschlussId": {
    url: neuerBeschluss,
    body: () => ({ version: 1, text: "Geändert" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/beschluesse/:beschlussId": {
    url: async (w, z) => `${await neuerBeschluss(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
