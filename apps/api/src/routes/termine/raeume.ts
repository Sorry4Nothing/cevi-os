import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  belegungSchema,
  ladeBelegung,
  ladeRaeume,
  raeumeListeSchema,
} from "../../termine/raum.js";
import { hatRaeume, raeumeMit, raumBedingung } from "../../termine/rechte.js";
import type { TermineEnv } from "./index.js";

// Räume für die Mitglieder (#446, Epic #430): Jede angemeldete Person der Abteilung sieht die aktiven Räume (Annahme R2, vom Nutzer zu bestätigen); inaktive und Räume anderer Abteilungen nie. Die Verwaltung steht in admin-raeume.ts.
// Belegung (#628): Wer das Recht «Belegung der Räume sehen» hat, sieht, wer welchen Raum wann belegt: standardmässig jede Leitung, wer ein Team eines Raums trägt und die Abteilungsleitung; eine Gruppenrolle kann es für die Räume ihres Teams haben (#649). Eltern, Kinder und Personen ohne dieses Recht 403 (kein zweiter Faktor: «normal»).
export function erstelleRaeumeRouten({ db }: { db: Db }) {
  return new Hono<TermineEnv>()
    .get("/raeume", eingabe("query", raeumeListeSchema), async (c) => {
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
    })
    .get("/raeume/belegung", eingabe("query", belegungSchema), async (c) => {
      const person = c.get("person");
      // Für welche Räume das Recht gilt: alle, die eines Teams oder keine (403). Eine Abfrage für die Teams, der Rest im Speicher
      const sicht = await raeumeMit(db, person, ["raum.belegung"]);
      if (!hatRaeume(sicht)) throw new HTTPException(403);
      const { von, bis, anfragen, raumId } = c.req.valid("query");
      // Zwei Abfragen, unabhängig von der Zahl der Räume (termine/raum.ts: ladeBelegung)
      return c.json(
        await ladeBelegung(db, {
          abteilungId: person.abteilungId,
          von,
          bis,
          mitAnfragen: anfragen === "ja",
          raumId,
          bedingung: raumBedingung(sicht),
        }),
      );
    });
}
