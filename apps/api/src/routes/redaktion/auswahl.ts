import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { personTag, tag, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { aktivesKonto, type Person } from "../../rechte.js";
import { hatWebsiteZugang } from "../../website/seiten.js";

// Auswahllisten für den Editor (#353): nur was eine Auswahl braucht. Nie Telefon, E-Mail, Benutzername oder Rolle des Kontos.
// Beide Listen sind auf die Abteilung der Person gefiltert; ein fremder oder unbekannter Tag ist 404.
export function erstelleAuswahlRouten({ db }: { db: Db }) {
  const zugang = async (person: Person) => {
    if (!(await hatWebsiteZugang(db, person))) throw new HTTPException(403);
  };

  return new Hono<{ Variables: { person: Person } }>()
    .get("/tags", async (c) => {
      const person = c.get("person");
      await zugang(person);
      const tags = await db
        .select({ id: tag.id, name: tag.name, typ: tag.typ })
        .from(tag)
        .where(eq(tag.abteilungId, person.abteilungId))
        .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id));
      return c.json({ tags });
    })
    .get(
      "/personen",
      eingabe("query", z.strictObject({ tag: z.uuid() })),
      async (c) => {
        const person = c.get("person");
        await zugang(person);
        const { tag: tagId } = c.req.valid("query");
        const [ziel] = await db
          .select({ id: tag.id })
          .from(tag)
          .where(
            and(eq(tag.id, tagId), eq(tag.abteilungId, person.abteilungId)),
          );
        if (!ziel) throw new HTTPException(404);
        // Der Cevi-Name zuerst, sonst der Name des Kontos; die Funktion ist die Rolle am Tag, nicht die des Kontos
        const personen = await db
          .select({
            id: user.id,
            anzeigename: sql<string>`coalesce(${user.ceviName}, ${user.name})`,
            funktion: personTag.rolle,
            // Nur freigegebene Personen erscheinen im Baustein «personen» (#560)
            websiteFreigabe: sql<boolean>`${user.websiteFreigabeAm} is not null`,
          })
          .from(personTag)
          .innerJoin(user, eq(user.id, personTag.userId))
          .where(
            and(eq(personTag.tagId, ziel.id), aktivesKonto(person.abteilungId)),
          )
          .orderBy(asc(personTag.prioritaet), asc(user.name), asc(user.id));
        return c.json({ personen });
      },
    );
}
