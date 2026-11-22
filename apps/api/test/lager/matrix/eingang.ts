import * as schema from "../../../src/db/schema.js";
import { neuerRueckfragecode } from "../../../src/lager/eingang.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L3c (#383): Eingang. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Senden und eigene Meldungen lesen: eingang.senden (Standard: Lagerleitung, Abteilungsleitung, Leitung, Team); Lesen 403. Alles andere (alle lesen, antworten, zuordnen, löschen): nur Lagerleitung und Abteilungsleitung, die übrigen 403 vor dem Schreibschutz; im abgeschlossenen Lager 409 für Schreibende. Der Rückfragecode gilt auch im abgeschlossenen Lager (auchGeschlossen). Nicht-Mitglied und fremde Abteilung 404.
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

// Rollen mit eingang.senden im Standard
const sendende = (erfolg: number) => ({
  ...nichtMitglied,
  abteilungsleitung: erfolg,
  lagerleitung: erfolg,
  leitung: erfolg,
  team: erfolg,
  lesen: 403,
});
// Nur die Lagerleitung (und die Abteilungsleitung)
const nurLagerleitung = (erfolg: number) => ({
  ...nichtMitglied,
  abteilungsleitung: erfolg,
  lagerleitung: erfolg,
  leitung: 403,
  team: 403,
  lesen: 403,
});

const sendenLesend = (erfolg: number) => ({
  aktiv: status(sendende(erfolg), 403),
  abgeschlossen: status(sendende(erfolg), 403),
});
const sendenSchreibend = (erfolg: number) => ({
  aktiv: status(sendende(erfolg), 403),
  abgeschlossen: status(sendende(409), 403),
});
const leitungLesend = (erfolg: number) => ({
  aktiv: status(nurLagerleitung(erfolg), 403),
  abgeschlossen: status(nurLagerleitung(erfolg), 403),
});
const leitungSchreibend = (erfolg: number) => ({
  aktiv: status(nurLagerleitung(erfolg), 403),
  abgeschlossen: status(nurLagerleitung(409), 403),
});

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Änderungen und Löschen es verbrauchen
async function neueMeldung(w: LagerWelt, z: LagerZustand) {
  const { hash } = neuerRueckfragecode();
  const [zeile] = await w.db
    .insert(schema.eingang)
    .values({
      lagerId: w.lagerId(z),
      art: "idee",
      text: "Matrix-Meldung",
      anonym: true,
      rueckfragecodeHash: hash,
    })
    .returning({ id: schema.eingang.id });
  return `${lagerPfad(w, z)}/eingang/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "POST /api/v1/lager/:id/eingang": {
    url: (w, z) => `${lagerPfad(w, z)}/eingang`,
    body: () => ({ art: "idee", text: "Eine Idee", anonym: false }),
    erwartet: sendenSchreibend(201),
  },
  "GET /api/v1/lager/:id/eingang/eigene": {
    url: (w, z) => `${lagerPfad(w, z)}/eingang/eigene`,
    erwartet: sendenLesend(200),
  },
  "POST /api/v1/lager/:id/eingang/status": {
    url: (w, z) => `${lagerPfad(w, z)}/eingang/status`,
    body: async (z, w) => {
      const { code, hash } = neuerRueckfragecode();
      await w.db.insert(schema.eingang).values({
        lagerId: w.lagerId(z),
        art: "frage",
        text: "Matrix-Frage",
        anonym: true,
        rueckfragecodeHash: hash,
      });
      return { code };
    },
    auchGeschlossen: true,
    erwartet: sendenLesend(200),
  },
  "GET /api/v1/lager/:id/eingang": {
    url: (w, z) => `${lagerPfad(w, z)}/eingang`,
    erwartet: leitungLesend(200),
  },
  "GET /api/v1/lager/:id/eingang/:eingangId": {
    url: neueMeldung,
    erwartet: leitungLesend(200),
  },
  "PATCH /api/v1/lager/:id/eingang/:eingangId": {
    url: neueMeldung,
    body: () => ({ version: 1, status: "in_arbeit" }),
    erwartet: leitungSchreibend(200),
  },
  "POST /api/v1/lager/:id/eingang/:eingangId/traktandum": {
    url: async (w, z) => `${await neueMeldung(w, z)}/traktandum`,
    body: () => ({ version: 1, titel: "Aus dem Eingang" }),
    erwartet: leitungSchreibend(201),
  },
  // Zurücknehmen (#521): eine Meldung ohne Traktandum, der Aufruf tut nichts (204); den Erfolg mit Traktandum zeigt eingang.test.ts
  "DELETE /api/v1/lager/:id/eingang/:eingangId/traktandum": {
    url: async (w, z) => `${await neueMeldung(w, z)}/traktandum?version=1`,
    erwartet: leitungSchreibend(204),
  },
  "DELETE /api/v1/lager/:id/eingang/:eingangId": {
    url: async (w, z) => `${await neueMeldung(w, z)}?version=1`,
    erwartet: leitungSchreibend(204),
  },
};
