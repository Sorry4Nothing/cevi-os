import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { stufe } from "../db/schema.js";
import type { Person } from "../rechte.js";

export function erstelleStufenRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    // Alle mit Sitzung: Stufen tragen keine Personendaten, «Stufen wählen» und die Verwaltung brauchen sie
    const stufen = await db
      .select({
        id: stufe.id,
        name: stufe.name,
        kuerzel: stufe.kuerzel,
        reihenfolge: stufe.reihenfolge,
      })
      .from(stufe)
      .where(eq(stufe.abteilungId, person.abteilungId))
      .orderBy(asc(stufe.reihenfolge), asc(stufe.name), asc(stufe.id));
    return c.json({ stufen });
  });
}
