import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von L0d (#367). Der Event-Stream ist lesend: jedes Mitglied darf verbinden (er filtert selbst nach Recht und Rolle, siehe ereignisse.test.ts), auch im abgeschlossenen Lager. Wer kein Mitglied ist und die fremde Abteilung bekommen 404. Die Warteschlange nimmt von jedem Mitglied Anfragen an (jede Operation prüft ihr eigenes Recht, siehe warteschlange.test.ts); ein abgeschlossenes Lager lehnt sie ganz ab (409). Die Anfrage der Matrix ist eine Operation, die es nicht gibt: Sie schreibt nichts und wird abgelehnt
const mitglieder: Record<LagerPersona, number> = {
  abteilungsleitung: 200,
  lagerleitung: 200,
  leitung: 200,
  team: 200,
  lesen: 200,
  ohneMitgliedschaft: 404,
  fremdeAbteilung: 404,
  ohneLogin: 401,
};

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/ereignisse": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/ereignisse`,
    erwartet: { aktiv: mitglieder, abgeschlossen: mitglieder },
  },
  "POST /api/v1/lager/:id/aenderungen": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}/aenderungen`,
    body: () => ({
      operationen: [
        {
          clientOpId: "00000000-0000-4000-8000-000000000001",
          typ: "matrix.gibt_es_nicht",
          nutzlast: {},
        },
      ],
    }),
    erwartet: {
      aktiv: mitglieder,
      abgeschlossen: {
        abteilungsleitung: 409,
        lagerleitung: 409,
        leitung: 409,
        team: 409,
        lesen: 409,
        ohneMitgliedschaft: 404,
        fremdeAbteilung: 404,
        ohneLogin: 401,
      },
    },
  },
};
