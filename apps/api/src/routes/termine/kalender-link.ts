import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import {
  erzeuge,
  ladeStatus,
  pfadFuer,
  widerrufe,
} from "../../termine/ical-token.js";
import type { TermineEnv } from "./index.js";

// Persönlicher ICS-Link (TC1 #437): Status, erzeugen oder ersetzen, widerrufen. Für jede angemeldete Person ohne zweiten Faktor; jede Person verwaltet nur ihren eigenen Token. Der Server kennt die Basisadresse der API nicht: Er liefert den Token und den Pfad, die App setzt die Adresse davor. Den Feed liefert #438
// Ratenbegrenzung (SR-71) je Person auf POST und DELETE: 10 je 10 Minuten (der Link ändert sich selten)
const ZUGRIFFE = 10;
const FENSTER_MS = 10 * 60_000;

export function erstelleKalenderLinkRouten({ db }: { db: Db }) {
  // shortcut: Zähler im Arbeitsspeicher, ein Neustart setzt ihn zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft
  const versuche = new Map<string, number[]>();
  const zuViele = (id: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(id) ?? []).filter(
      (t) => jetzt - t < FENSTER_MS,
    );
    const voll = liste.length >= ZUGRIFFE;
    if (!voll) liste.push(jetzt);
    if (liste.length === 0) versuche.delete(id);
    else versuche.set(id, liste);
    return voll;
  };

  return new Hono<TermineEnv>()
    .get("/ich/kalender-link", async (c) => {
      const status = await ladeStatus(db, c.get("person").id);
      return c.json(status);
    })
    .post("/ich/kalender-link", async (c) => {
      const person = c.get("person");
      if (zuViele(person.id)) throw new HTTPException(429);
      const neu = await erzeuge(db, person);
      return c.json(
        {
          token: neu.token,
          pfad: pfadFuer(neu.token),
          erstelltAm: neu.erstelltAm,
          endung: neu.endung,
        },
        201,
      );
    })
    .delete("/ich/kalender-link", async (c) => {
      const person = c.get("person");
      if (zuViele(person.id)) throw new HTTPException(429);
      await widerrufe(db, person);
      return c.body(null, 204);
    });
}
