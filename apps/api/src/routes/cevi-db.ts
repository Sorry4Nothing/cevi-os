import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { CeviDbDienst } from "../cevi-db/dienst.js";
import { ermittle } from "../cevi-db/vorschlag.js";
import type { Db } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import type { Person } from "../rechte.js";

// Vorschlag aus der Cevi-Datenbank für die Anmeldung (#691): Die Seite ruft ihn einmal beim Öffnen auf und füllt damit freiwillige Angaben vor. Wer sich anmelden darf, darf ihn für sich oder das eigene Kind abrufen; mehr gibt es nicht (kein freies Suchfeld, nie eine Auskunft über Dritte). Es wird nichts gespeichert.
// Abfragen: Anlass mit Feldern 1, Kind und Eltern 2 (nur bei «kind») oder Konto 1, bestehende Anmeldung 1, danach der Zwischenspeicher im Arbeitsspeicher oder ein Abruf bei der Cevi-Datenbank, Audit 1.

const querySchema = z.strictObject({
  anlassId: z.uuid(),
  kindId: z.uuid().optional(),
});

// Je Konto höchstens so viele Abrufe je Minute (Schutz vor Auslesen)
export const VORSCHLAEGE_PRO_MINUTE = 10;

export function erstelleCeviDbRouten({
  db,
  dienst,
}: {
  db: Db;
  dienst?: CeviDbDienst;
}) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const abrufe = new Map<string, number[]>();
  const zuViele = (personId: string) => {
    const jetzt = Date.now();
    const liste = (abrufe.get(personId) ?? []).filter(
      (t) => jetzt - t < 60_000,
    );
    const voll = liste.length >= VORSCHLAEGE_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) abrufe.set(personId, liste);
    else abrufe.delete(personId);
    return voll;
  };

  return new Hono<{ Variables: { person: Person } }>().get(
    "/vorschlag",
    eingabe("query", querySchema),
    async (c) => {
      const person = c.get("person");
      const { anlassId, kindId } = c.req.valid("query");
      if (zuViele(person.id)) throw new HTTPException(429);
      const r = await ermittle({ db, dienst, person, anlassId, kindId });
      // Fremder oder unsichtbarer Anlass und fremdes Kind: dasselbe 404 wie bei der Anmeldung
      if ("fehler" in r) {
        throw new HTTPException(404);
      }
      if (r.vorschlag.status !== "aus") {
        // Nur Kennungen, die Zahl der Felder und der Ausgang, nie ein Wert
        await db.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "cevi_db_vorschlag",
          zielTyp: "anlass",
          zielId: anlassId,
          details: {
            kind: kindId !== undefined,
            status: r.vorschlag.status,
            felder: Object.keys(r.vorschlag.felder).length,
          },
        });
      }
      return c.json(r.vorschlag);
    },
  );
}
