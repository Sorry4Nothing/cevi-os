import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { auditLog, meldung, nachricht } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { hatRolle, nachrichtFuerPerson, type Person } from "../rechte.js";

// Begrenzt den Missbrauch der Melde-Funktion: Wer mehr meldet, wartet; echte Fälle sind selten
const MELDUNGEN_PRO_STUNDE = 10;

const pfadSchema = z.strictObject({ id: z.uuid() });

// Auch in den Importen ohne node:* und process: Die App prüft diese Datei über AppType
export function erstelleNachrichtenRouten({ db }: { db: Db }) {
  return (
    new Hono<{ Variables: { person: Person } }>()
      // Eine zweite Ausblendung ändert nichts und steht nicht noch einmal im Audit-Log; die SL sieht die Nachricht dann nicht mehr (404), Admins über die Meldung weiterhin (204)
      .post("/:id/ausblenden", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await nachrichtFuerPerson(db, person, id);
        if (!ziel) throw new HTTPException(404);
        // SL nur im Gruppenchat der eigenen Stufe, nie im Einzelchat; Admins nur gemeldete Nachrichten, auch im Einzelchat
        const alsSl =
          ziel.mitglied &&
          ziel.chatTyp === "stufe" &&
          hatRolle(person, ziel.stufeId, "stufenleitung");
        if (!alsSl && !ziel.gemeldet) throw new HTTPException(403);
        await db.transaction(async (tx) => {
          const [geaendert] = await tx
            .update(nachricht)
            .set({ ausgeblendetVon: person.id, ausgeblendetAm: sql`now()` })
            .where(and(eq(nachricht.id, id), isNull(nachricht.ausgeblendetAm)))
            .returning({ id: nachricht.id });
          if (!geaendert) return;
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "nachricht_ausgeblendet",
            zielTyp: "nachricht",
            zielId: id,
            // Ohne Personendaten: weder Text noch Namen
            details: {
              chatId: ziel.chatId,
              durch: alsSl ? "stufenleitung" : "admin",
            },
          });
        });
        return c.body(null, 204);
      })
      // Idempotent: Dieselbe Person meldet dieselbe Nachricht nur einmal, solange die Meldung offen ist
      .post("/:id/melden", eingabe("param", pfadSchema), async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const ziel = await nachrichtFuerPerson(db, person, id);
        // Nur wer die Nachricht im Chat sieht; ein Admin über eine Meldung nicht
        if (!ziel?.mitglied) throw new HTTPException(404);
        // Die eigene Nachricht lässt sich nur melden, wenn sie ausgeblendet wurde
        if (ziel.autorId === person.id && !ziel.ausgeblendetAm) {
          throw new HTTPException(400);
        }
        await db.transaction(async (tx) => {
          // Sperre pro Person: Gleichzeitige Anfragen zählen sonst alle denselben Stand
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`meldung:${person.id}`}, 0))`,
          );
          const [{ anzahl }] = await tx
            .select({ anzahl: count() })
            .from(meldung)
            .where(
              and(
                eq(meldung.gemeldetVon, person.id),
                gt(meldung.erstelltAm, sql`now() - interval '1 hour'`),
              ),
            );
          if (anzahl >= MELDUNGEN_PRO_STUNDE) throw new HTTPException(429);
          await tx
            .insert(meldung)
            .values({
              abteilungId: person.abteilungId,
              nachrichtId: id,
              textKopie: ziel.text,
              autorId: ziel.autorId,
              gemeldetVon: person.id,
            })
            .onConflictDoNothing();
        });
        return c.body(null, 204);
      })
  );
}
