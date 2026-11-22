import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { OBJEKT_TYPEN } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import { auditLog, bearbeiter, tag, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";

// Ohne objektId gilt das Recht für alle Objekte des Typs: «Redaktion» ist objektTyp «seite» ohne objektId. Genau eines von userId und tagId
const setzenSchema = z
  .strictObject({
    objektTyp: z.enum(OBJEKT_TYPEN),
    objektId: z.uuid().nullable().optional(),
    userId: z.uuid().optional(),
    tagId: z.uuid().optional(),
  })
  .refine((f) => (f.userId === undefined) !== (f.tagId === undefined));
const pfad = () => z.strictObject({ id: z.uuid() });

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

export function erstelleBearbeiterRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const zeilen = await db
        .select({
          id: bearbeiter.id,
          objektTyp: bearbeiter.objektTyp,
          objektId: bearbeiter.objektId,
          userId: bearbeiter.userId,
          tagId: bearbeiter.tagId,
        })
        .from(bearbeiter)
        .where(eq(bearbeiter.abteilungId, person.abteilungId))
        .orderBy(
          asc(bearbeiter.objektTyp),
          asc(bearbeiter.erstelltAm),
          asc(bearbeiter.id),
        );
      return c.json({ bearbeiter: zeilen });
    })
    .post("/", eingabe("json", setzenSchema), async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const { objektTyp, objektId, userId, tagId } = c.req.valid("json");
      // Person oder Tag einer anderen Abteilung ist für diese Route unbekannt
      const [ziel] = userId
        ? await db
            .select({ id: user.id })
            .from(user)
            .where(
              and(
                eq(user.id, userId),
                eq(user.abteilungId, person.abteilungId),
              ),
            )
        : await db
            .select({ id: tag.id })
            .from(tag)
            .where(
              and(eq(tag.id, tagId!), eq(tag.abteilungId, person.abteilungId)),
            );
      if (!ziel) throw new HTTPException(404);
      try {
        const neu = await db.transaction(async (tx) => {
          const [zeile] = await tx
            .insert(bearbeiter)
            .values({
              abteilungId: person.abteilungId,
              objektTyp,
              objektId: objektId ?? null,
              userId: userId ?? null,
              tagId: tagId ?? null,
            })
            .returning({ id: bearbeiter.id });
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "bearbeiter_gesetzt",
            zielTyp: "bearbeiter",
            zielId: zeile.id,
            details: {
              objektTyp,
              objektId: objektId ?? null,
              userId: userId ?? null,
              tagId: tagId ?? null,
            },
          });
          return zeile;
        });
        return c.json({ id: neu.id }, 201);
      } catch (fehler) {
        if (pgCode(fehler) === "23505") {
          return c.json(
            {
              code: "BEARBEITER_VORHANDEN",
              message: "Dieses Recht ist schon vergeben.",
            },
            409,
          );
        }
        throw fehler;
      }
    })
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      // In SQL auf die Abteilung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
      const [ziel] = await db
        .select({
          objektTyp: bearbeiter.objektTyp,
          objektId: bearbeiter.objektId,
          userId: bearbeiter.userId,
          tagId: bearbeiter.tagId,
        })
        .from(bearbeiter)
        .where(
          and(
            eq(bearbeiter.id, id),
            eq(bearbeiter.abteilungId, person.abteilungId),
          ),
        );
      if (!ziel) throw new HTTPException(404);
      if (!person.admin) throw new HTTPException(403);
      await db.transaction(async (tx) => {
        // Ein gleichzeitiger Entzug hat die Zeile schon entfernt
        const entfernt = await tx
          .delete(bearbeiter)
          .where(eq(bearbeiter.id, id))
          .returning({ id: bearbeiter.id });
        if (entfernt.length === 0) throw new HTTPException(404);
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "bearbeiter_entzogen",
          zielTyp: "bearbeiter",
          zielId: id,
          details: ziel,
        });
      });
      return c.body(null, 204);
    });
}
