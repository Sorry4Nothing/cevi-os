import * as schema from "../../../src/db/schema.js";
import type { Welt } from "../../hilfen/personas.js";
import { legeProgrammAn } from "../../hilfen/programme.js";
import type { TermineMatrix, TerminePersona } from "../matrix.js";

// Matrix-Zeilen von TA3 (#434): Kategorie-Zuordnungen verwalten. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Nur die Abteilungsleitung (Abteilungsleitung mit zweitem Faktor): jede andere Rolle der Abteilung 403, auch Stufenleitung und Leitung. Mit der Zuordnung im Pfad ist eine fremde 404 (auch für die Abteilungsleitung der anderen Abteilung); ohne Objekt im Pfad bekommt sie die Antwort ihrer eigenen Abteilung.
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

async function neuerTag(welt: Welt) {
  const [t] = await welt.db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: `Matrix-Tag ${crypto.randomUUID().slice(0, 8)}`,
      kuerzel: "MT",
    })
    .returning({ id: schema.tag.id });
  return t!.id;
}

async function neueZuordnung(welt: Welt) {
  const [z] = await welt.db
    .insert(schema.kategorieZuordnung)
    .values({
      abteilungId: welt.testabteilungId,
      kategorie: `Matrix ${crypto.randomUUID()}`,
      tagId: await neuerTag(welt),
    })
    .returning({ id: schema.kategorieZuordnung.id });
  return z!.id;
}

export async function VORBEREITUNG(welt: Welt) {
  // Ein eigener Termin für die Tags (#835): Die Warnliste und ihre Tests bleiben unberührt
  const termin = await legeProgrammAn(welt.db, {
    abteilungId: welt.testabteilungId,
    titel: "Matrix-Termin für Tags",
    beginn: new Date("2099-04-06T13:00:00Z"),
  });
  return { tag: await neuerTag(welt), termin: termin.id };
}

const BASIS = "/api/v1/admin/kategorie-zuordnungen";

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/admin/kategorie-zuordnungen": {
    // Ohne Objekt im Pfad: Die fremde Abteilungsleitung sieht ihre eigene (leere) Liste, fremde Eltern bekommen 403
    erwartet: status({ fremdeAbteilungsleitung: 200, fremdeEltern: 403 }),
  },
  "PUT /api/v1/admin/kategorie-zuordnungen": {
    // Der Tag gehört zur Testabteilung: Für die Abteilungsleitung der anderen Abteilung ist er fremd (400, nicht 404: kein Objekt im Pfad)
    erwartet: status({
      abteilungsleitung: 201,
      fremdeAbteilungsleitung: 400,
      fremdeEltern: 403,
    }),
    body: (k) => ({
      kategorie: `Matrix ${crypto.randomUUID()}`,
      tagId: k.ids["kategorie-zuordnungen"]!.tag!,
    }),
  },
  // Tags bestehender Termine setzen (#835), dasselbe Recht wie die Zuordnung. Mit dem Termin im Pfad: fremd ist 404 (auch für die fremde Abteilungsleitung); die Sammelaktion hat kein Objekt im Pfad, ihr fremder Tag ist 400
  "PUT /api/v1/admin/termine/:id/tags": {
    erwartet: status({
      fremdeAbteilungsleitung: 404,
      fremdeEltern: 404,
    }),
    url: (k) =>
      `/api/v1/admin/termine/${k.ids["kategorie-zuordnungen"]!.termin}/tags`,
    body: (k) => ({ tagIds: [k.ids["kategorie-zuordnungen"]!.tag!] }),
  },
  "PUT /api/v1/admin/termine/tags": {
    erwartet: status({ fremdeAbteilungsleitung: 400, fremdeEltern: 403 }),
    body: (k) => ({
      terminIds: [k.ids["kategorie-zuordnungen"]!.termin!],
      tagIds: [k.ids["kategorie-zuordnungen"]!.tag!],
    }),
  },
  // Jede Anfrage bekommt eine frische Zuordnung, weil das Löschen sie verbraucht
  "DELETE /api/v1/admin/kategorie-zuordnungen/:id": {
    erwartet: status({ abteilungsleitung: 204 }),
    url: async (k) => `${BASIS}/${await neueZuordnung(k.welt)}`,
  },
};
