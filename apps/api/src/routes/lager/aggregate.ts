import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  darfStart,
  ladeHeute,
  ladeMeineWoche,
  ladeStart,
  ladeWidget,
} from "../../lager/aggregate.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import type { Wetterdienst } from "../../lager/wetter-openmeteo.js";

const lagerPfad = z.strictObject({ id: z.uuid() });

// Aggregate «Heute», «Meine Woche» und Start der Lagerleitung (#395), Beschreibung in lager/aggregate.ts. Nur lesend: ohne eigenes Recht, jeder Teil folgt dem Leserecht seiner Quelle; fehlt der Rolle jeder Teil, ist es 403. jetzt und wetter spritzt die Fabrik ein (Tests: feste Zeit, keine Abrufe ins Netz)
export function erstelleAggregateRouten({
  db,
  wetter,
  jetzt,
}: {
  db: Db;
  wetter: Wetterdienst;
  jetzt: () => Date;
}) {
  const zugriff = lagerZugriff(db);

  return (
    new Hono<LagerEnv>()
      .get("/:id/heute", zugriff, eingabe("param", lagerPfad), async (c) => {
        const antwort = await ladeHeute(db, c.get("lager"), jetzt(), wetter);
        if (!antwort) throw new HTTPException(403);
        return c.json(antwort);
      })
      .get(
        "/:id/meine-woche",
        zugriff,
        eingabe("param", lagerPfad),
        async (c) => {
          const antwort = await ladeMeineWoche(db, c.get("lager"), jetzt());
          if (!antwort) throw new HTTPException(403);
          return c.json(antwort);
        },
      )
      .get("/:id/start", zugriff, eingabe("param", lagerPfad), async (c) => {
        if (!darfStart(c.get("lager"))) throw new HTTPException(403);
        return c.json(await ladeStart(db, c.get("lager"), jetzt()));
      })
      // Kompakter Stand für die Widgets (#848): nur Zahlen, jeder Teil mit dem Leserecht seiner Quelle
      .get("/:id/widget", zugriff, eingabe("param", lagerPfad), async (c) =>
        c.json(await ladeWidget(db, c.get("lager"), jetzt())),
      )
  );
}
