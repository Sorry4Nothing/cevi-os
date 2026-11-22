import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { ladeRaeume, raeumeListeSchema } from "../../termine/raum.js";
import type { TermineEnv } from "./index.js";

// Räume für die Mitglieder (#446, Epic #430): Jede angemeldete Person der Abteilung sieht die aktiven Räume (Annahme R2, vom Nutzer zu bestätigen); inaktive und Räume anderer Abteilungen nie. Die Verwaltung steht in admin-raeume.ts.
export function erstelleRaeumeRouten({ db }: { db: Db }) {
  return new Hono<TermineEnv>().get(
    "/raeume",
    eingabe("query", raeumeListeSchema),
    async (c) => {
      const { limit, nach } = c.req.valid("query");
      // Eine Abfrage je Seite
      return c.json(
        await ladeRaeume(db, {
          abteilungId: c.get("person").abteilungId,
          nurAktiv: true,
          limit,
          nach,
        }),
      );
    },
  );
}
