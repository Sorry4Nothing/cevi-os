import * as schema from "../../../src/db/schema.js";
import { legeProgrammAn } from "../../hilfen/programme.js";
import type { Welt } from "../../hilfen/personas.js";
import type { TermineMatrix, TerminePersona } from "../matrix.js";

// Matrix-Zeilen von TE2 (#443): Anmeldung zu einem Anlass über das Konto. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Der Anlass ist für alle der Abteilung sichtbar und meldet Kinder an. Lesen darf jede Person der Abteilung (auch ohne Kind: leere Liste), anmelden und abmelden nur das Elternteil des Kindes: Jedes andere Kind ist 404, auch für die Abteilungsleitung. Die fremde Abteilung sieht den Anlass nie (404).
const status = (
  werte: Partial<Record<TerminePersona, number>>,
): Record<TerminePersona, number> => ({
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
  fremdeAbteilungsleitung: 404,
  fremdeEltern: 404,
  ...werte,
});

// Wer kein Elternteil von Kind A ist, kennt das Kind nicht: 404
const NUR_ELTERN_A = {
  abteilungsleitung: 404,
  adminOhneFaktor: 404,
  stufenleitungA: 404,
  stufenleitungB: 404,
  leitungA: 404,
  leitungB: 404,
  leitungAElternB: 404,
  elternB: 404,
} as const;

export async function VORBEREITUNG(welt: Welt) {
  const termin = await legeProgrammAn(welt.db, {
    abteilungId: welt.testabteilungId,
  });
  const [zeile] = await welt.db
    .insert(schema.anlass)
    .values({
      abteilungId: welt.testabteilungId,
      programmId: termin.id,
      anmeldungFuer: "kind",
      anmeldungOffen: true,
      sichtbarkeit: "angemeldet",
    })
    .returning({ id: schema.anlass.id });
  await welt.db.insert(schema.anlassFeld).values({
    anlassId: zeile.id,
    schluessel: "bemerkung",
    beschriftung: "Bemerkung",
    typ: "text",
  });
  return { anlass: zeile.id };
}

const pfad = (k: { ids: Record<string, Record<string, string>> }) =>
  `/api/v1/anlaesse/${k.ids["anlaesse"]!.anlass}`;

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/anlaesse/:id": {
    erwartet: status({}),
    url: (k) => pfad(k),
  },
  "PUT /api/v1/anlaesse/:id/anmeldung": {
    erwartet: status({ ...NUR_ELTERN_A }),
    url: (k) => `${pfad(k)}/anmeldung`,
    body: (k) => ({
      kindId: k.welt.kindAId,
      antworten: { bemerkung: "Freue mich" },
    }),
  },
  "DELETE /api/v1/anlaesse/:id/anmeldung": {
    erwartet: status({ ...NUR_ELTERN_A, elternA: 204 }),
    url: (k) => `${pfad(k)}/anmeldung?kindId=${k.welt.kindAId}`,
  },
};
