import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L4e (#388): Dienste, Schichtplan und Vorschlag. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (einteilung.lesen): Lagerleitung, Abteilungsleitung, Leitung, Team und Lesen. Dienste anlegen, ändern, löschen, besetzen und der Vorschlag (einteilung.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Der Vorschlag mit uebernehmen=false ist eine Vorschau, hat aber dasselbe Recht und denselben Schreibschutz. Nicht-Mitglied und fremde Abteilung 404.
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

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt frische Ziele (Version 1), weil Ändern und Löschen sie verbrauchen
async function neuerAbschnitt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.tagesabschnitt)
    .values({
      lagerId: w.lagerId(z),
      name: `Matrix ${randomUUID().slice(0, 8)}`,
      lagerSeq: 0,
    })
    .returning({ id: schema.tagesabschnitt.id });
  return zeile!.id;
}
async function neuerDienst(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.dienst)
    .values({
      lagerId: w.lagerId(z),
      name: "Matrix-Dienst",
      tagesabschnittId: await neuerAbschnitt(w, z),
      lagerSeq: 0,
    })
    .returning({ id: schema.dienst.id });
  return zeile!.id;
}
let tage = 0;
async function neuerTag(w: LagerWelt, z: LagerZustand) {
  // Je Anfrage ein eigenes Datum: Es gibt einen Tag je Datum und Lager
  const datum = new Date(Date.UTC(2030, 0, 1 + tage++))
    .toISOString()
    .slice(0, 10);
  const [zeile] = await w.db
    .insert(schema.lagertag)
    .values({ lagerId: w.lagerId(z), datum, lagerSeq: 0 })
    .returning({ id: schema.lagertag.id });
  return zeile!.id;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/schichtplan": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/schichtplan/dienste": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan/dienste`,
    body: async (z, w) => ({
      name: "Küche",
      tagesabschnittId: await neuerAbschnitt(w, z),
    }),
    erwartet: bearbeiten(201),
  },
  "PATCH /api/v1/lager/:id/schichtplan/dienste/:dienstId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/schichtplan/dienste/${await neuerDienst(w, z)}`,
    body: () => ({ version: 1, name: "Umbenannt" }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/schichtplan/dienste/:dienstId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/schichtplan/dienste/${await neuerDienst(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
  "PUT /api/v1/lager/:id/schichtplan/schichten": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan/schichten`,
    // Ein leerer Dienst bleibt leer: schreibt nichts, der Erfolg mit Leuten steht in schichtplan.test.ts
    body: async (z, w) => ({
      lagertagId: await neuerTag(w, z),
      dienstId: await neuerDienst(w, z),
    }),
    erwartet: bearbeiten(200),
  },
  "POST /api/v1/lager/:id/schichtplan/vorschlag": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan/vorschlag`,
    // Vorschau: schreibt nichts; das Übernehmen steht in schichtplan.test.ts
    body: () => ({ uebernehmen: false, seed: 1 }),
    erwartet: bearbeiten(200),
  },
};
