import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import { terminVorschlag } from "../../../src/db/schema-vorschlag.js";
import type { Persona, PersonaKonto, Welt } from "../../hilfen/personas.js";
import type {
  TermineKontext,
  TermineMatrix,
  TerminePersona,
} from "../matrix.js";

// Matrix-Zeilen von TD1 (#439): Terminvorschläge. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Vorschlagen dürfen (Annahme A9): die Abteilungsleitung (auch ohne zweiten Faktor: die Route ist keine Verwaltungsroute), Stufenleitung und Leitung, hier alle fünf Konten mit Rolle; Eltern ohne Rolle und ohne Tag nicht (403). Die Demo-Abteilungsleitung darf es, aber die Tags der Testabteilung gehören nicht zu ihrer Abteilung (400 TAG_UNBEKANNT). Der Vorschlag der Matrix gehört der Stufenleitung A: Ihn sehen sie und die Abteilungsleitung, für alle anderen gibt es ihn nicht (404). Zurückziehen darf nur die vorschlagende Person; die Abteilungsleitung sieht ihn, darf aber nicht (403).
const status = (
  werte: Partial<Record<TerminePersona, number>>,
  grundlage: number,
): Record<TerminePersona, number> => ({
  abteilungsleitung: grundlage,
  adminOhneFaktor: grundlage,
  stufenleitungA: grundlage,
  stufenleitungB: grundlage,
  leitungA: grundlage,
  leitungB: grundlage,
  leitungAElternB: grundlage,
  elternA: grundlage,
  elternB: grundlage,
  passwortPflicht: 403,
  deaktiviert: 401,
  ohneLogin: 401,
  fremdeAbteilungsleitung: grundlage,
  fremdeEltern: grundlage,
  ...werte,
});

const BASIS = "/api/v1/termin-vorschlaege";

type Ids = { tagId: string; vorschlagId: string };
const ids = (k: TermineKontext) => k.ids["vorschlaege"] as Ids;

const neuerVorschlag = (
  welt: Welt,
  vonId: string,
  tagId: string,
  status: "offen" | "freigegeben" = "offen",
) =>
  welt.db
    .insert(terminVorschlag)
    .values({
      abteilungId: welt.testabteilungId,
      vorgeschlagenVon: vonId,
      titel: `Matrix-Vorschlag ${randomUUID().slice(0, 8)}`,
      ganztaegig: true,
      tagVon: "2099-01-01",
      tagBis: "2099-01-01",
      tagIds: [tagId],
      status,
    })
    .returning({ id: terminVorschlag.id })
    .then(([z]) => z!.id);

export async function VORBEREITUNG(
  welt: Welt,
  konten: Record<Persona, PersonaKonto>,
): Promise<Ids> {
  const [tag] = await welt.db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: `Matrix-Kategorie ${randomUUID().slice(0, 8)}`,
      kuerzel: "MK",
    })
    .returning({ id: schema.tag.id });
  return {
    tagId: tag!.id,
    vorschlagId: await neuerVorschlag(welt, konten.slA.id!, tag!.id),
  };
}

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/termin-vorschlaege/optionen": { erwartet: status({}, 200) },
  "GET /api/v1/termin-vorschlaege/meine": { erwartet: status({}, 200) },
  "POST /api/v1/termin-vorschlaege": {
    // Ein ganztägiger Vorschlag in einem Monat
    body: (k) => ({
      titel: "Matrix: Terminvorschlag",
      ganztaegig: true,
      tagVon: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      tagBis: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      tagIds: [ids(k).tagId],
    }),
    erwartet: status(
      {
        elternA: 403,
        elternB: 403,
        fremdeEltern: 403,
        // Die Tags gehören zur Testabteilung
        fremdeAbteilungsleitung: 400,
      },
      201,
    ),
  },
  "GET /api/v1/termin-vorschlaege/:id": {
    url: (k) => `${BASIS}/${ids(k).vorschlagId}`,
    erwartet: status(
      {
        stufenleitungB: 404,
        leitungA: 404,
        leitungB: 404,
        leitungAElternB: 404,
        elternA: 404,
        elternB: 404,
        fremdeAbteilungsleitung: 404,
        fremdeEltern: 404,
      },
      200,
    ),
  },
  "DELETE /api/v1/termin-vorschlaege/:id": {
    // Jede Anfrage bekommt ein frisches Ziel von elternA (die Person darf zurückziehen, auch ohne Recht zum Vorschlagen, sonst bliebe das Ziel liegen); elternA verbraucht es, die anderen lassen es stehen
    url: async (k) =>
      `${BASIS}/${await neuerVorschlag(k.welt, k.konten.elternA.id!, ids(k).tagId)}`,
    erwartet: status(
      {
        abteilungsleitung: 403,
        adminOhneFaktor: 403,
        elternA: 204,
        stufenleitungA: 404,
        stufenleitungB: 404,
        leitungA: 404,
        leitungB: 404,
        leitungAElternB: 404,
        elternB: 404,
        fremdeAbteilungsleitung: 404,
        fremdeEltern: 404,
      },
      404,
    ),
  },
};
