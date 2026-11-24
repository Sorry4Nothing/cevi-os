import * as schema from "../../../src/db/schema.js";
import { legeProgrammAn } from "../../hilfen/programme.js";
import type { Welt } from "../../hilfen/personas.js";
import type { TermineMatrix, TerminePersona } from "../matrix.js";

// Matrix-Zeilen der Cevi-Datenbank (#691). Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Der Vorschlag gilt für das eigene Kind: Wer kein Elternteil von Kind A ist, kennt das Kind nicht (404, auch die Abteilungsleitung). Die Verbindung richtet nur die Abteilungsleitung mit zweitem Faktor ein (Recht «cevi_db.verwalten»). Die Matrix läuft ohne Verbindung zur Cevi-Datenbank: Der Vorschlag ist dann «aus», die Prüfung «nicht eingerichtet».
const status = (
  werte: Partial<Record<TerminePersona, number>>,
): Record<TerminePersona, number> => ({
  abteilungsleitung: 403,
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
  fremdeAbteilungsleitung: 403,
  fremdeEltern: 403,
  ...werte,
});

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
    schluessel: "geburtsdatum",
    beschriftung: "Geburtsdatum",
    typ: "text",
    ceviQuelle: "geburtsdatum",
  });
  return { anlass: zeile.id };
}

const NUR_ELTERN_A = {
  abteilungsleitung: 404,
  adminOhneFaktor: 404,
  stufenleitungA: 404,
  stufenleitungB: 404,
  leitungA: 404,
  leitungB: 404,
  leitungAElternB: 404,
  elternB: 404,
  elternA: 200,
  fremdeAbteilungsleitung: 404,
  fremdeEltern: 404,
} as const;

export const ZEILEN: TermineMatrix = {
  "GET /api/v1/cevi-db/vorschlag": {
    erwartet: status({ ...NUR_ELTERN_A }),
    url: (k) =>
      `/api/v1/cevi-db/vorschlag?anlassId=${k.ids["cevi-db"]!.anlass}&kindId=${k.welt.kindAId}`,
  },
  "GET /api/v1/admin/cevi-db": {
    erwartet: status({ abteilungsleitung: 200, fremdeAbteilungsleitung: 200 }),
  },
  "PUT /api/v1/admin/cevi-db": {
    erwartet: status({ abteilungsleitung: 204, fremdeAbteilungsleitung: 204 }),
    body: () => ({ gruppeId: "1234" }),
  },
  "POST /api/v1/admin/cevi-db/pruefen": {
    erwartet: status({ abteilungsleitung: 200, fremdeAbteilungsleitung: 200 }),
  },
};
