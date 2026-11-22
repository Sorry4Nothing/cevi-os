import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1c (#373): Aufgaben-Details. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Standard der Rechte wie bei den Aufgaben (matrix/aufgaben.ts): Lagerleitung, Abteilungsleitung und Leitung lesen und bearbeiten alles; Lesen liest, schreibt nichts (403); Team hat nur aufgaben.eigene: Die Matrix-Aufgabe gehört niemandem, also 404 beim Lesen und beim Abhaken, 403 bei allem anderen. Der Verlauf braucht verlauf.lesen: Das hat das Team nicht (403). Duplikate lesen nur Rollen mit aufgaben.bearbeiten. Im abgeschlossenen Lager antwortet jede Rolle mit dem Recht 409, die anderen bleiben bei 403 (das Recht kommt vor dem Schreibschutz). Nicht-Mitglied und fremde Abteilung 404.
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

// Wie lesen der Aufgabe: die Aufgabe gehört niemandem, das Team sieht sie nicht
const lesenEinzeln = {
  aktiv: status({ ...nichtMitglied, team: 404 }, 200),
  abgeschlossen: status({ ...nichtMitglied, team: 404 }, 200),
};
const nurBearbeiter = {
  aktiv: status({ ...nichtMitglied, team: 403, lesen: 403 }, 200),
  abgeschlossen: status({ ...nichtMitglied, team: 403, lesen: 403 }, 200),
};
const verlauf = {
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
// Wie schreiben, aber ein unbekanntes Ziel: Wer schreiben darf, bekommt 404 (der Erfolg steht in aufgaben-details.test.ts)
const schreibenUnbekannt = {
  aktiv: status(
    { ...nichtMitglied, ...fuerVerwalter(404), team: 403, lesen: 403 },
    403,
  ),
  abgeschlossen: schreiben(204).abgeschlossen,
};

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
async function neuerCheckpunkt(w: LagerWelt, z: LagerZustand) {
  const aufgabe = await neueAufgabe(w, z);
  const [zeile] = await w.db
    .insert(schema.aufgabeCheckpunkt)
    .values({
      lagerId: w.lagerId(z),
      aufgabeId: aufgabe.split("/").pop()!,
      text: "Matrix-Punkt",
      lagerSeq: 0,
    })
    .returning({ id: schema.aufgabeCheckpunkt.id });
  return `${aufgabe}/checkliste/${zeile!.id}`;
}
async function neuerLink(w: LagerWelt, z: LagerZustand) {
  const aufgabe = await neueAufgabe(w, z);
  const [zeile] = await w.db
    .insert(schema.aufgabeLink)
    .values({
      lagerId: w.lagerId(z),
      aufgabeId: aufgabe.split("/").pop()!,
      titel: "Plan",
      url: "https://beispiel.example.org/plan",
      lagerSeq: 0,
    })
    .returning({ id: schema.aufgabeLink.id });
  return `${aufgabe}/links/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/aufgaben/duplikate": {
    url: (w, z) => `${lagerPfad(w, z)}/aufgaben/duplikate`,
    erwartet: nurBearbeiter,
  },
  "GET /api/v1/lager/:id/aufgaben/:aufgabeId/details": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/details`,
    erwartet: lesenEinzeln,
  },
  "GET /api/v1/lager/:id/aufgaben/:aufgabeId/verlauf": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/verlauf`,
    erwartet: verlauf,
  },
  "POST /api/v1/lager/:id/aufgaben/:aufgabeId/checkliste": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/checkliste`,
    body: () => ({ text: "Neuer Punkt" }),
    erwartet: schreiben(201),
  },
  "PUT /api/v1/lager/:id/aufgaben/:aufgabeId/checkliste/reihenfolge": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/checkliste/reihenfolge`,
    body: () => ({
      eintraege: [{ id: "00000000-0000-4000-8000-000000000000", version: 1 }],
    }),
    erwartet: schreibenUnbekannt,
  },
  "PATCH /api/v1/lager/:id/aufgaben/:aufgabeId/checkliste/:checkpunktId": {
    url: neuerCheckpunkt,
    body: () => ({ version: 1, erledigt: true }),
    // Wie der Status der Aufgabe: Das Team hat das Recht (eigene), die Aufgabe ist aber nicht seine: 404; im abgeschlossenen Lager zuerst 409. Lesen hat weder bearbeiten noch eigene: 403
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
  "DELETE /api/v1/lager/:id/aufgaben/:aufgabeId/checkliste/:checkpunktId": {
    url: async (w, z) => `${await neuerCheckpunkt(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "POST /api/v1/lager/:id/aufgaben/:aufgabeId/links": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/links`,
    body: () => ({ titel: "Plan", url: "https://beispiel.example.org/plan" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/aufgaben/:aufgabeId/links/:linkId": {
    url: neuerLink,
    body: () => ({ version: 1, titel: "Neuer Titel" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/aufgaben/:aufgabeId/links/:linkId": {
    url: async (w, z) => `${await neuerLink(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "PUT /api/v1/lager/:id/aufgaben/:aufgabeId/stichworte": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/stichworte`,
    body: () => ({ version: 1, stichworte: ["material"] }),
    erwartet: schreiben(200),
  },
  "POST /api/v1/lager/:id/aufgaben/:aufgabeId/zusammenfuehren": {
    url: async (w, z) => `${await neueAufgabe(w, z)}/zusammenfuehren`,
    // Eine unbekannte zweite Aufgabe: Wer schreiben darf, bekommt 404 (der Erfolg steht in aufgaben-details.test.ts)
    body: () => ({
      version: 1,
      mitId: "00000000-0000-4000-8000-000000000000",
      mitVersion: 1,
    }),
    erwartet: schreibenUnbekannt,
  },
};
