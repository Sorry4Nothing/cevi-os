import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { todoPrivat } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { idempotenzSchluessel } from "../../idempotenz.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const todoPfad = z.strictObject({ id: z.uuid(), todoId: z.uuid() });

export const TODOS_MAX = 200;
const text = z.string().trim().min(1).max(500);
const reihenfolge = z.number().int().min(0).max(100000);
const anlegen = z.strictObject({ text, reihenfolge: reihenfolge.optional() });
const aendern = z
  .strictObject({
    text: text.optional(),
    erledigt: z.boolean().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 0);

const ansicht = (t: typeof todoPrivat.$inferSelect) => ({
  id: t.id,
  text: t.text,
  erledigt: t.erledigt,
  reihenfolge: t.reihenfolge,
});

// Private To-dos (#376): Jede Person im Lager führt ihre eigenen, auch mit der Rolle «lesen»; darum hängt vor den Routen nur die Mitgliedschaft (lagerZugriff ohne Recht). Jede Abfrage filtert auf die Person der Sitzung: Die Lagerleitung und die Abteilungsleitung lesen fremde To-dos nie, und die ID eines fremden To-dos ist unbekannt (404). Kein Sync-Kern und kein Feed, weil kein anderes Gerät als das der Person sie je sehen soll; die Apps laden die Liste beim Öffnen. Jede Anweisung wiederholt dasselbe Ergebnis. Ein abgeschlossenes Lager ist schreibgeschützt (Policy)
export function erstelleTodoRouten({ db }: { db: Db }) {
  const zugriff = lagerZugriff(db);

  return new Hono<LagerEnv>()
    .get("/:id/todos", zugriff, eingabe("param", lagerPfad), async (c) => {
      // Eine Abfrage; die Obergrenze hält die Liste klein, darum kein Seitenwechsel
      const zeilen = await db
        .select()
        .from(todoPrivat)
        .where(
          and(
            eq(todoPrivat.lagerId, c.get("lager").lager.id),
            eq(todoPrivat.personId, c.get("person").id),
          ),
        )
        .orderBy(asc(todoPrivat.reihenfolge), asc(todoPrivat.id))
        .limit(TODOS_MAX);
      return c.json({ todos: zeilen.map(ansicht) });
    })
    .post(
      "/:id/todos",
      zugriff,
      idempotenzSchluessel(db),
      eingabe("param", lagerPfad),
      eingabe("json", anlegen),
      async (c) => {
        const lagerId = c.get("lager").lager.id;
        const personId = c.get("person").id;
        const w = c.req.valid("json");
        // Obergrenze und Einfügen in einer Anweisung: Zwei gleichzeitige Aufrufe überschreiten sie nicht
        const [neu] = await db.execute<{
          id: string;
          text: string;
          erledigt: boolean;
          reihenfolge: number;
        }>(sql`
          insert into todo_privat (lager_id, person_id, text, reihenfolge)
          select ${lagerId}, ${personId}, ${w.text},
            coalesce(${w.reihenfolge ?? null}::int, (select coalesce(max(reihenfolge) + 1, 0) from todo_privat where lager_id = ${lagerId} and person_id = ${personId}))
          where (select count(*) from todo_privat where lager_id = ${lagerId} and person_id = ${personId}) < ${TODOS_MAX}
          returning id, text, erledigt, reihenfolge`);
        if (!neu) {
          return c.json(
            {
              code: "LIMIT_ERREICHT",
              message: "Du hast die höchste Zahl an To-dos erreicht.",
            },
            409,
          );
        }
        return c.json(neu, 201);
      },
    )
    .patch(
      "/:id/todos/:todoId",
      zugriff,
      eingabe("param", todoPfad),
      eingabe("json", aendern),
      async (c) => {
        // Nur die eigene Zeile: Die ID einer fremden Zeile ist unbekannt (404)
        const [zeile] = await db
          .update(todoPrivat)
          .set(c.req.valid("json"))
          .where(
            and(
              eq(todoPrivat.id, c.req.valid("param").todoId),
              eq(todoPrivat.lagerId, c.get("lager").lager.id),
              eq(todoPrivat.personId, c.get("person").id),
            ),
          )
          .returning();
        if (!zeile) throw new HTTPException(404);
        return c.json(ansicht(zeile));
      },
    )
    .delete(
      "/:id/todos/:todoId",
      zugriff,
      eingabe("param", todoPfad),
      async (c) => {
        const geloescht = await db
          .delete(todoPrivat)
          .where(
            and(
              eq(todoPrivat.id, c.req.valid("param").todoId),
              eq(todoPrivat.lagerId, c.get("lager").lager.id),
              eq(todoPrivat.personId, c.get("person").id),
            ),
          )
          .returning({ id: todoPrivat.id });
        if (geloescht.length === 0) throw new HTTPException(404);
        return c.body(null, 204);
      },
    );
}
