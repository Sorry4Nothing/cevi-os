import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "../../../src/db/schema.js";
import type {
  LagerMatrix,
  LagerPersona,
  LagerWelt,
  LagerZustand,
} from "../matrix.js";

// Matrix-Zeilen von L1f (#376): Vorlagen. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet.
// Verwaltung (/admin/vorlagen): nur die Abteilungsleitung; die Lager-Rollen und ein Konto ohne Mitgliedschaft bekommen 403, die fremde Abteilung 404 bei einer Vorlage der Testabteilung und 403 auf den Sammelrouten. Das Lager spielt dort keine Rolle (aktiv und abgeschlossen gleich).
// Anwenden (/lager/:id/vorlagen/:vorlageId/anwenden): Recht vorlagen.anwenden, Standard nur die Lagerleitung und die Abteilungsleitung; 403 vor dem Schreibschutz 409. Die Zeile läuft als Trockenlauf; das Anwenden steht in vorlagen.test.ts.
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
const gleich = (e: Record<LagerPersona, number>) => ({
  aktiv: e,
  abgeschlossen: e,
});
const verwaltungSammel = (admin: number) =>
  gleich(status({ abteilungsleitung: admin }, 403));
const verwaltungObjekt = (admin: number) =>
  gleich(status({ abteilungsleitung: admin, fremdeAbteilung: 404 }, 403));
const nichtMitglied = { ohneMitgliedschaft: 404, fremdeAbteilung: 404 };

// Eine Vorlage der Testabteilung, direkt in die Datenbank (Name je Aufruf neu, weil er eindeutig sein muss)
async function neueVorlage(w: LagerWelt) {
  const [lager] = await w.db
    .select({ abteilungId: schema.lager.abteilungId })
    .from(schema.lager)
    .where(eq(schema.lager.id, w.aktivId));
  const [zeile] = await w.db
    .insert(schema.vorlage)
    .values({
      abteilungId: lager!.abteilungId,
      art: "aufgaben",
      name: `Matrix ${randomUUID()}`,
      inhalt: { aufgaben: [{ titel: "Matrix-Aufgabe", fristTage: -7 }] },
    })
    .returning({ id: schema.vorlage.id });
  return zeile!.id;
}
const adminPfad = async (w: LagerWelt) =>
  `/api/v1/admin/vorlagen/${await neueVorlage(w)}`;

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/admin/vorlagen": { erwartet: verwaltungSammel(200) },
  "POST /api/v1/admin/vorlagen": {
    body: () => ({
      art: "packliste",
      name: `Matrix ${randomUUID()}`,
      inhalt: { punkte: [{ abschnitt: "Kleidung", text: "Regenjacke" }] },
    }),
    erwartet: verwaltungSammel(201),
  },
  "GET /api/v1/admin/vorlagen/:id": {
    url: adminPfad,
    erwartet: verwaltungObjekt(200),
  },
  "PATCH /api/v1/admin/vorlagen/:id": {
    url: adminPfad,
    body: () => ({ name: `Matrix ${randomUUID()}` }),
    erwartet: verwaltungObjekt(200),
  },
  "DELETE /api/v1/admin/vorlagen/:id": {
    url: adminPfad,
    erwartet: verwaltungObjekt(204),
  },
  // Auswahl für «anwenden» (#520): Recht vorlagen.anwenden, im abgeschlossenen Lager lesbar
  "GET /api/v1/lager/:id/vorlagen": {
    url: (w: LagerWelt, z: LagerZustand) =>
      `/api/v1/lager/${w.lagerId(z)}/vorlagen`,
    erwartet: gleich(
      status(
        { ...nichtMitglied, abteilungsleitung: 200, lagerleitung: 200 },
        403,
      ),
    ),
  },
  "POST /api/v1/lager/:id/vorlagen/:vorlageId/anwenden": {
    url: async (w: LagerWelt, z: LagerZustand) =>
      `/api/v1/lager/${w.lagerId(z)}/vorlagen/${await neueVorlage(w)}/anwenden?trocken=true`,
    erwartet: {
      aktiv: status(
        { ...nichtMitglied, abteilungsleitung: 200, lagerleitung: 200 },
        403,
      ),
      abgeschlossen: status(
        { ...nichtMitglied, abteilungsleitung: 409, lagerleitung: 409 },
        403,
      ),
    },
  },
};
