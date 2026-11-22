import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import {
  aendereRechte,
  leseRechte,
  rechteSchema,
  standardEintraege,
} from "../../lager/rechte.js";

// Antwort auf eine Änderung der Rechte; gleich für die Lager-Route und die Admin-Route (routes/admin/lager-rechte.ts)
export function antwortAufAenderung(
  c: Context,
  ergebnis: Awaited<ReturnType<typeof aendereRechte>>,
) {
  if (ergebnis === "unbekannt") throw new HTTPException(404);
  if (ergebnis === "geschlossen") {
    return c.json(
      {
        code: "LAGER_GESCHLOSSEN",
        message: "Das Lager ist abgeschlossen und lässt sich nicht ändern.",
      },
      409,
    );
  }
  return c.body(null, 204);
}

// Rechte der Rollen eines Lagers (#365). Nur die Lagerleitung und die Abteilungsleitung (gilt als Lagerleitung) lesen und ändern sie; Leitung, Team und Lesen bekommen 403 (Rechteausweitung). Die Rolle «lagerleitung» steht nicht zur Wahl. Eine Änderung wirkt bei der nächsten Anfrage: Die Policy liest die Rechte bei jeder Anfrage aus der Datenbank
export function erstelleLagerRechteRouten({ db }: { db: Db }) {
  const nurLeitung = lagerZugriff(db, { nurLagerleitung: true });
  return new Hono<LagerEnv>()
    .get("/:id/rechte", nurLeitung, async (c) =>
      c.json(await leseRechte(db, c.get("lager").lager.id)),
    )
    .put("/:id/rechte", nurLeitung, eingabe("json", rechteSchema), async (c) =>
      antwortAufAenderung(
        c,
        await aendereRechte(
          db,
          c.get("person"),
          c.get("lager").lager.id,
          c.req.valid("json").rechte,
        ),
      ),
    )
    .post("/:id/rechte/zuruecksetzen", nurLeitung, async (c) =>
      antwortAufAenderung(
        c,
        await aendereRechte(
          db,
          c.get("person"),
          c.get("lager").lager.id,
          standardEintraege(),
        ),
      ),
    );
}
