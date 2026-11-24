import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { versionAbfrage } from "../../lager/ressorts.js";
import {
  aendereBlock,
  aendereSeite,
  blockAendern,
  blockAnlegen,
  FEHLER_TEXT,
  ladeTagesliste,
  ladeTagesseite,
  legeBlockAn,
  legeSeiteAn,
  loescheBlock,
  seiteAendern,
  seiteAnlegen,
  type TagesseiteFehler,
} from "../../lager/tagesseiten.js";
import type { Wetterdienst } from "../../lager/wetter-openmeteo.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const tagPfad = z.strictObject({ id: z.uuid(), lagertagId: z.uuid() });
const blockPfad = z.strictObject({
  id: z.uuid(),
  lagertagId: z.uuid(),
  blockId: z.uuid(),
});

const fehlerAntwort = (fehler: TagesseiteFehler) => {
  const [status, message] = FEHLER_TEXT[fehler];
  return { status: status as 400 | 409, body: { code: fehler, message } };
};

// Tagesseiten (#391), Beschreibung in lager/tagesseiten.ts. Lesen braucht tagesseiten.lesen, jede Änderung tagesseiten.bearbeiten. Der Tag ist ein Lagertag aus dem Zeitplan (#374); eine Seite gibt es erst nach dem ersten Schreiben
export function erstelleTagesseitenRouten({
  db,
  wetter,
}: {
  db: Db;
  wetter: Wetterdienst;
}) {
  const lesen = lagerZugriff(db, { recht: "tagesseiten.lesen" });
  const bearbeiten = lagerZugriff(db, { recht: "tagesseiten.bearbeiten" });

  return new Hono<LagerEnv>()
    .get("/:id/tagesseiten", lesen, eingabe("param", lagerPfad), async (c) =>
      c.json({ tage: await ladeTagesliste(db, c.get("lager").lager.id) }),
    )
    .get(
      "/:id/tagesseiten/:lagertagId",
      lesen,
      eingabe("param", tagPfad),
      async (c) =>
        c.json(
          await ladeTagesseite(
            db,
            c.get("lager"),
            c.req.valid("param").lagertagId,
            wetter,
          ),
        ),
    )
    .post(
      "/:id/tagesseiten/:lagertagId",
      bearbeiten,
      eingabe("param", tagPfad),
      eingabe("json", seiteAnlegen),
      async (c) => {
        const ergebnis = await db.transaction((tx) =>
          legeSeiteAn(
            tx,
            { lagerId: c.get("lager").lager.id, personId: c.get("person").id },
            c.req.valid("param").lagertagId,
            c.req.valid("json"),
          ),
        );
        if ("fehler" in ergebnis) {
          const { status, body } = fehlerAntwort(ergebnis.fehler);
          return c.json(body, status);
        }
        return c.json(ergebnis.seite, 201);
      },
    )
    .patch(
      "/:id/tagesseiten/:lagertagId",
      bearbeiten,
      eingabe("param", tagPfad),
      eingabe("json", seiteAendern),
      async (c) => {
        const ergebnis = await db.transaction((tx) =>
          aendereSeite(
            tx,
            { lagerId: c.get("lager").lager.id, personId: c.get("person").id },
            c.req.valid("param").lagertagId,
            c.req.valid("json"),
          ),
        );
        if ("fehler" in ergebnis) {
          const { status, body } = fehlerAntwort(ergebnis.fehler);
          return c.json(body, status);
        }
        return c.json(ergebnis.seite);
      },
    )
    .post(
      "/:id/tagesseiten/:lagertagId/bloecke",
      bearbeiten,
      eingabe("param", tagPfad),
      eingabe("json", blockAnlegen),
      async (c) => {
        const ergebnis = await db.transaction((tx) =>
          legeBlockAn(
            tx,
            { lagerId: c.get("lager").lager.id, personId: c.get("person").id },
            c.req.valid("param").lagertagId,
            c.req.valid("json"),
          ),
        );
        if ("fehler" in ergebnis) {
          const { status, body } = fehlerAntwort(ergebnis.fehler);
          return c.json(body, status);
        }
        return c.json(ergebnis.block, 201);
      },
    )
    .patch(
      "/:id/tagesseiten/:lagertagId/bloecke/:blockId",
      bearbeiten,
      eingabe("param", blockPfad),
      eingabe("json", blockAendern),
      async (c) => {
        const { lagertagId, blockId } = c.req.valid("param");
        return c.json(
          await db.transaction((tx) =>
            aendereBlock(
              tx,
              {
                lagerId: c.get("lager").lager.id,
                personId: c.get("person").id,
              },
              lagertagId,
              blockId,
              c.req.valid("json"),
            ),
          ),
        );
      },
    )
    .delete(
      "/:id/tagesseiten/:lagertagId/bloecke/:blockId",
      bearbeiten,
      eingabe("param", blockPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const { lagertagId, blockId } = c.req.valid("param");
        await db.transaction((tx) =>
          loescheBlock(
            tx,
            { lagerId: c.get("lager").lager.id, personId: c.get("person").id },
            lagertagId,
            blockId,
            c.req.valid("query").version,
          ),
        );
        return c.body(null, 204);
      },
    );
}
