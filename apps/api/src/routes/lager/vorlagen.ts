import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import { sperreLager } from "../../lager/ressorts.js";
import {
  ladeVorlage,
  passtInsLager,
  planAnsicht,
  planeVorlage,
  schreibePlan,
} from "../../lager/vorlagen.js";

const pfad = z.strictObject({ id: z.uuid(), vorlageId: z.uuid() });
const abfrage = z.strictObject({
  trocken: z
    .enum(["true", "false"])
    .optional()
    .transform((w) => w === "true"),
});

// Vorlage anwenden (#376): legt die Aufgaben oder die Packlisten-Punkte einer Vorlage der eigenen Abteilung im Lager an. Recht vorlagen.anwenden (Standard: nur die Lagerleitung); ein abgeschlossenes Lager ist schreibgeschützt, auch für den Trockenlauf (POST). Die Vorlage der eigenen Abteilung: Eine fremde oder unbekannte ID ist 404. Mit trocken=true schreibt der Aufruf nichts und nennt, was entstünde. Beschreibung des Inhalts: lager/vorlagen.ts
export function erstelleVorlagenAnwendenRouten({ db }: { db: Db }) {
  return new Hono<LagerEnv>().post(
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
        message: "Die Packliste würde die höchste Zahl an Punkten übersteigen.",
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
        if (!(await passtInsLager(tx, zugriff.lager.id, plan))) return false;
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
  );
}
