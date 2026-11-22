import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L6b (#397): Adressbuch. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (adressbuch.lesen) und Schreiben (adressbuch.bearbeiten) hat im Standard nur die Lagerleitung, die Abteilungsleitung gilt als solche: Leitung, Team und Lesen bekommen 403. Im abgeschlossenen Lager lesen die beiden weiter, Schreiben gibt 409 (nach dem Recht, 403 vor 409). Nicht-Mitglied und fremde Abteilung 404.
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

const fuerLeitung = (erfolg: number, geschlossen = erfolg) => ({
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
      abteilungsleitung: geschlossen,
      lagerleitung: geschlossen,
    },
    403,
  ),
});

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;

// Zeile direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Änderungen und Löschen es verbrauchen
async function neuerKontakt(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.adressbuchKontakt)
    .values({ lagerId: w.lagerId(z), name: "Matrix-Kontakt", lagerSeq: 0 })
    .returning({ id: schema.adressbuchKontakt.id });
  return `${lagerPfad(w, z)}/adressbuch/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/adressbuch": {
    url: (w, z) => `${lagerPfad(w, z)}/adressbuch`,
    erwartet: fuerLeitung(200),
  },
  "POST /api/v1/lager/:id/adressbuch": {
    url: (w, z) => `${lagerPfad(w, z)}/adressbuch`,
    body: () => ({ name: "Neu" }),
    erwartet: fuerLeitung(201, 409),
  },
  "GET /api/v1/lager/:id/adressbuch/:kontaktId": {
    url: neuerKontakt,
    erwartet: fuerLeitung(200),
  },
  "PATCH /api/v1/lager/:id/adressbuch/:kontaktId": {
    url: neuerKontakt,
    body: () => ({ version: 1, name: "Umbenannt" }),
    erwartet: fuerLeitung(200, 409),
  },
  "DELETE /api/v1/lager/:id/adressbuch/:kontaktId": {
    url: async (w, z) => `${await neuerKontakt(w, z)}?version=1`,
    erwartet: fuerLeitung(204, 409),
  },
};
