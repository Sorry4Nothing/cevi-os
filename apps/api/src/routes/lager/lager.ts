import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { lager, lagerMitglied } from "../../db/schema.js";
import { lagerAnsicht } from "../../lager/ansicht.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";

// Lager der Person (#364). Wer kein Mitglied ist, bekommt das Lager weder in der Liste noch einzeln (404); die Abteilungsleitung sieht jedes Lager der Abteilung
export function erstelleLagerKernRouten({ db }: { db: Db }) {
  return new Hono<LagerEnv>()
    .get("/", async (c) => {
      const person = c.get("person");
      const zeilen = await db
        .select({ lager, rolle: lagerMitglied.rolle })
        .from(lager)
        .leftJoin(
          lagerMitglied,
          and(
            eq(lagerMitglied.lagerId, lager.id),
            eq(lagerMitglied.personId, person.id),
          ),
        )
        .where(
          and(
            eq(lager.abteilungId, person.abteilungId),
            // Ohne Mitgliedschaft nur die Abteilungsleitung
            person.admin ? undefined : isNotNull(lagerMitglied.personId),
          ),
        )
        .orderBy(desc(lager.von), asc(lager.id));
      return c.json({
        lager: zeilen.map((z) => ({
          ...lagerAnsicht(z.lager),
          rolle: person.admin ? "lagerleitung" : z.rolle,
        })),
      });
    })
    .get("/:id", lagerZugriff(db), (c) => {
      const zugriff = c.get("lager");
      return c.json({
        ...lagerAnsicht(zugriff.lager),
        rolle: zugriff.rolle,
        schreibgeschuetzt: zugriff.geschlossen,
      });
    });
}
