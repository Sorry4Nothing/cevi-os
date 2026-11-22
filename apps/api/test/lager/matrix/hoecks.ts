import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L2a (#378): Höcks, Traktanden, Anwesenheit, Höck-Modus, Entscheide und die Kalenderdatei. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Standard der Rechte: Lagerleitung, Abteilungsleitung und Leitung lesen und bearbeiten alle Höcks; Lesen liest alle, schreibt nichts (403); das Team hat nur hoecks.team_lesen: Es liest die Liste (nur Team-Höcks), einen Höck der Lagerleitung gibt es für das Team nicht (404, auch als Kalenderdatei), Höck-Modus, Entscheide, wartende Punkte und jede Änderung sind 403. Das Ziel der Matrix ist ein Höck der Art «lagerleitung». Im abgeschlossenen Lager antwortet jede Rolle mit dem Recht 409 auf eine Änderung, die anderen bleiben bei 403 (das Recht kommt vor dem Schreibschutz). Nicht-Mitglied und fremde Abteilung 404.
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
const verwalter = ["abteilungsleitung", "lagerleitung", "leitung"] as const;
const fuerVerwalter = (erfolg: number) =>
  Object.fromEntries(verwalter.map((p) => [p, erfolg]));

// Alle lesen: auch das Team (Liste mit Team-Höcks)
const lesenAlleRollen = {
  aktiv: status({ ...nichtMitglied }, 200),
  abgeschlossen: status({ ...nichtMitglied }, 200),
};
// Der Höck der Matrix gehört der Lagerleitung: Das Team sieht ihn nicht
const lesenEinzeln = {
  aktiv: status({ ...nichtMitglied, team: 404 }, 200),
  abgeschlossen: status({ ...nichtMitglied, team: 404 }, 200),
};
// Nur mit hoecks.lesen_alle: das Team nicht
const lesenNurAlle = {
  aktiv: status({ ...nichtMitglied, team: 403 }, 200),
  abgeschlossen: status({ ...nichtMitglied, team: 403 }, 200),
};
const schreiben = (erfolg: number) => ({
  aktiv: status(
    { ...nichtMitglied, ...fuerVerwalter(erfolg), team: 403, lesen: 403 },
    403,
  ),
  abgeschlossen: status(
    { ...nichtMitglied, ...fuerVerwalter(409), team: 403, lesen: 403 },
    403,
  ),
});

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Änderungen und Löschen es verbrauchen
async function neuerHoeck(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.hoeck)
    .values({
      lagerId: w.lagerId(z),
      art: "lagerleitung",
      datum: "2027-06-01",
      titel: `Matrix-Höck ${randomUUID().slice(0, 8)}`,
      lagerSeq: 0,
    })
    .returning({ id: schema.hoeck.id });
  return `${lagerPfad(w, z)}/hoecks/${zeile!.id}`;
}
async function neuesTraktandum(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.traktandum)
    .values({
      lagerId: w.lagerId(z),
      titel: `Matrix-Traktandum ${randomUUID().slice(0, 8)}`,
      lagerSeq: 0,
    })
    .returning({ id: schema.traktandum.id });
  return `${lagerPfad(w, z)}/traktanden/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/hoecks": {
    url: (w, z) => `${lagerPfad(w, z)}/hoecks`,
    erwartet: lesenAlleRollen,
  },
  "POST /api/v1/lager/:id/hoecks": {
    url: (w, z) => `${lagerPfad(w, z)}/hoecks`,
    body: () => ({ titel: "Neuer Höck", art: "team", datum: "2027-06-15" }),
    erwartet: schreiben(201),
  },
  "GET /api/v1/lager/:id/hoecks/:hoeckId": {
    url: neuerHoeck,
    erwartet: lesenEinzeln,
  },
  "PATCH /api/v1/lager/:id/hoecks/:hoeckId": {
    url: neuerHoeck,
    body: () => ({ version: 1, titel: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/hoecks/:hoeckId": {
    url: async (w, z) => `${await neuerHoeck(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "GET /api/v1/lager/:id/hoecks/:hoeckId.ics": {
    url: async (w, z) => `${await neuerHoeck(w, z)}.ics`,
    erwartet: lesenEinzeln,
  },
  "GET /api/v1/lager/:id/hoecks/:hoeckId/modus": {
    url: async (w, z) => `${await neuerHoeck(w, z)}/modus`,
    erwartet: lesenNurAlle,
  },
  "PUT /api/v1/lager/:id/hoecks/:hoeckId/anwesende/:personId": {
    url: async (w, z) =>
      `${await neuerHoeck(w, z)}/anwesende/${await w.wegwerfMitgliedId(w.lagerId(z))}`,
    erwartet: schreiben(204),
  },
  "DELETE /api/v1/lager/:id/hoecks/:hoeckId/anwesende/:personId": {
    url: async (w, z) =>
      `${await neuerHoeck(w, z)}/anwesende/${await w.wegwerfMitgliedId(w.lagerId(z))}`,
    erwartet: schreiben(204),
  },
  "POST /api/v1/lager/:id/hoecks/:hoeckId/traktanden/uebernehmen": {
    url: async (w, z) => `${await neuerHoeck(w, z)}/traktanden/uebernehmen`,
    body: () => ({}),
    erwartet: schreiben(200),
  },
  "GET /api/v1/lager/:id/traktanden/naechster": {
    url: (w, z) => `${lagerPfad(w, z)}/traktanden/naechster`,
    erwartet: lesenNurAlle,
  },
  "PUT /api/v1/lager/:id/traktanden/reihenfolge": {
    url: (w, z) => `${lagerPfad(w, z)}/traktanden/reihenfolge`,
    // Ein unbekanntes Traktandum: Wer schreiben darf, bekommt 404 (der Erfolg steht in hoecks.test.ts); Recht und Schreibschutz greifen davor
    body: () => ({
      hoeckId: null,
      eintraege: [{ id: "00000000-0000-4000-8000-000000000000", version: 1 }],
    }),
    erwartet: {
      aktiv: status(
        {
          ...nichtMitglied,
          ...fuerVerwalter(404),
          team: 403,
          lesen: 403,
        },
        403,
      ),
      abgeschlossen: schreiben(204).abgeschlossen,
    },
  },
  "POST /api/v1/lager/:id/traktanden": {
    url: (w, z) => `${lagerPfad(w, z)}/traktanden`,
    body: () => ({ titel: "Neues Traktandum" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/traktanden/:traktandumId": {
    url: neuesTraktandum,
    body: () => ({ version: 1, titel: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/traktanden/:traktandumId": {
    url: async (w, z) => `${await neuesTraktandum(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "GET /api/v1/lager/:id/entscheide": {
    url: (w, z) => `${lagerPfad(w, z)}/entscheide`,
    erwartet: lesenNurAlle,
  },
};
