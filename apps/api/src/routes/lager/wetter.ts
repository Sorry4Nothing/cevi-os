import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, lager } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { ladeWetter, ortSetzen, rundeOrt } from "../../lager/wetter.js";
import type { WetterHolen } from "../../lager/wetter-openmeteo.js";

const lagerPfad = z.strictObject({ id: z.uuid() });

// Wetter des Lagers (#391), Beschreibung in lager/wetter.ts. Lesen braucht wetter.lesen. Den Ort setzt nur die Lagerleitung (fest, wie die Rechte); ein Ort ohne Wert schaltet das Wetter aus
export function erstelleWetterRouten({
  db,
  wetter,
}: {
  db: Db;
  wetter: WetterHolen;
}) {
  return new Hono<LagerEnv>()
    .get(
      "/:id/wetter",
      lagerZugriff(db, { recht: "wetter.lesen" }),
      eingabe("param", lagerPfad),
      async (c) => c.json(await ladeWetter(db, c.get("lager").lager, wetter)),
    )
    .put(
      "/:id/wetter/ort",
      lagerZugriff(db, { nurLagerleitung: true }),
      eingabe("param", lagerPfad),
      eingabe("json", ortSetzen),
      async (c) => {
        const person = c.get("person");
        const lagerId = c.get("lager").lager.id;
        const { breite, laenge } = c.req.valid("json");
        const ort =
          breite === null || laenge === null
            ? { breite: null, laenge: null }
            : { breite: rundeOrt(breite), laenge: rundeOrt(laenge) };
        await db.transaction(async (tx) => {
          await tx.update(lager).set(ort).where(eq(lager.id, lagerId));
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "lager_wetter_ort",
            zielTyp: "lager",
            zielId: lagerId,
            details: { gesetzt: ort.breite !== null },
          });
        });
        return c.json(ort);
      },
    );
}
