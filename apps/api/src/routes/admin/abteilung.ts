import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { abteilung, auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";

// Leerer Text löscht den Eintrag
export const VERTRAUENSPERSONEN_MAX = 2000;
const aendernSchema = z.strictObject({
  vertrauenspersonen: z.string().trim().max(VERTRAUENSPERSONEN_MAX),
});

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleAbteilungRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>().patch(
    "/",
    eingabe("json", aendernSchema),
    async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const neu = c.req.valid("json").vertrauenspersonen || null;
      await db.transaction(async (tx) => {
        const [bisher] = await tx
          .select({ text: abteilung.vertrauenspersonen })
          .from(abteilung)
          .where(eq(abteilung.id, person.abteilungId))
          .for("no key update");
        if (!bisher) throw new HTTPException(404);
        // Ein No-op schreibt keinen Eintrag
        if (bisher.text === neu) return;
        await tx
          .update(abteilung)
          .set({ vertrauenspersonen: neu })
          .where(eq(abteilung.id, person.abteilungId));
        // Der Text enthält Namen und Kontaktdaten, darum nur, ob er gesetzt ist
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "vertrauenspersonen_geaendert",
          zielTyp: "abteilung",
          zielId: person.abteilungId,
          details: { gesetzt: neu !== null },
        });
      });
      return c.body(null, 204);
    },
  );
}
