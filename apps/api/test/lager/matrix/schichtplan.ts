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

const UNBEKANNT = "00000000-0000-4000-8000-000000000000";

// Wer ändern darf, bekommt für eine unbekannte ID 404 (der Erfolg steht in schichtplan.test.ts): Die Matrix legt keine Lagertage und Abschnitte an, sie zählen gegen die Grenzen und die Daten der Zeitplan-Zeilen im selben Lager
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

// Ein Dienst direkt in der Datenbank: Jede Anfrage bekommt einen frischen (Version 1), weil Ändern und Löschen ihn verbrauchen. Alle Dienste eines Lagers hängen an einem Abschnitt (einer je Lager), damit die Grenze der Abschnitte nicht erreicht wird
const matrixAbschnitt = new Map<string, string>();
async function neuerDienst(w: LagerWelt, z: LagerZustand) {
  const lagerId = w.lagerId(z);
  let abschnittId = matrixAbschnitt.get(lagerId);
  if (!abschnittId) {
    const [abschnitt] = await w.db
      .insert(schema.tagesabschnitt)
      .values({
        lagerId,
        name: `Matrix ${randomUUID().slice(0, 8)}`,
        lagerSeq: 0,
      })
      .returning({ id: schema.tagesabschnitt.id });
    abschnittId = abschnitt!.id;
    matrixAbschnitt.set(lagerId, abschnittId);
  }
  const [zeile] = await w.db
    .insert(schema.dienst)
    .values({
      lagerId,
      name: `Matrix-Dienst ${randomUUID().slice(0, 8)}`,
      tagesabschnittId: abschnittId,
      lagerSeq: 0,
    })
    .returning({ id: schema.dienst.id });
  return zeile!.id;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/schichtplan": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan`,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/schichtplan/dienste": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan/dienste`,
    body: () => ({ name: "Küche", tagesabschnittId: UNBEKANNT }),
    erwartet: unbekannteId(),
  },
  "PATCH /api/v1/lager/:id/schichtplan/dienste/:dienstId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/schichtplan/dienste/${await neuerDienst(w, z)}`,
    body: () => ({ version: 1, name: `Umbenannt ${randomUUID().slice(0, 8)}` }),
    erwartet: bearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/schichtplan/dienste/:dienstId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/schichtplan/dienste/${await neuerDienst(w, z)}?version=1`,
    erwartet: bearbeiten(204),
  },
  "PUT /api/v1/lager/:id/schichtplan/schichten": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan/schichten`,
    body: () => ({ lagertagId: UNBEKANNT, dienstId: UNBEKANNT }),
    erwartet: unbekannteId(),
  },
  "POST /api/v1/lager/:id/schichtplan/vorschlag": {
    url: (w, z) => `${lagerPfad(w, z)}/schichtplan/vorschlag`,
    // Vorschau: schreibt nichts; das Übernehmen steht in schichtplan.test.ts
    body: () => ({ uebernehmen: false, seed: 1 }),
    erwartet: bearbeiten(200),
  },
};
