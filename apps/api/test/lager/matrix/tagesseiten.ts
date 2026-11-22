import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5b (#391): Tagesseiten mit Blöcken. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Rechte (Standard): tagesseiten.lesen haben Lagerleitung, Leitung und Lesen (die Abteilungsleitung gilt als Lagerleitung), das Team nicht (403). tagesseiten.bearbeiten haben nur Lagerleitung und Leitung. Schreiben: Wer das Recht nicht hat, bekommt 403 vor dem Schreibschutz; im abgeschlossenen Lager antworten die beiden mit dem Recht 409. Lesen im abgeschlossenen Lager geht (200). Nicht-Mitglied und fremde Abteilung 404.
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

const lesenErlaubt = {
  abteilungsleitung: 200,
  lagerleitung: 200,
  leitung: 200,
  lesen: 200,
};
const lesen = {
  aktiv: status({ ...nichtMitglied, ...lesenErlaubt }, 403),
  abgeschlossen: status({ ...nichtMitglied, ...lesenErlaubt }, 403),
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

const basis = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/tagesseiten`;

// Ein Datum ausserhalb des Zeitraums der anderen Matrix-Dateien (2030 bei zeitplan): je Aufruf ein anderes, weil es je Datum einen Tag gibt
let tage = 0;
const freiesDatum = () =>
  new Date(Date.UTC(2040, 0, 1 + tage++)).toISOString().slice(0, 10);

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerTag(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.lagertag)
    .values({ lagerId: w.lagerId(z), datum: freiesDatum(), lagerSeq: 0 })
    .returning({ id: schema.lagertag.id });
  return zeile!.id;
}
async function tagMitSeite(w: LagerWelt, z: LagerZustand) {
  const lagertagId = await neuerTag(w, z);
  const [seite] = await w.db
    .insert(schema.tagesseite)
    .values({ lagerId: w.lagerId(z), lagertagId, lagerSeq: 0 })
    .returning({ id: schema.tagesseite.id });
  return { lagertagId, seiteId: seite!.id };
}
async function neuerBlock(w: LagerWelt, z: LagerZustand) {
  const { lagertagId, seiteId } = await tagMitSeite(w, z);
  const [block] = await w.db
    .insert(schema.tagesseiteBlock)
    .values({
      lagerId: w.lagerId(z),
      seiteId,
      art: "wichtig",
      text: "Matrix-Block",
      lagerSeq: 0,
    })
    .returning({ id: schema.tagesseiteBlock.id });
  return `${basis(w, z)}/${lagertagId}/bloecke/${block!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/tagesseiten": {
    url: basis,
    erwartet: lesen,
  },
  "GET /api/v1/lager/:id/tagesseiten/:lagertagId": {
    url: async (w, z) => `${basis(w, z)}/${await neuerTag(w, z)}`,
    erwartet: lesen,
  },
  "POST /api/v1/lager/:id/tagesseiten/:lagertagId": {
    url: async (w, z) => `${basis(w, z)}/${await neuerTag(w, z)}`,
    body: () => ({ notiz: "Matrix" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/tagesseiten/:lagertagId": {
    url: async (w, z) =>
      `${basis(w, z)}/${(await tagMitSeite(w, z)).lagertagId}`,
    body: () => ({ version: 1, notiz: "Geändert" }),
    erwartet: schreiben(200),
  },
  "POST /api/v1/lager/:id/tagesseiten/:lagertagId/bloecke": {
    url: async (w, z) => `${basis(w, z)}/${await neuerTag(w, z)}/bloecke`,
    body: () => ({ art: "idee", text: "Eine Idee" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/tagesseiten/:lagertagId/bloecke/:blockId": {
    url: neuerBlock,
    body: () => ({ version: 1, text: "Umformuliert" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/tagesseiten/:lagertagId/bloecke/:blockId": {
    url: async (w, z) => `${await neuerBlock(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
