import type { TermineMatrix } from "../matrix.js";

// TC2 #438: Der Feed hat keine Sitzung (der geheime Token im Pfad ersetzt sie) und liegt ausserhalb von /api/v1. Die Persona spielt keine Rolle: Jede Anfrage mit einem unbekannten Token ist dieselbe 404-Antwort, auch mit Cookie eines angemeldeten Kontos. Die Antworten mit gültigem Token prüft test/termine/ical.test.ts. Von Hand gegengelesen, nicht berechnet.
const jede = (status: number): TermineMatrix[string]["erwartet"] => ({
  abteilungsleitung: status,
  adminOhneFaktor: status,
  stufenleitungA: status,
  stufenleitungB: status,
  leitungA: status,
  leitungB: status,
  leitungAElternB: status,
  elternA: status,
  elternB: status,
  passwortPflicht: status,
  deaktiviert: status,
  ohneLogin: status,
  fremdeAbteilungsleitung: status,
  fremdeEltern: status,
});

export const ZEILEN: TermineMatrix = {
  "GET /ical/:datei": {
    // Formal gültig (43 Zeichen), aber nie vergeben
    url: () => `/ical/${"A".repeat(43)}.ics`,
    oeffentlich: true,
    erwartet: jede(404),
  },
};
