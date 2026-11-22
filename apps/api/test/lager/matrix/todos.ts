import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1f (#376): private To-dos. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Jede Rolle im Lager führt eigene To-dos, auch «lesen»: ein Recht gibt es nicht, nur die Mitgliedschaft (Nicht-Mitglied und fremde Abteilung 404). Im abgeschlossenen Lager gilt der Schreibschutz (409) für jede Methode ausser GET.
// Das Ziel von PATCH und DELETE gehört hier einem Wegwerf-Konto, also trifft jede Persona auf eine fremde Zeile (404): auch die Lagerleitung und die Abteilungsleitung lesen und ändern keine fremden To-dos. Erfolge stehen in todos.test.ts.
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
  const e = status(nichtMitglied, erfolg);
  return { aktiv: e, abgeschlossen: e };
};
// Schreibend: alle Mitglieder im aktiven Lager, im abgeschlossenen 409
const schreiben = (erfolg: number) => ({
  aktiv: status(nichtMitglied, erfolg),
  abgeschlossen: status(nichtMitglied, 409),
});

const pfad = (w: LagerWelt, z: LagerZustand) =>
  `/api/v1/lager/${w.lagerId(z)}/todos`;

// Ein To-do eines Wegwerf-Kontos, direkt in die Datenbank: Keine Persona ist seine Besitzerin
async function fremdesTodo(w: LagerWelt, z: LagerZustand) {
  const [zeile] = await w.db
    .insert(schema.todoPrivat)
    .values({
      lagerId: w.lagerId(z),
      personId: await w.wegwerfPersonId(),
      text: "Matrix-To-do",
    })
    .returning({ id: schema.todoPrivat.id });
  return `${pfad(w, z)}/${zeile!.id}`;
}

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager/:id/todos": { url: pfad, erwartet: lesen(200) },
  "POST /api/v1/lager/:id/todos": {
    url: pfad,
    body: () => ({ text: randomUUID() }),
    erwartet: schreiben(201),
  },
  "PATCH /api/v1/lager/:id/todos/:todoId": {
    url: fremdesTodo,
    body: () => ({ erledigt: true }),
    erwartet: schreiben(404),
  },
  "DELETE /api/v1/lager/:id/todos/:todoId": {
    url: fremdesTodo,
    erwartet: schreiben(404),
  },
};
