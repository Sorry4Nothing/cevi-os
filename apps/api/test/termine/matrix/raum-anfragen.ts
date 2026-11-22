import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import type { Persona, PersonaKonto, Welt } from "../../hilfen/personas.js";
import type {
  TermineKontext,
  TermineMatrix,
  TerminePersona,
} from "../matrix.js";

// Matrix-Zeilen von TG2 (#447): Raumanfragen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Anfragen, Lesen und Stornieren: jede angemeldete Person der Abteilung (auch Eltern), Stornieren nur die eigene Anfrage (jede andere Person und jede fremde Abteilung 404). Entscheiden: nur wer den Team-Tag des Raums trägt (hier die Leitung der Stufe A, «leitungA»), nie die Abteilungsleitung, solange der Raum ein Team hat; fremde Anfrage 404 vor dem Recht.
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
  fremdeAbteilungsleitung: 200,
  fremdeEltern: 200,
  ...werte,
});

type Ids = { raumId: string; teamTagId: string };
const ids = (k: TermineKontext) => k.ids["raum-anfragen"] as Ids;

const BASIS = "/api/v1/raeume/anfragen";
const IN_DER_ZUKUNFT = "2099-01-01T10:00:00.000Z";
const ENDE = "2099-01-01T12:00:00.000Z";

// Die Fixtures gehören der Person, die sonst nie anfragt oder entscheidet: Die Obergrenze von 10 offenen Anfragen je Person (Zeile «POST /raeume/:id/anfragen») bliebe sonst nicht frei, und die Entscheidenden entscheiden nie über die eigene Anfrage. Abgesagte Anfragen zählen nicht zur Obergrenze
const neueAnfrage = (
  welt: Welt,
  raumId: string,
  vonId: string,
  stand: "angefragt" | "storniert",
) =>
  welt.db
    .insert(schema.raumBuchung)
    .values({
      raumId,
      userId: vonId,
      beginn: new Date(IN_DER_ZUKUNFT),
      ende: new Date(ENDE),
      zweck: "Matrix",
      status: stand,
    })
    .returning({ id: schema.raumBuchung.id })
    .then(([z]) => z!.id);

export async function VORBEREITUNG(
  welt: Welt,
  konten: Record<Persona, PersonaKonto>,
): Promise<Ids> {
  const [team] = await welt.db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "team",
      name: `Matrix-Raumteam ${randomUUID().slice(0, 8)}`,
      kuerzel: "MR",
    })
    .returning({ id: schema.tag.id });
  // Das Team ist die Leitung der Stufe A: Sie entscheidet, alle anderen Rollen nicht
  await welt.db
    .insert(schema.personTag)
    .values({ userId: konten.leitendeA.id!, tagId: team!.id });
  const [raum] = await welt.db
    .insert(schema.raum)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Matrix-Anfragen ${randomUUID().slice(0, 8)}`,
      teamTagId: team!.id,
    })
    .returning({ id: schema.raum.id });
  return { raumId: raum!.id, teamTagId: team!.id };
}

export const ZEILEN: TermineMatrix = {
  // Jede Person fragt einmal an; die Zeit ist unbelegt (die Zeile bestätigt nie eine Buchung)
  "POST /api/v1/raeume/:id/anfragen": {
    erwartet: status({
      abteilungsleitung: 201,
      adminOhneFaktor: 201,
      stufenleitungA: 201,
      stufenleitungB: 201,
      leitungA: 201,
      leitungB: 201,
      leitungAElternB: 201,
      elternA: 201,
      elternB: 201,
      fremdeAbteilungsleitung: 404,
      fremdeEltern: 404,
    }),
    url: (k) => `/api/v1/raeume/${ids(k).raumId}/anfragen`,
    body: () => ({ beginn: IN_DER_ZUKUNFT, ende: ENDE, zweck: "Gruppenabend" }),
  },
  "GET /api/v1/raeume/anfragen/meine": { erwartet: status({}) },
  "GET /api/v1/raeume/anfragen/offen": { erwartet: status({}) },
  // Jede Anfrage bekommt ein frisches Ziel, das der Person elternB gehört: Nur sie storniert (204), alle anderen sehen es nicht (404)
  "DELETE /api/v1/raeume/anfragen/:id": {
    erwartet: status({
      abteilungsleitung: 404,
      adminOhneFaktor: 404,
      stufenleitungA: 404,
      stufenleitungB: 404,
      leitungA: 404,
      leitungB: 404,
      leitungAElternB: 404,
      elternA: 404,
      elternB: 204,
      fremdeAbteilungsleitung: 404,
      fremdeEltern: 404,
    }),
    url: async (k) =>
      `${BASIS}/${await neueAnfrage(k.welt, ids(k).raumId, k.konten.elternB.id!, "storniert")}`,
  },
  // Jede Anfrage bekommt ein frisches Ziel von passwortPflicht (die Person kann nie selbst anfragen); der Entscheid «ablehnen» belegt den Raum nicht
  "POST /api/v1/raeume/anfragen/:id/entscheid": {
    erwartet: status({
      abteilungsleitung: 403,
      adminOhneFaktor: 403,
      stufenleitungA: 403,
      stufenleitungB: 403,
      leitungA: 200,
      leitungB: 403,
      leitungAElternB: 403,
      elternA: 403,
      elternB: 403,
      fremdeAbteilungsleitung: 404,
      fremdeEltern: 404,
    }),
    url: async (k) =>
      `${BASIS}/${await neueAnfrage(k.welt, ids(k).raumId, k.konten.mussPasswortAendern.id!, "angefragt")}/entscheid`,
    body: () => ({ entscheid: "ablehnen", begruendung: "Passt nicht." }),
  },
};
