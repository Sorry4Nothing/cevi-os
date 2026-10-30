import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { legeGruppenchatAn } from "../../chat.js";
import { stufe } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";

const name = z.string().trim().min(1).max(100);
const kuerzel = z.string().trim().min(1).max(20);
const reihenfolge = z.int().min(1).max(999);

// Ein Schema pro Route, mit keiner Nicht-Admin-Route geteilt
const anlegenSchema = z.strictObject({ name, kuerzel, reihenfolge });
const aendernSchema = z.strictObject({
  name: name.optional(),
  kuerzel: kuerzel.optional(),
  reihenfolge: reihenfolge.optional(),
});
const pfad = () => z.strictObject({ id: z.uuid() });

export function erstelleAdminStufenRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      // Der Gruppenchat entsteht in derselben Transaktion: Keine Stufe ohne Chat, kein Chat ohne Stufe
      const neu = await db.transaction(async (tx) => {
        const [zeile] = await tx
          .insert(stufe)
          .values({ ...c.req.valid("json"), abteilungId: person.abteilungId })
          .returning({ id: stufe.id });
        await legeGruppenchatAn(tx, {
          abteilungId: person.abteilungId,
          stufeId: zeile.id,
        });
        return zeile;
      });
      return c.json({ id: neu.id }, 201);
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const felder = c.req.valid("json");
        // In SQL auf die Abteilung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
        const [ziel] = await db
          .select({ id: stufe.id })
          .from(stufe)
          .where(
            and(eq(stufe.id, id), eq(stufe.abteilungId, person.abteilungId)),
          );
        if (!ziel) throw new HTTPException(404);
        if (!person.admin) throw new HTTPException(403);
        // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
        if (Object.keys(felder).length > 0) {
          await db.update(stufe).set(felder).where(eq(stufe.id, id));
        }
        return c.body(null, 204);
      },
    );
}
