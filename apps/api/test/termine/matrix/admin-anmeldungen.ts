import * as schema from "../../../src/db/schema.js";
import { legeProgrammAn } from "../../hilfen/programme.js";
import type { PersonaKonto, Persona, Welt } from "../../hilfen/personas.js";
import type { TermineMatrix, TerminePersona } from "../matrix.js";

// Matrix-Zeilen von TE3 (#444): Anmeldungen eines Anlasses ansehen und exportieren. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Nur die Abteilungsleitung mit zweitem Faktor (Annahme A10): jede andere Rolle 403, auch Stufenleitung, Leitung und Eltern (die Admin-Ohne-Faktor-Persona scheitert am Pfad /api/v1/admin/*). Der Anlass ist in der Pfad-ID: Die fremde Abteilung kennt ihn nicht und bekommt 404, auch die fremde Abteilungsleitung.
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

export async function VORBEREITUNG(
  welt: Welt,
  konten: Record<Persona, PersonaKonto>,
) {
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
  await welt.db.insert(schema.anlassAnmeldung).values({
    anlassId: zeile.id,
    userId: konten.elternA.id!,
    kindId: welt.kindAId,
    status: "angemeldet",
  });
  return { anlass: zeile.id };
}

const BASIS = (k: { ids: Record<string, Record<string, string>> }) =>
  `/api/v1/admin/anlaesse/${k.ids["admin-anmeldungen"]!.anlass}/anmeldungen`;

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/admin/anlaesse/:id/anmeldungen": {
    erwartet: status({}),
    url: (k) => BASIS(k),
  },
  "GET /api/v1/admin/anlaesse/:id/anmeldungen.csv": {
    erwartet: status({}),
    url: (k) => `${BASIS(k)}.csv`,
  },
};
