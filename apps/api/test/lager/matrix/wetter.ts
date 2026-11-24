import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5b (#391): Wetter. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Rechte (Standard): wetter.lesen haben alle vier Rollen, auch das Team; im abgeschlossenen Lager geht Lesen weiter. Den Ort setzt niemand von Hand, der Server bestimmt ihn aus dem Lagerort (#694); es gibt keine Route dafür. Nicht-Mitglied und fremde Abteilung 404.
// Das Lager der Matrix hat keinen Ort: Mit einem Ort suchte das nächste GET beim echten Ortsdienst, die Matrix läuft ohne Netz.
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
};
