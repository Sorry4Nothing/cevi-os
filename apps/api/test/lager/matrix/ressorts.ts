import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1a (#371): Ressorts, Links und Notizen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen: Lagerleitung, Abteilungsleitung, Leitung und Lesen (ressorts.lesen); Team hat das Recht im Standard nicht (403). Schreiben: nur Lagerleitung und Abteilungsleitung (ressorts.bearbeiten); Leitung, Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die beiden anderen 409. Nicht-Mitglied und fremde Abteilung 404.
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

const lesen = (erfolg: number) =>
  status(
    {
      ...nichtMitglied,
      team: 403,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
      leitung: erfolg,
      lesen: erfolg,
    },
    erfolg,
  );
const gleichLesen = (erfolg: number) => ({
  aktiv: lesen(erfolg),
  abgeschlossen: lesen(erfolg),
});
const schreiben = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
    },
    403,
  ),
  abgeschlossen: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 409,
      lagerleitung: 409,
    },
    403,
  ),
});

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Änderungen und Löschen es verbrauchen
async function neuesRessort(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.ressort)
    .values({
      lagerId: w.lagerId(z),
      kuerzel: `M${randomUUID().slice(0, 8)}`,
      name: "Matrix-Ressort",
      lagerSeq: 0,
    })
    .returning({ id: schema.ressort.id });
  return `${lagerPfad(w, z)}/ressorts/${zeile!.id}`;
}
async function neuerLink(w: LagerWelt, z: LagerZustand) {
  const ressort = await neuesRessort(w, z);
  const [zeile] = await w.db
    .insert(schema.ressortLink)
    .values({
      lagerId: w.lagerId(z),
      ressortId: ressort.split("/").pop()!,
      titel: "Matrix-Link",
      url: "https://example.org/matrix",
      lagerSeq: 0,
    })
    .returning({ id: schema.ressortLink.id });
  return `${ressort}/links/${zeile!.id}`;
}
async function neueNotiz(w: LagerWelt, z: LagerZustand) {
  const ressort = await neuesRessort(w, z);
  const [zeile] = await w.db
    .insert(schema.ressortNotiz)
    .values({
      lagerId: w.lagerId(z),
      ressortId: ressort.split("/").pop()!,
      text: "Matrix-Notiz",
      lagerSeq: 0,
    })
    .returning({ id: schema.ressortNotiz.id });
  return `${ressort}/notizen/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/ressorts": {
    url: (w, z) => `${lagerPfad(w, z)}/ressorts`,
    erwartet: gleichLesen(200),
  },
  "POST /api/v1/lager/:id/ressorts": {
    url: (w, z) => `${lagerPfad(w, z)}/ressorts`,
    body: () => ({ kuerzel: `M${randomUUID().slice(0, 8)}`, name: "Neu" }),
    erwartet: schreiben(201),
  },
  "PUT /api/v1/lager/:id/ressorts/reihenfolge": {
    url: (w, z) => `${lagerPfad(w, z)}/ressorts/reihenfolge`,
    // Ein unbekanntes Ressort: Wer schreiben darf, bekommt 404 (der Erfolg steht in ressorts.test.ts); die Rechte und der Schreibschutz greifen davor
    body: () => ({
      eintraege: [{ id: "00000000-0000-4000-8000-000000000000", version: 1 }],
    }),
    erwartet: {
      aktiv: status(
        {
          ...nichtMitglied,
          abteilungsleitung: 404,
          lagerleitung: 404,
        },
        403,
      ),
      abgeschlossen: schreiben(204).abgeschlossen,
    },
  },
  "GET /api/v1/lager/:id/ressorts/:ressortId": {
    url: neuesRessort,
    erwartet: gleichLesen(200),
  },
  "PATCH /api/v1/lager/:id/ressorts/:ressortId": {
    url: neuesRessort,
    body: () => ({ version: 1, name: "Umbenannt" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/ressorts/:ressortId": {
    url: async (w, z) => `${await neuesRessort(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "GET /api/v1/lager/:id/ressorts/:ressortId/links": {
    url: async (w, z) => `${await neuesRessort(w, z)}/links`,
    erwartet: gleichLesen(200),
  },
  "POST /api/v1/lager/:id/ressorts/:ressortId/links": {
    url: async (w, z) => `${await neuesRessort(w, z)}/links`,
    body: () => ({ titel: "Link", url: "https://example.org/neu" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/ressorts/:ressortId/links/:linkId": {
    url: neuerLink,
    body: () => ({ version: 1, titel: "Anders" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/ressorts/:ressortId/links/:linkId": {
    url: async (w, z) => `${await neuerLink(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
  "GET /api/v1/lager/:id/ressorts/:ressortId/notizen": {
    url: async (w, z) => `${await neuesRessort(w, z)}/notizen`,
    erwartet: gleichLesen(200),
  },
  "POST /api/v1/lager/:id/ressorts/:ressortId/notizen": {
    url: async (w, z) => `${await neuesRessort(w, z)}/notizen`,
    body: () => ({ text: "Neue Notiz" }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/ressorts/:ressortId/notizen/:notizId": {
    url: neueNotiz,
    body: () => ({ version: 1, text: "Anders" }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/ressorts/:ressortId/notizen/:notizId": {
    url: async (w, z) => `${await neueNotiz(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
