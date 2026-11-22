import { randomUUID } from "node:crypto";
import * as schema from "../../../src/db/schema.js";
import { terminVorschlag } from "../../../src/db/schema-vorschlag.js";
import type { Persona, PersonaKonto, Welt } from "../../hilfen/personas.js";
import type {
  TermineKontext,
  TermineMatrix,
  TerminePersona,
} from "../matrix.js";

// Matrix-Zeilen von TD2 (#440): Vorschläge entscheiden. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Nur die Abteilungsleitung mit zweitem Faktor darf (jede andere Rolle 403, auch die Person, die den Vorschlag eingereicht hat, solange sie nicht Admin ist). Mit Vorschlag im Pfad ist ein fremder Vorschlag 404, auch für die Abteilungsleitung der anderen Abteilung; ohne Pfad-Parameter sieht sie ihre eigene (leere) Liste.
const status = (
  werte: Partial<Record<TerminePersona, number>>,
): Record<TerminePersona, number> => ({
  abteilungsleitung: 200,
  adminOhneFaktor: 403,
  stufenleitungA: 403,
  stufenleitungB: 403,
  leitungA: 403,
  leitungB: 403,
  leitungAElternB: 403,
  elternA: 403,
  elternB: 403,
  passwortPflicht: 403,
  deaktiviert: 401,
  ohneLogin: 401,
  fremdeAbteilungsleitung: 404,
  fremdeEltern: 404,
  ...werte,
});

const BASIS = "/api/v1/admin/termin-vorschlaege";

type Ids = { tagId: string; vorschlagId: string };
const ids = (k: TermineKontext) => k.ids["admin-vorschlaege"] as Ids;

// Der Vorschlag gehört der Stufenleitung A, nie der Abteilungsleitung (die entscheidet nicht über den eigenen)
const neuerVorschlag = (
  welt: Welt,
  vonId: string,
  tagId: string,
  stand: "offen" | "freigegeben" = "offen",
) =>
  welt.db
    .insert(terminVorschlag)
    .values({
      abteilungId: welt.testabteilungId,
      vorgeschlagenVon: vonId,
      titel: `Matrix-Entscheid ${randomUUID().slice(0, 8)}`,
      ganztaegig: true,
      tagVon: "2099-01-01",
      tagBis: "2099-01-01",
      tagIds: [tagId],
      status: stand,
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
      name: `Matrix-Entscheid-Kategorie ${randomUUID().slice(0, 8)}`,
      kuerzel: "ME",
    })
    .returning({ id: schema.tag.id });
  return {
    tagId: tag!.id,
    vorschlagId: await neuerVorschlag(welt, konten.slA.id!, tag!.id),
  };
}

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/admin/termin-vorschlaege": {
    erwartet: status({ fremdeAbteilungsleitung: 200, fremdeEltern: 403 }),
  },
  "GET /api/v1/admin/termin-vorschlaege/:id": {
    erwartet: status({}),
    url: (k) => `${BASIS}/${ids(k).vorschlagId}`,
  },
  // Jede Anfrage bekommt ein frisches Ziel, weil der Entscheid es verbraucht
  "POST /api/v1/admin/termin-vorschlaege/:id/entscheid": {
    erwartet: status({}),
    url: async (k) =>
      `${BASIS}/${await neuerVorschlag(k.welt, k.konten.slA.id!, ids(k).tagId)}/entscheid`,
    body: () => ({ entscheid: "ablehnen", begruendung: "Passt nicht." }),
  },
  "POST /api/v1/admin/termin-vorschlaege/:id/eingetragen": {
    erwartet: status({}),
    url: async (k) =>
      `${BASIS}/${await neuerVorschlag(k.welt, k.konten.slA.id!, ids(k).tagId, "freigegeben")}/eingetragen`,
  },
};
