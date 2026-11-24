import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L3b (#382): Umfragen und Reaktionen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Anlegen, ändern, löschen: pinnwand.bearbeiten (Standard: Lagerleitung, Abteilungsleitung, Leitung); Team und Lesen 403. Abstimmen und reagieren: interaktion.schreiben (Standard: Lagerleitung, Abteilungsleitung, Leitung, Team); Lesen 403. Im abgeschlossenen Lager antworten die Berechtigten mit 409, wer das Recht nicht hat, mit 403. Nicht-Mitglied und fremde Abteilung 404.
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

const verwalten = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      leitung: erfolg,
      team: 403,
      lesen: 403,
    },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 409,
      lagerleitung: 409,
      leitung: 409,
      team: 403,
      lesen: 403,
    },
    403,
  ),
});
const interagieren = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      leitung: erfolg,
      team: erfolg,
      lesen: 403,
    },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 409,
      lagerleitung: 409,
      leitung: 409,
      team: 409,
      lesen: 403,
    },
    403,
  ),
});

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Anlegen, Ändern und Löschen es verbrauchen
async function neuerBeitrag(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.pinnwandBeitrag)
    .values({ lagerId: w.lagerId(z), titel: "Matrix-Frage", lagerSeq: 0 })
    .returning({ id: schema.pinnwandBeitrag.id });
  return zeile!.id;
}
async function neueUmfrage(w: LagerWelt, z: LagerZustand, optionId?: string) {
  const lagerId = w.lagerId(z);
  const beitragId = await neuerBeitrag(w, z);
  const [u] = await w.db
    .insert(schema.umfrage)
    .values({ lagerId, beitragId, lagerSeq: 0 })
    .returning({ id: schema.umfrage.id });
  await w.db.insert(schema.umfrageOption).values(
    ["Ja", "Nein"].map((text, i) => ({
      id: i === 0 ? optionId : undefined,
      lagerId,
      umfrageId: u!.id,
      text,
      reihenfolge: i,
      lagerSeq: 0,
    })),
  );
  return `${lagerPfad(w, z)}/pinnwand/${beitragId}/umfrage`;
}

// Der Body einer Stimme kennt die Welt nicht und braucht eine Antwort-ID: Je Zustand gibt es darum eine Umfrage mit fester Antwort-ID, die beim ersten Aufruf entsteht. Stimme setzen und zurückziehen sind idempotent und verbrauchen sie nicht
const OPTION_ID: Record<LagerZustand, string> = {
  aktiv: randomUUID(),
  abgeschlossen: randomUUID(),
};
const angelegt = new Map<LagerZustand, string>();
async function festeUmfrage(w: LagerWelt, z: LagerZustand) {
  let url = angelegt.get(z);
  if (!url) {
    url = await neueUmfrage(w, z, OPTION_ID[z]);
    angelegt.set(z, url);
  }
  return url;
}

export const ZEILEN: LagerMatrix = {
  "POST /api/v1/lager/:id/pinnwand/:beitragId/umfrage": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/pinnwand/${await neuerBeitrag(w, z)}/umfrage`,
    body: () => ({ optionen: ["Ja", "Nein"] }),
    erwartet: verwalten(201),
  },
  "PATCH /api/v1/lager/:id/pinnwand/:beitragId/umfrage": {
    url: (w, z) => neueUmfrage(w, z),
    body: () => ({ version: 1, geschlossen: true }),
    erwartet: verwalten(200),
  },
  "DELETE /api/v1/lager/:id/pinnwand/:beitragId/umfrage": {
    url: async (w, z) => `${await neueUmfrage(w, z)}?version=1`,
    erwartet: verwalten(204),
  },
  "PUT /api/v1/lager/:id/pinnwand/:beitragId/umfrage/stimme": {
    url: async (w, z) => `${await festeUmfrage(w, z)}/stimme`,
    body: (z) => ({ optionIds: [OPTION_ID[z]] }),
    erwartet: interagieren(200),
  },
  "DELETE /api/v1/lager/:id/pinnwand/:beitragId/umfrage/stimme": {
    url: async (w, z) => `${await festeUmfrage(w, z)}/stimme`,
    erwartet: interagieren(204),
  },
  "PUT /api/v1/lager/:id/reaktionen/:zielTyp/:zielId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/reaktionen/pinnwand_beitrag/${await neuerBeitrag(w, z)}`,
    body: () => ({ emoji: "herz" }),
    erwartet: interagieren(200),
  },
  "DELETE /api/v1/lager/:id/reaktionen/:zielTyp/:zielId": {
    url: async (w, z) =>
      `${lagerPfad(w, z)}/reaktionen/pinnwand_beitrag/${await neuerBeitrag(w, z)}`,
    erwartet: interagieren(204),
  },
};
