import { randomUUID } from "node:crypto";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L5a (#390): Anwesenheit mit Anfragen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Die Rechte (Standard): anwesenheit.lesen_alle Lagerleitung, Abteilungsleitung, Leitung, Lesen; anwesenheit.eigene Lagerleitung, Abteilungsleitung, Leitung, Team; anwesenheit.bearbeiten nur Lagerleitung und Abteilungsleitung. Nicht-Mitglied und fremde Abteilung 404; Recht 403 vor dem Schreibschutz 409.
// Die Abteilungsleitung ist kein Mitglied: Die eigenen Wege (PUT eigene, POST anfragen) verweigert sie mit 403 KEIN_MITGLIED, ausser im abgeschlossenen Lager, wo der Schreibschutz (409) vor dem Handler greift.
// Erfolge, die einen Stand brauchen (Anfrage stellen, entscheiden), stehen in anwesenheit.test.ts: Hier trifft die Anfrage ein offenes Feld (409 KEINE_ANFRAGE_NOETIG) und die Entscheidung eine unbekannte Anfrage (404).
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

// lesen_alle
const lesenAlle = (erfolg: number) => {
  const e = status({ ...nichtMitglied, team: 403 }, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
// anwesenheit.eigene lesen
const lesenEigene = (erfolg: number) => {
  const e = status({ ...nichtMitglied, lesen: 403 }, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
// Nur bearbeiten (Lagerleitung, Abteilungsleitung)
const nurBearbeiten = (erfolg: number, lesend = false) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: erfolg,
      lagerleitung: erfolg,
    },
    403,
  ),
  abgeschlossen: lesend
    ? status(
        {
          ...nichtMitglied,
          abteilungsleitung: erfolg,
          lagerleitung: erfolg,
        },
        403,
      )
    : status(
        { ...nichtMitglied, abteilungsleitung: 409, lagerleitung: 409 },
        403,
      ),
});
// Eigene Wege: Wer das Recht hat, erreicht den Handler; die Abteilungsleitung ist kein Mitglied (403), im abgeschlossenen Lager greift davor der Schreibschutz
const eigeneSchreiben = (erfolg: number) => ({
  aktiv: status(
    {
      ...nichtMitglied,
      abteilungsleitung: 403,
      lagerleitung: erfolg,
      leitung: erfolg,
      team: erfolg,
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
    },
    403,
  ),
});

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/anwesenheit`;
const feld = () => ({
  lagertagId: randomUUID(),
  tagesabschnittId: randomUUID(),
});

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/anwesenheit": {
    url: (w, z) => pfad(w, z),
    erwartet: lesenAlle(200),
  },
  "PUT /api/v1/lager/:id/anwesenheit": {
    url: (w, z) => pfad(w, z),
    // Ein Teilnehmender mit frischer ID: Die Lagerleitung schreibt (200), alle anderen scheitern am Recht
    body: () => ({
      eintraege: [{ teilnehmerId: randomUUID(), ...feld(), wert: "A" }],
    }),
    erwartet: nurBearbeiten(200),
  },
  "GET /api/v1/lager/:id/anwesenheit/eigene": {
    url: (w, z) => `${pfad(w, z)}/eigene`,
    erwartet: lesenEigene(200),
  },
  "PUT /api/v1/lager/:id/anwesenheit/eigene": {
    url: (w, z) => `${pfad(w, z)}/eigene`,
    body: () => ({ eintraege: [{ ...feld(), wert: "A" }] }),
    erwartet: eigeneSchreiben(200),
  },
  "GET /api/v1/lager/:id/anwesenheit/zusammenfassung": {
    url: (w, z) => `${pfad(w, z)}/zusammenfassung`,
    erwartet: lesenAlle(200),
  },
  "PUT /api/v1/lager/:id/anwesenheit/frist": {
    url: (w, z) => `${pfad(w, z)}/frist`,
    body: () => ({ frist: null }),
    erwartet: nurBearbeiten(200),
  },
  "GET /api/v1/lager/:id/anwesenheit/anfragen": {
    url: (w, z) => `${pfad(w, z)}/anfragen`,
    erwartet: nurBearbeiten(200, true),
  },
  "POST /api/v1/lager/:id/anwesenheit/anfragen": {
    url: (w, z) => `${pfad(w, z)}/anfragen`,
    // Ein offenes Feld ohne Frist: kein Grund für eine Anfrage (409 KEINE_ANFRAGE_NOETIG)
    body: () => ({ eintraege: [{ ...feld(), wert: "A" }] }),
    erwartet: eigeneSchreiben(409),
  },
  "POST /api/v1/lager/:id/anwesenheit/anfragen/entscheid": {
    url: (w, z) => `${pfad(w, z)}/anfragen/entscheid`,
    body: () => ({
      entscheid: "angenommen",
      anfragen: [{ id: randomUUID(), version: 1 }],
    }),
    erwartet: {
      aktiv: status(
        { ...nichtMitglied, abteilungsleitung: 404, lagerleitung: 404 },
        403,
      ),
      abgeschlossen: nurBearbeiten(404).abgeschlossen,
    },
  },
};
