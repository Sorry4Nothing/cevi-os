import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { ladeWetter } from "../../lager/wetter.js";
import type { Wetterdienst } from "../../lager/wetter-openmeteo.js";

const lagerPfad = z.strictObject({ id: z.uuid() });

// Wetter des Lagers (#391), Beschreibung in lager/wetter.ts. Lesen braucht wetter.lesen. Den Ort setzt niemand: Der Server bestimmt ihn aus dem Lagerort (#694), eine Route zum Setzen gibt es nicht
export function erstelleWetterRouten({
  db,
  wetter,
}: {
  db: Db;
  wetter: Wetterdienst;
}) {
  return new Hono<LagerEnv>().get(
    "/:id/wetter",
    lagerZugriff(db, { recht: "wetter.lesen" }),
    eingabe("param", lagerPfad),
    async (c) => c.json(await ladeWetter(db, c.get("lager").lager, wetter)),
  );
}
