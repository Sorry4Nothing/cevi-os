import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1d (#374): Zeitplan mit Meilensteinen, Lagertagen, Tagesabschnitten und der Verschiebung. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Rechte (Standard): zeitplan.lesen haben alle vier Rollen (Team inklusive); zeitplan.bearbeiten nur Lagerleitung und Abteilungsleitung. Die Verschiebung braucht zusätzlich aufgaben.bearbeiten (beide haben es). Schreiben: Wer das Recht nicht hat, bekommt 403 vor dem Schreibschutz; im abgeschlossenen Lager antworten die beiden mit dem Recht 409. Lesen im abgeschlossenen Lager geht (200). Nicht-Mitglied und fremde Abteilung 404.
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

// Alle Rollen lesen den Zeitplan, auch das Team
const lesenAlle = {
  aktiv: status({ ...nichtMitglied }, 200),
  abgeschlossen: status({ ...nichtMitglied }, 200),
};
// Der Vorschlag ist eine Lesevorlage der Lagerleitung: Lesen, aber mit dem Recht zum Bearbeiten
const vorschlag = {
  aktiv: status(
    { ...nichtMitglied, abteilungsleitung: 200, lagerleitung: 200 },
    403,
  ),
  abgeschlossen: status(
    { ...nichtMitglied, abteilungsleitung: 200, lagerleitung: 200 },
    403,
  ),
};
const schreiben = (erfolg: number) => ({
  aktiv: status(
    { ...nichtMitglied, abteilungsleitung: erfolg, lagerleitung: erfolg },
    403,
  ),
  abgeschlossen: status(
    { ...nichtMitglied, abteilungsleitung: 409, lagerleitung: 409 },
    403,
  ),
});

const zeitplanPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/zeitplan`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerMeilenstein(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.meilenstein)
    .values({
      lagerId: w.lagerId(z),
      titel: "Matrix-Meilenstein",
      datum: "2027-05-01",
      lagerSeq: 0,
    })
    .returning({ id: schema.meilenstein.id });
  return `${zeitplanPfad(w, z)}/meilensteine/${zeile!.id}`;
}
let tagZaehler = 0;
// Ein Datum im Lager (10. bis 23. Juli 2027), je Aufruf ein anderes: je Datum gibt es einen Tag
const naechstesDatum = () =>
  `2027-07-${String(10 + (tagZaehler++ % 14)).padStart(2, "0")}`;
// Ein beliebiges Datum, nie zweimal: für Tage, die direkt entstehen (die Prüfung gegen den Lagerzeitraum gilt nur für die Route)
let zielTage = 0;
const freiesDatum = () =>
  new Date(Date.UTC(2030, 0, 1 + zielTage++)).toISOString().slice(0, 10);
async function neuerTag(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.lagertag)
    .values({
      lagerId: w.lagerId(z),
      datum: freiesDatum(),
      lagerSeq: 0,
    })
    .returning({ id: schema.lagertag.id });
  return `${zeitplanPfad(w, z)}/lagertage/${zeile!.id}`;
}
async function neuerAbschnitt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.tagesabschnitt)
    .values({
      lagerId: w.lagerId(z),
      name: `Matrix ${randomUUID().slice(0, 8)}`,
      lagerSeq: 0,
    })
    .returning({ id: schema.tagesabschnitt.id });
  return `${zeitplanPfad(w, z)}/tagesabschnitte/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/zeitplan": {
    url: zeitplanPfad,
    erwartet: lesenAlle,
  },
  "GET /api/v1/lager/:id/zeitplan/vorschlag": {
    url: (w, z) => `${zeitplanPfad(w, z)}/vorschlag`,
    erwartet: vorschlag,
  },
  "POST /api/v1/lager/:id/zeitplan/uebernehmen": {
    url: (w, z) => `${zeitplanPfad(w, z)}/uebernehmen`,
    // Ein Tag im Lager: Was es schon gibt, wird übersprungen, also 201 für jede Wiederholung
    body: () => ({ lagertage: [{ datum: "2027-07-24" }] }),
    erwartet: schreiben(201),
  },
  "POST /api/v1/lager/:id/zeitplan/meilensteine": {
    url: (w, z) => `${zeitplanPfad(w, z)}/meilensteine`,
    body: () => ({ titel: "Neuer Meilenstein", datum: "2027-05-01" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/zeitplan/meilensteine/:meilensteinId": {
    url: neuerMeilenstein,
    body: () => ({ version: 1, titel: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/zeitplan/meilensteine/:meilensteinId": {
    url: async (w, z) => `${await neuerMeilenstein(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "POST /api/v1/lager/:id/zeitplan/meilensteine/:meilensteinId/verschieben": {
    url: async (w, z) => `${await neuerMeilenstein(w, z)}/verschieben`,
    // Die Vorschau: Wer darf, bekommt sie (der Erfolg mit Schreiben steht in zeitplan.test.ts); sie ist ein POST und fällt darum im abgeschlossenen Lager unter den Schreibschutz
    body: () => ({ trocken: true, datum: "2027-05-08", version: 1 }),
    erwartet: schreiben(200),
  },
  "POST /api/v1/lager/:id/zeitplan/lagertage": {
    url: (w, z) => `${zeitplanPfad(w, z)}/lagertage`,
    body: () => ({ datum: naechstesDatum() }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/zeitplan/lagertage/:lagertagId": {
    url: neuerTag,
    body: () => ({ version: 1, label: "Anreise" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/zeitplan/lagertage/:lagertagId": {
    url: async (w, z) => `${await neuerTag(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "POST /api/v1/lager/:id/zeitplan/tagesabschnitte": {
    url: (w, z) => `${zeitplanPfad(w, z)}/tagesabschnitte`,
    body: () => ({ name: `Matrix ${randomUUID().slice(0, 8)}` }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/zeitplan/tagesabschnitte/:abschnittId": {
    url: neuerAbschnitt,
    body: () => ({ version: 1, zeit: "09:00" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/zeitplan/tagesabschnitte/:abschnittId": {
    url: async (w, z) => `${await neuerAbschnitt(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
