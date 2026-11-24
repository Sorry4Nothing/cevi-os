import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { eingabe } from "../../eingabe.js";
import {
  beitragLesbar,
  ladeBeitragZeile,
  versionAbfrage,
} from "../../lager/pinnwand.js";
import {
  darf,
  lagerZugriff,
  type LagerEnv,
  type LagerZugriff,
} from "../../lager/policy.js";
import {
  aendereUmfrage,
  ladeUmfragen,
  legeUmfrageAn,
  loescheStimmen,
  loescheUmfrage,
  setzeStimmen,
  stimmeSetzen,
  umfrageAendern,
  umfrageAnlegen,
} from "../../lager/umfragen.js";

const beitragPfad = z.strictObject({ id: z.uuid(), beitragId: z.uuid() });

// Umfragen an Pinnwand-Beiträgen (#382), Beschreibung in lager/umfragen.ts. Anlegen, ändern und löschen braucht pinnwand.bearbeiten; Abstimmen interaktion.schreiben und zugleich pinnwand.lesen, dazu muss die Person den Beitrag lesen dürfen (sonst 404). Gelesen werden Umfragen mit dem Beitrag (GET /lager/{id}/pinnwand), die Antworten dieser Routen liefern dieselbe Ansicht
export function erstelleUmfragenRouten({ db }: { db: Db }) {
  const verwalten = lagerZugriff(db, { recht: "pinnwand.bearbeiten" });
  const abstimmen = lagerZugriff(db, { recht: "interaktion.schreiben" });
  const ansicht = async (zugriff: LagerZugriff, beitragId: string) => {
    const u = (await ladeUmfragen(db, zugriff, [beitragId])).get(beitragId);
    if (!u) throw new HTTPException(404);
    return u;
  };

  return new Hono<LagerEnv>()
    .post(
      "/:id/pinnwand/:beitragId/umfrage",
      verwalten,
      eingabe("param", beitragPfad),
      eingabe("json", umfrageAnlegen),
      async (c) => {
        const k = {
          lagerId: c.get("lager").lager.id,
          personId: c.get("person").id,
        };
        const { beitragId } = c.req.valid("param");
        if (!(await ladeBeitragZeile(db, k.lagerId, beitragId))) {
          throw new HTTPException(404);
        }
        await legeUmfrageAn(db, k, beitragId, c.req.valid("json"));
        return c.json(await ansicht(c.get("lager"), beitragId), 201);
      },
    )
    .patch(
      "/:id/pinnwand/:beitragId/umfrage",
      verwalten,
      eingabe("param", beitragPfad),
      eingabe("json", umfrageAendern),
      async (c) => {
        const k = {
          lagerId: c.get("lager").lager.id,
          personId: c.get("person").id,
        };
        const { beitragId } = c.req.valid("param");
        if (!(await ladeBeitragZeile(db, k.lagerId, beitragId))) {
          throw new HTTPException(404);
        }
        await aendereUmfrage(db, k, beitragId, c.req.valid("json"));
        return c.json(await ansicht(c.get("lager"), beitragId));
      },
    )
    .delete(
      "/:id/pinnwand/:beitragId/umfrage",
      verwalten,
      eingabe("param", beitragPfad),
      eingabe("query", versionAbfrage),
      async (c) => {
        const k = {
          lagerId: c.get("lager").lager.id,
          personId: c.get("person").id,
        };
        const { beitragId } = c.req.valid("param");
        if (!(await ladeBeitragZeile(db, k.lagerId, beitragId))) {
          throw new HTTPException(404);
        }
        await loescheUmfrage(db, k, beitragId, c.req.valid("query").version);
        return c.body(null, 204);
      },
    )
    .put(
      "/:id/pinnwand/:beitragId/umfrage/stimme",
      abstimmen,
      eingabe("param", beitragPfad),
      eingabe("json", stimmeSetzen),
      async (c) => {
        const zugriff = c.get("lager");
        if (!darf(zugriff, "pinnwand.lesen")) throw new HTTPException(403);
        const { beitragId } = c.req.valid("param");
        // Sichtbarkeit folgt dem Beitrag: Wer ihn nicht lesen darf, kennt ihn nicht
        if (!(await beitragLesbar(db, zugriff, beitragId))) {
          throw new HTTPException(404);
        }
        const k = { lagerId: zugriff.lager.id, personId: c.get("person").id };
        const r = await setzeStimmen(
          db,
          k,
          beitragId,
          c.req.valid("json").optionIds,
        );
        if (r.status !== 200) {
          return c.json({ code: r.code, message: r.message }, r.status);
        }
        return c.json(await ansicht(c.get("lager"), beitragId));
      },
    )
    .delete(
      "/:id/pinnwand/:beitragId/umfrage/stimme",
      abstimmen,
      eingabe("param", beitragPfad),
      async (c) => {
        const zugriff = c.get("lager");
        if (!darf(zugriff, "pinnwand.lesen")) throw new HTTPException(403);
        const { beitragId } = c.req.valid("param");
        if (!(await beitragLesbar(db, zugriff, beitragId))) {
          throw new HTTPException(404);
        }
        const k = { lagerId: zugriff.lager.id, personId: c.get("person").id };
        const r = await loescheStimmen(db, k, beitragId);
        if (r.status !== 204) {
          return c.json({ code: r.code, message: r.message }, r.status);
        }
        return c.body(null, 204);
      },
    );
}
