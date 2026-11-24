import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { lager } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  aendereRechte,
  leseRechte,
  rechteSchema,
  standardEintraege,
} from "../../lager/rechte.js";
import type { Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";
import { antwortAufAenderung } from "../lager/rechte.js";

// Gegenstück der Verwaltung zu /api/v1/lager/{id}/rechte (#365): Rechte der Rollen eines Lagers, nur für die Abteilungsleitung. Reihenfolge wie bei /admin/lager: Pfad (400), Lager der eigenen Abteilung (404), Abteilungsleitung (403), dann der Zustand (409)
const pfad = () => z.strictObject({ id: z.uuid() });

export function erstelleAdminLagerRechteRouten({ db }: { db: Db }) {
  async function ladeLager(person: Person, id: string) {
    const [ziel] = await db
      .select({ id: lager.id })
      .from(lager)
      .where(and(eq(lager.id, id), eq(lager.abteilungId, person.abteilungId)));
    if (!ziel) throw new HTTPException(404);
    await verlange(db, person, "rechte.verwalten");
    return ziel.id;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/:id/rechte", eingabe("param", pfad()), async (c) =>
      c.json(
        await leseRechte(
          db,
          await ladeLager(c.get("person"), c.req.valid("param").id),
        ),
      ),
    )
    .put(
      "/:id/rechte",
      eingabe("param", pfad()),
      eingabe("json", rechteSchema),
      async (c) => {
        const person = c.get("person");
        const id = await ladeLager(person, c.req.valid("param").id);
        return antwortAufAenderung(
          c,
          await aendereRechte(db, person, id, c.req.valid("json").rechte),
        );
      },
    )
    .post("/:id/rechte/zuruecksetzen", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const id = await ladeLager(person, c.req.valid("param").id);
      return antwortAufAenderung(
        c,
        await aendereRechte(db, person, id, standardEintraege()),
      );
    });
}
