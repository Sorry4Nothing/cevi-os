import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { erstelleZaehler } from "../../lager/eingang.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { SUCHE_TEXT_MAX, sucheImLager, suchTypen } from "../../lager/suche.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const sucheAbfrage = z.strictObject({
  q: z
    .string()
    .trim()
    .min(2)
    .max(SUCHE_TEXT_MAX)
    .refine((t) => !/\p{Cc}/u.test(t)),
  typ: z.string().max(40).optional(),
});

const ANFRAGEN_JE_MINUTE = 30;

// Volltextsuche im Lager (#399), Beschreibung in lager/suche.ts. GET /lager/{id}/suche?q=&typ= mit höchstens 50 Treffern; jedes Mitglied darf suchen und findet nur, was es auch in den Listen sieht. Datenbank: die zwei Abfragen der Policy, dann eine Transaktion (Schwellenwert, eine UNION-ALL-Abfrage über alle Quellen) und nur bei Treffern aus dem Adressbuch ein Audit-Eintrag
export function erstelleSucheRouten({ db }: { db: Db }) {
  const lesen = lagerZugriff(db);
  // Je Konto, nicht je IP (SR-71); shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt
  const zuViele = erstelleZaehler(ANFRAGEN_JE_MINUTE, 60_000);

  return new Hono<LagerEnv>().get(
    "/:id/suche",
    lesen,
    eingabe("param", lagerPfad),
    eingabe("query", sucheAbfrage),
    async (c) => {
      const { q, typ } = c.req.valid("query");
      if (typ !== undefined && !suchTypen().includes(typ)) {
        throw new HTTPException(400);
      }
      const person = c.get("person");
      if (zuViele(person.id)) throw new HTTPException(429);
      const zugriff = c.get("lager");
      const treffer = await sucheImLager(db, zugriff, q, typ);
      const adressbuch = treffer.filter((t) => t.typ === "adressbuch").length;
      // Wie das Lesen der Liste: Ziel und Anzahl, nie der Suchtext
      if (adressbuch > 0) {
        await db.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "lager_adressbuch_gelesen",
          zielTyp: "lager",
          zielId: zugriff.lager.id,
          details: { anzahl: adressbuch },
        });
      }
      return c.json({ treffer });
    },
  );
}
