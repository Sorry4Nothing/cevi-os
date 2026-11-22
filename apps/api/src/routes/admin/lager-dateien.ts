import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { abteilung, auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { hostSchema, ladeDateiHosts } from "../../lager/datei.js";
import type { Person } from "../../rechte.js";

// Welche Hosts die Links der Dateien im Lager haben dürfen (#370), eine Einstellung der Abteilung. null = keine Einschränkung (Vorgabe); sonst ein Host oder seine Subdomains, zum Beispiel «meineabteilung.sharepoint.com». Nur die Abteilungsleitung. Eine Änderung gilt für neue Links; bestehende bleiben stehen
const hostsSchema = z.strictObject({
  hosts: z.array(hostSchema).min(1).max(20).nullable(),
});

export function erstelleAdminLagerDateiRouten({ db }: { db: Db }) {
  return new Hono<{ Variables: { person: Person } }>()
    .get("/hosts", async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      return c.json({ hosts: await ladeDateiHosts(db, person.abteilungId) });
    })
    .put("/hosts", eingabe("json", hostsSchema), async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const eingegeben = c.req.valid("json").hosts;
      const hosts = eingegeben ? [...new Set(eingegeben)] : null;
      await db.transaction(async (tx) => {
        await tx
          .update(abteilung)
          .set({ dateiHosts: hosts })
          .where(eq(abteilung.id, person.abteilungId));
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "lager_datei_hosts_geaendert",
          zielTyp: "abteilung",
          zielId: person.abteilungId,
          details: { anzahl: hosts?.length ?? null },
        });
      });
      return c.body(null, 204);
    });
}
