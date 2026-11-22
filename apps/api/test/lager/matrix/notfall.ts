import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5d (#393): Notfall. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Rechte (Standard): notfall.lesen Lagerleitung, Abteilungsleitung, Leitung, Team, Lesen; notfall.bearbeiten nur Lagerleitung und Abteilungsleitung. Nicht-Mitglied und fremde Abteilung 404; Recht 403 vor dem Schreibschutz 409.
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

const lesenAlle = (erfolg: number) => {
  const e = status(nichtMitglied, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
const nurBearbeiten = (erfolg: number) => ({
  aktiv: status(
    { ...nichtMitglied, abteilungsleitung: erfolg, lagerleitung: erfolg },
    403,
  ),
  abgeschlossen: status(
    { ...nichtMitglied, abteilungsleitung: 409, lagerleitung: 409 },
    403,
  ),
});

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/notfall`;

// Zeilen direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerKontakt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.notfallKontakt)
    .values({
      lagerId: w.lagerId(z),
      funktion: "Matrix",
      name: "Matrix Person",
      telefon: "079 123 45 67",
      lagerSeq: 0,
    })
    .returning({ id: schema.notfallKontakt.id });
  return `${pfad(w, z)}/kontakte/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/notfall": {
    url: (w, z) => pfad(w, z),
    erwartet: lesenAlle(200),
  },
  "PUT /api/v1/lager/:id/notfall/karte": {
    url: (w, z) => `${pfad(w, z)}/karte`,
    body: () => ({ kartenLink: null }),
    erwartet: nurBearbeiten(200),
  },
  "POST /api/v1/lager/:id/notfall/kontakte": {
    url: (w, z) => `${pfad(w, z)}/kontakte`,
    body: () => ({
      funktion: "Matrix",
      name: "Matrix Person",
      telefon: "079 123 45 67",
    }),
    erwartet: nurBearbeiten(201),
  },
  "PATCH /api/v1/lager/:id/notfall/kontakte/:kontaktId": {
    url: neuerKontakt,
    body: () => ({ version: 1, funktion: "Geändert" }),
    erwartet: nurBearbeiten(200),
  },
  "DELETE /api/v1/lager/:id/notfall/kontakte/:kontaktId": {
    url: async (w, z) => `${await neuerKontakt(w, z)}?version=1`,
    erwartet: nurBearbeiten(204),
  },
};
