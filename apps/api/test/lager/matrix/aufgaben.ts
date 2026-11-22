import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1b (#372): Aufgaben. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Standard der Rechte: Lagerleitung, Abteilungsleitung und Leitung lesen und bearbeiten alle Aufgaben; Lesen liest alle, schreibt nichts (403); Team hat nur aufgaben.eigene: Es liest die Liste (leer oder nur Eigenes), die Aufgabe einer anderen Person ist für es unbekannt (404), anlegen, ändern, löschen und sortieren darf es nicht (403). Den Status setzt es nur bei einer eigenen Aufgabe; die Matrix-Aufgabe gehört niemandem, also 404. Im abgeschlossenen Lager antwortet jede Rolle mit dem Recht 409, die anderen bleiben bei 403 (das Recht kommt vor dem Schreibschutz). Nicht-Mitglied und fremde Abteilung 404.
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

const lesen = {
  aktiv: status({ ...nichtMitglied }, 200),
  abgeschlossen: status({ ...nichtMitglied }, 200),
};
// Wie lesen, aber die Aufgabe gehört niemandem: das Team sieht sie nicht
const lesenEinzeln = {
  aktiv: status({ ...nichtMitglied, team: 404 }, 200),
  abgeschlossen: status({ ...nichtMitglied, team: 404 }, 200),
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
async function neueAufgabe(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.aufgabe)
    .values({
      lagerId: w.lagerId(z),
      titel: `Matrix-Aufgabe ${randomUUID().slice(0, 8)}`,
      lagerSeq: 0,
    })
    .returning({ id: schema.aufgabe.id });
  return `${lagerPfad(w, z)}/aufgaben/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/aufgaben": {
    url: (w, z) => `${lagerPfad(w, z)}/aufgaben`,
    erwartet: lesen,
  },
  "POST /api/v1/lager/:id/aufgaben": {
    url: (w, z) => `${lagerPfad(w, z)}/aufgaben`,
    body: () => ({ titel: "Neue Aufgabe" }),
    erwartet: schreiben(201),
  },
  "PUT /api/v1/lager/:id/aufgaben/reihenfolge": {
    url: (w, z) => `${lagerPfad(w, z)}/aufgaben/reihenfolge`,
    // Eine unbekannte Aufgabe: Wer schreiben darf, bekommt 404 (der Erfolg steht in aufgaben.test.ts); Recht und Schreibschutz greifen davor
    body: () => ({
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
  "GET /api/v1/lager/:id/aufgaben/:aufgabeId": {
    url: neueAufgabe,
    erwartet: lesenEinzeln,
  },
  "PATCH /api/v1/lager/:id/aufgaben/:aufgabeId": {
    url: neueAufgabe,
    body: () => ({ version: 1, titel: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "PUT /api/v1/lager/:id/aufgaben/:aufgabeId/status": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/status`,
    body: () => ({ version: 1, status: "laeuft" }),
    // Team hat das Recht (eigene), die Aufgabe ist aber nicht seine: 404; im abgeschlossenen Lager zuerst 409. Lesen hat weder bearbeiten noch eigene: 403
    erwartet: {
      aktiv: status(
        { ...nichtMitglied, ...fuerVerwalter(200), team: 404, lesen: 403 },
        403,
      ),
      abgeschlossen: status(
        { ...nichtMitglied, ...fuerVerwalter(409), team: 409, lesen: 403 },
        403,
      ),
    },
  },
  "DELETE /api/v1/lager/:id/aufgaben/:aufgabeId": {
    url: async (w, z) => `${await neueAufgabe(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
