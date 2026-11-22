import type { TermineMatrix } from "../matrix.js";

// Matrix-Zeilen von TB2 (#436): «Alle Termine» für das Web. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Wie die Liste von «Mein Kalender» antwortet jede angemeldete Person mit 200 (auch leer); was sie sieht, prüft test/termine/alle.test.ts. Das 404 für die Apps (Header X-App-Version) prüft derselbe Test: Die Matrix sendet den Header nicht.
const FENSTER = "von=2027-03-01&bis=2027-03-07";

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/termine/alle": {
    url: () => `/api/v1/termine/alle?${FENSTER}`,
    erwartet: {
      abteilungsleitung: 200,
      adminOhneFaktor: 200,
      stufenleitungA: 200,
      stufenleitungB: 200,
      leitungA: 200,
      leitungB: 200,
      leitungAElternB: 200,
      elternA: 200,
      elternB: 200,
      passwortPflicht: 403,
      deaktiviert: 401,
      ohneLogin: 401,
      fremdeAbteilungsleitung: 200,
      fremdeEltern: 200,
    },
  },
};
