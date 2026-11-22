import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, vorlage } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import {
  ladeVorlage,
  VORLAGEN_MAX,
  passtInsLager,
  planAnsicht,
  planeVorlage,
  schreibePlan,
} from "../../lager/vorlagen.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const pfad = z.strictObject({ id: z.uuid(), vorlageId: z.uuid() });
const abfrage = z.strictObject({
  trocken: z
    .enum(["true", "false"])
    .optional()
    .transform((w) => w === "true"),
});

// Vorlage anwenden (#376): legt die Aufgaben oder die Packlisten-Punkte einer Vorlage der eigenen Abteilung im Lager an. Recht vorlagen.anwenden (Standard: nur die Lagerleitung); ein abgeschlossenes Lager ist schreibgeschützt, auch für den Trockenlauf (POST). Die Vorlage der eigenen Abteilung: Eine fremde oder unbekannte ID ist 404. Mit trocken=true schreibt der Aufruf nichts und nennt, was entstünde. Beschreibung des Inhalts: lager/vorlagen.ts
export function erstelleVorlagenAnwendenRouten({ db }: { db: Db }) {
  return (
    new Hono<LagerEnv>()
      // Die Auswahl für «anwenden» (#520): die Vorlagen der Abteilung mit Art, Name und Zahl der Einträge, ohne Inhalt, für wen vorlagen.anwenden hat (nicht nur die Abteilungsleitung wie unter /admin/vorlagen). Eine Abfrage, höchstens VORLAGEN_MAX Zeilen
      .get(
        "/:id/vorlagen",
        lagerZugriff(db, { recht: "vorlagen.anwenden" }),
        eingabe("param", lagerPfad),
        async (c) => {
          const liste = (spalte: string) =>
            sql`case when jsonb_typeof(${vorlage.inhalt} -> ${spalte}) = 'array' then jsonb_array_length(${vorlage.inhalt} -> ${spalte}) else 0 end`;
          const zeilen = await db
            .select({
              id: vorlage.id,
              art: vorlage.art,
              name: vorlage.name,
              anzahl:
                sql<number>`case when ${vorlage.art} = 'aufgaben' then ${liste("aufgaben")} else ${liste("punkte")} end`.mapWith(
                  Number,
                ),
            })
            .from(vorlage)
            .where(eq(vorlage.abteilungId, c.get("lager").lager.abteilungId))
            .orderBy(asc(vorlage.art), asc(vorlage.name), asc(vorlage.id))
            .limit(VORLAGEN_MAX);
          return c.json({ vorlagen: zeilen });
        },
      )
      .post(
        "/:id/vorlagen/:vorlageId/anwenden",
        lagerZugriff(db, { recht: "vorlagen.anwenden" }),
        eingabe("param", pfad),
        eingabe("query", abfrage),
        async (c) => {
          const zugriff = c.get("lager");
          const person = c.get("person");
          const { trocken } = c.req.valid("query");
          const v = await ladeVorlage(
            db,
            zugriff.lager.abteilungId,
            c.req.valid("param").vorlageId,
          );
          if (!v) throw new HTTPException(404);
          const plan = planeVorlage(v, zugriff.lager.von);
          if (!plan) {
            return c.json(
              {
                code: "VORLAGE_UNGUELTIG",
                message: "Der Inhalt der Vorlage ist nicht lesbar.",
              },
              409,
            );
          }
          const zuViel = {
            code: "LIMIT_ERREICHT",
            message:
              "Die Packliste würde die höchste Zahl an Punkten übersteigen.",
          } as const;
          if (trocken) {
            if (!(await passtInsLager(db, zugriff.lager.id, plan))) {
              return c.json(zuViel, 409);
            }
            return c.json({ trocken: true, ...planAnsicht(plan) });
          }
          const geschrieben = await db.transaction(async (tx) => {
            // Prüfen unter der Sperre des Lagers: Zwei gleichzeitige Aufrufe überschreiten die Grenze nicht
            await sperreLager(tx, zugriff.lager.id);
            if (!(await passtInsLager(tx, zugriff.lager.id, plan)))
              return false;
            await schreibePlan(
              tx,
              { lagerId: zugriff.lager.id, personId: person.id },
              plan,
            );
            // Welche Vorlage und wie viele Einträge, nie ein Inhalt
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "vorlage_angewendet",
              zielTyp: "lager",
              zielId: zugriff.lager.id,
              details: { vorlageId: v.id, art: v.art },
            });
            return true;
          });
          if (!geschrieben) return c.json(zuViel, 409);
          return c.json({ trocken: false, ...planAnsicht(plan) }, 201);
        },
      )
  );
}
