import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L2c (#380): Erwähnungen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Liste, «erledigt»: kein eigenes Recht, jedes Mitglied betrifft nur die eigenen Zeilen; Nicht-Mitglied und fremde Abteilung 404. Abgleich: das Recht, den Inhalt zu schreiben (hier eine Aufgabe: aufgaben.bearbeiten, Standard Lagerleitung, Abteilungsleitung, Leitung; Team und Lesen 403 vor dem Schreibschutz). Als Aufgabe: aufgaben.bearbeiten oder aufgaben.eigene (Standard auch Team; Lesen 403). «erledigt» und «Als Aufgabe» zeigen hier auf eine Erwähnung, die der Persona nicht gehört: 404 für jede; den Erfolg zeigt erwaehnungen.test.ts.
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

const lagerPfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}`;
const KEINE = "00000000-0000-4000-8000-000000000000";

// Ein Inhalt direkt in der Datenbank: Jede Anfrage bekommt einen frischen
async function neueAufgabe(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.aufgabe)
    .values({ lagerId: w.lagerId(z), titel: "Matrix-Aufgabe", lagerSeq: 0 })
    .returning({ id: schema.aufgabe.id });
  return `${lagerPfad(w, z)}/erwaehnungen/aufgabe/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/erwaehnungen": {
    url: (w, z) => `${lagerPfad(w, z)}/erwaehnungen`,
    erwartet: {
      aktiv: status(nichtMitglied, 200),
      abgeschlossen: status(nichtMitglied, 200),
    },
  },
  "PUT /api/v1/lager/:id/erwaehnungen/:typ/:quelleId": {
    url: neueAufgabe,
    erwartet: {
      aktiv: status(
        {
          ...nichtMitglied,
          abteilungsleitung: 200,
          lagerleitung: 200,
          leitung: 200,
          team: 403,
          lesen: 403,
        },
        200,
      ),
      abgeschlossen: status(
        {
          ...nichtMitglied,
          abteilungsleitung: 409,
          lagerleitung: 409,
          leitung: 409,
          team: 403,
          lesen: 403,
        },
        409,
      ),
    },
  },
  "PATCH /api/v1/lager/:id/erwaehnungen/:erwaehnungId": {
    url: (w, z) => `${lagerPfad(w, z)}/erwaehnungen/${KEINE}`,
    body: () => ({ erledigt: true }),
    erwartet: {
      aktiv: status(nichtMitglied, 404),
      abgeschlossen: status(nichtMitglied, 409),
    },
  },
  "POST /api/v1/lager/:id/erwaehnungen/:erwaehnungId/als-aufgabe": {
    url: (w, z) => `${lagerPfad(w, z)}/erwaehnungen/${KEINE}/als-aufgabe`,
    erwartet: {
      aktiv: status({ ...nichtMitglied, lesen: 403 }, 404),
      abgeschlossen: status({ ...nichtMitglied, lesen: 403 }, 409),
    },
  },
};
