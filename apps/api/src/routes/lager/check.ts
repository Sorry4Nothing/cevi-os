import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  aenderePunkt,
  ladeCheck,
  ladePunkte,
  legePunktAn,
  loeschePunkt,
  MAX_PUNKTE,
  punktAendern,
  punktAnlegen,
} from "../../lager/check.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { versionAbfrage } from "../../lager/ressorts.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const punktPfad = z.strictObject({ id: z.uuid(), punktId: z.uuid() });

// Lager-Check (#377), Beschreibung in lager/check.ts. Lesen braucht check.lesen. Die eigenen Punkte ändert, wer zeitplan.bearbeiten hat (Standard: Lagerleitung) und den Check lesen darf: Wer ihn nicht lesen darf, schreibt keine Punkte, die er nicht sieht. jetzt spritzt die Fabrik ein (Tests: feste Zeit)
export function erstelleCheckRouten({
  db,
  jetzt,
}: {
  db: Db;
  jetzt: () => Date;
}) {
  const lesen = lagerZugriff(db, { recht: "check.lesen" });
  const bearbeiten = lagerZugriff(db, {
    recht: "zeitplan.bearbeiten",
    einesDerRechte: ["check.lesen"],
  });

  return new Hono<LagerEnv>()
    .get("/:id/check", lesen, eingabe("param", lagerPfad), async (c) =>
      c.json(await ladeCheck(db, c.get("lager"), jetzt())),
    )
    .get("/:id/check/punkte", lesen, eingabe("param", lagerPfad), async (c) =>
      c.json({ punkte: await ladePunkte(db, c.get("lager").lager.id) }),
    )
    .post(
      "/:id/check/punkte",
      bearbeiten,
      eingabe("param", lagerPfad),
      eingabe("json", punktAnlegen),
      async (c) => {
        const ergebnis = await db.transaction((tx) =>
          legePunktAn(
            tx,
            { lagerId: c.get("lager").lager.id, personId: c.get("person").id },
            c.req.valid("json"),
          ),
        );
        if ("fehler" in ergebnis) {
          return c.json(
            {
              code: ergebnis.fehler,
              message: `Es sind höchstens ${MAX_PUNKTE} eigene Check-Punkte möglich.`,
            },
            409,
          );
        }
        return c.json(ergebnis.punkt, 201);
      },
    )
    .patch(
      "/:id/check/punkte/:punktId",
      bearbeiten,
      eingabe("param", punktPfad),
      eingabe("json", punktAendern),
      async (c) =>
        c.json(
          await db.transaction((tx) =>
            aenderePunkt(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              c.req.valid("param").punktId,
              c.req.valid("json"),
            ),
          ),
        ),
    )
    .delete(
      "/:id/check/punkte/:punktId",
      bearbeiten,
      eingabe("param", punktPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        await db.transaction((tx) =>
          loeschePunkt(
            tx,
            { lagerId: c.get("lager").lager.id, personId: c.get("person").id },
            c.req.valid("param").punktId,
            c.req.valid("query").version,
          ),
        );
        return c.body(null, 204);
      },
    );
}
