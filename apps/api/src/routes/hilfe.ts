import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import { abteilung } from "../db/schema.js";
import type { Person } from "../rechte.js";

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleHilfeRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    // Alle angemeldeten Personen der Abteilung dürfen den Text lesen; die Abteilung kommt aus der Sitzung
    const [zeile] = await db
      .select({ vertrauenspersonen: abteilung.vertrauenspersonen })
      .from(abteilung)
      .where(eq(abteilung.id, person.abteilungId));
    if (!zeile) throw new HTTPException(404);
    return c.json({ vertrauenspersonen: zeile.vertrauenspersonen });
  });
}
