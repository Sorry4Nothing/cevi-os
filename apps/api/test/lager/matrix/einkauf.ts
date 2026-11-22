import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5c (#392): Einkaufsliste. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Lesen (einkauf.lesen): Lagerleitung, Abteilungsleitung, Leitung und Lesen; das Team hat das Recht im Standard nicht (403). Schreiben (einkauf.bearbeiten): Lagerleitung, Abteilungsleitung und Leitung; Team und Lesen 403 vor dem Schreibschutz, im abgeschlossenen Lager die drei anderen 409. Nicht-Mitglied und fremde Abteilung 404.
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

const lesen = (erfolg: number) => {
  const zeile = status(
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
  return { aktiv: zeile, abgeschlossen: zeile };
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

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/einkauf`;

// Zeile direkt in die Datenbank: Jede Anfrage bekommt ein frisches Ziel (Version 1), weil Ändern und Löschen es verbrauchen
async function neuerArtikel(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.einkaufArtikel)
    .values({
      lagerId: w.lagerId(z),
      name: "Matrix-Artikel",
      nameNorm: "matrix-artikel",
      warengruppe: "diverses",
      lagerSeq: 0,
    })
    .returning({ id: schema.einkaufArtikel.id });
  return `${lagerPfad(w, z)}/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/einkauf": {
    url: lagerPfad,
    erwartet: lesen(200),
  },
  "POST /api/v1/lager/:id/einkauf": {
    url: lagerPfad,
    body: () => ({ name: "Reis", menge: 2, einheit: "kg" }),
    erwartet: schreiben(201),
  },
  "GET /api/v1/lager/:id/einkauf/zusammen": {
    url: (w, z) => `${lagerPfad(w, z)}/zusammen`,
    erwartet: lesen(200),
  },
  "GET /api/v1/lager/:id/einkauf/vorschlaege": {
    url: (w, z) => `${lagerPfad(w, z)}/vorschlaege`,
    erwartet: lesen(200),
  },
  "GET /api/v1/lager/:id/einkauf/:artikelId": {
    url: neuerArtikel,
    erwartet: lesen(200),
  },
  "PATCH /api/v1/lager/:id/einkauf/:artikelId": {
    url: neuerArtikel,
    body: () => ({ version: 1, erledigt: true }),
    erwartet: schreiben(200),
  },
  "DELETE /api/v1/lager/:id/einkauf/:artikelId": {
    url: async (w, z) => `${await neuerArtikel(w, z)}?version=1`,
    erwartet: schreiben(204),
  },
};
