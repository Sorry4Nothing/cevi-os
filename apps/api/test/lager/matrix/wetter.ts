import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5b (#391): Wetter. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Rechte (Standard): wetter.lesen haben alle vier Rollen, auch das Team; im abgeschlossenen Lager geht Lesen weiter. Den Ort setzt nur die Lagerleitung (die Abteilungsleitung gilt als Lagerleitung); alle anderen Rollen bekommen 403 vor dem Schreibschutz, die beiden im abgeschlossenen Lager 409. Nicht-Mitglied und fremde Abteilung 404.
// Der Ort der Matrix ist leer (null): Mit einem Ort riefe das nächste GET den echten Wetterdienst ab, die Matrix läuft ohne Netz.
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

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/wetter`;

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/wetter": {
    url: pfad,
    erwartet: {
      aktiv: status({ ...nichtMitglied }, 200),
      abgeschlossen: status({ ...nichtMitglied }, 200),
    },
  },
  "PUT /api/v1/lager/:id/wetter/ort": {
    url: (w, z) => `${pfad(w, z)}/ort`,
    body: () => ({ breite: null, laenge: null }),
    erwartet: {
      aktiv: status(
        { ...nichtMitglied, abteilungsleitung: 200, lagerleitung: 200 },
        403,
      ),
      abgeschlossen: status(
        { ...nichtMitglied, abteilungsleitung: 409, lagerleitung: 409 },
        403,
      ),
    },
  },
};
