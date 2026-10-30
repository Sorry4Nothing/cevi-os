import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { blockierung, chat, rolle, user } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { chatMitglieder, type Person } from "../rechte.js";

const pfadSchema = z.strictObject({ userId: z.uuid().toLowerCase() });

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleBlockierungenRouten({ db }: { db: Db }) {
  return (
    new Hono<{ Variables: { person: Person } }>()
      // Die App braucht die Liste, um eine Blockierung aufzuheben: Blockierte Nachrichten stehen nicht mehr im Chat
      .get("/", async (c) => {
        const person = c.get("person");
        const blockiert = await db
          .select({ id: user.id, name: user.name })
          .from(blockierung)
          .innerJoin(user, eq(user.id, blockierung.blockiertId))
          .where(
            and(
              eq(blockierung.userId, person.id),
              eq(user.abteilungId, person.abteilungId),
            ),
          )
          .orderBy(user.name, user.id);
        return c.json({ blockiert });
      })
      // Idempotent. Nur Eltern, die mit der Person einen Gruppenchat teilen (sonst 404, wie ein fremdes Konto); SL sind weder Blockierende noch Blockierte, damit der Kontakt zur Stufenleitung bleibt
      .put("/:userId", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { userId } = c.req.valid("param");
        if (userId === person.id) throw new HTTPException(400);
        const mitglieder = chatMitglieder(db, person.abteilungId);
        const [gemeinsam] = await db
          .select({ chatId: mitglieder.chatId })
          .from(mitglieder)
          .innerJoin(
            chat,
            and(eq(chat.id, mitglieder.chatId), eq(chat.typ, "stufe")),
          )
          .where(inArray(mitglieder.userId, [person.id, userId]))
          .groupBy(mitglieder.chatId)
          .having(sql`count(distinct ${mitglieder.userId}) = 2`)
          .limit(1);
        if (!gemeinsam) throw new HTTPException(404);
        const [sl] = await db
          .select({ userId: rolle.userId })
          .from(rolle)
          .where(
            and(
              inArray(rolle.userId, [person.id, userId]),
              eq(rolle.typ, "stufenleitung"),
            ),
          )
          .limit(1);
        if (sl) throw new HTTPException(403);
        await db
          .insert(blockierung)
          .values({ userId: person.id, blockiertId: userId })
          .onConflictDoNothing();
        return c.body(null, 204);
      })
      // Idempotent und ohne Mitgliedschaftsprüfung: Aufheben geht auch, wenn das Konto den Chat verlassen hat
      .delete("/:userId", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { userId } = c.req.valid("param");
        // Kein Fremdschlüssel sichert die Abteilung der Ziel-ID; fremde und unbekannte IDs sehen gleich aus
        const [ziel] = await db
          .select({ id: user.id })
          .from(user)
          .where(
            and(eq(user.id, userId), eq(user.abteilungId, person.abteilungId)),
          );
        if (!ziel) throw new HTTPException(404);
        await db
          .delete(blockierung)
          .where(
            and(
              eq(blockierung.userId, person.id),
              eq(blockierung.blockiertId, userId),
            ),
          );
        return c.body(null, 204);
      })
  );
}
