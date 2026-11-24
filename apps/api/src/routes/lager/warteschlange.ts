import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { verarbeiteOperationen } from "../../lager/operationen.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";

// Höchstens so viele Operationen je Anfrage (SR-71)
export const MAX_OPERATIONEN = 100;
// Je Konto höchstens so viele Anfragen je Minute: Jede Operation ist eine eigene Transaktion, die das Lager sperrt (lager/sync.ts)
export const ANFRAGEN_PRO_MINUTE = 20;

const body = z.strictObject({
  operationen: z
    .array(
      z.strictObject({
        // Die App erzeugt sie einmal je Operation und behält sie bei jeder Wiederholung
        clientOpId: z.uuid(),
        typ: z.string().min(1).max(64),
        nutzlast: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(MAX_OPERATIONEN),
});

// Warteschlange für Offline-Änderungen (#367). Die Route setzt kein Recht: Jede Operation bringt ihr eigenes mit (lager/operationen.ts) und wird gegen die Rolle der Person im Lager geprüft. Ein abgeschlossenes Lager nimmt nichts an (409 für die ganze Anfrage, wie jede schreibende Lager-Route)
export function erstelleWarteschlangeRouten({ db }: { db: Db }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const anfragen = new Map<string, number[]>();
  const zuViele = (personId: string) => {
    const jetzt = Date.now();
    const liste = (anfragen.get(personId) ?? []).filter(
      (t) => jetzt - t < 60_000,
    );
    const voll = liste.length >= ANFRAGEN_PRO_MINUTE;
    if (!voll) liste.push(jetzt);
    if (liste.length > 0) anfragen.set(personId, liste);
    else anfragen.delete(personId);
    return voll;
  };

  return new Hono<LagerEnv>().post(
    "/:id/aenderungen",
    lagerZugriff(db),
    eingabe("json", body),
    async (c) => {
      const person = c.get("person");
      if (zuViele(person.id)) throw new HTTPException(429);
      const { operationen } = c.req.valid("json");
      const ergebnisse = await verarbeiteOperationen(
        db,
        c.get("lager"),
        person,
        operationen,
      );
      return c.json({ ergebnisse });
    },
  );
}
