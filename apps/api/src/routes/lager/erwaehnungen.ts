import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { ERWAEHNUNG_QUELLE } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import {
  alsAufgabe,
  erledigtSetzen,
  erwaehnungenAbfrage,
  gleicheErwaehnungenAb,
  ladeErwaehnungen,
  schreibRecht,
  SCHREIB_RECHTE,
  setzeErledigt,
} from "../../lager/erwaehnungen.js";
import { darf, lagerZugriff, type LagerEnv } from "../../lager/policy.js";
import type { Fcm } from "../../push.js";

const lagerPfad = z.strictObject({ id: z.uuid() });
const quellePfad = z.strictObject({
  id: z.uuid(),
  typ: z.enum(ERWAEHNUNG_QUELLE),
  quelleId: z.uuid(),
});
const erwaehnungPfad = z.strictObject({
  id: z.uuid(),
  erwaehnungId: z.uuid(),
});

const FEHLER_TEXT = {
  ERWAEHNUNG_UNGUELTIG:
    "Eine erwähnte Person ist nicht im Lager oder darf diesen Inhalt nicht sehen.",
  ZU_VIELE_MARKEN: "Ein Inhalt kann höchstens 10 Personen erwähnen.",
} as const;

// Erwähnungen im Lager (#380), Beschreibung in lager/erwaehnungen.ts. Die Liste, «erledigt» und «Als Aufgabe» betreffen immer nur die eigenen Erwähnungen der Person (eine fremde ist 404); den Abgleich ruft die App nach dem Speichern eines Inhalts mit Marken. Der Push nennt nie den Inhalt
export function erstelleErwaehnungenRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  const mitglied = lagerZugriff(db);
  // Wer irgendeinen der vier Inhalte schreiben darf; welcher es ist, prüft die Route nach der Inhaltsart
  const abgleichen = lagerZugriff(db, { einesDerRechte: SCHREIB_RECHTE });
  const aufgabeAnlegen = lagerZugriff(db, {
    einesDerRechte: ["aufgaben.bearbeiten", "aufgaben.eigene"],
  });

  return new Hono<LagerEnv>()
    .get(
      "/:id/erwaehnungen",
      mitglied,
      eingabe("param", lagerPfad),
      eingabe("query", erwaehnungenAbfrage),
      async (c) => {
        const { eintraege, naechster } = await ladeErwaehnungen(
          db,
          c.get("lager"),
          c.req.valid("query"),
        );
        return c.json({ erwaehnungen: eintraege, naechster });
      },
    )
    .put(
      "/:id/erwaehnungen/:typ/:quelleId",
      abgleichen,
      eingabe("param", quellePfad),
      async (c) => {
        const zugriff = c.get("lager");
        const { typ, quelleId } = c.req.valid("param");
        if (!darf(zugriff, schreibRecht(typ))) throw new HTTPException(403);
        const ergebnis = await db.transaction((tx) =>
          gleicheErwaehnungenAb(tx, zugriff, typ, quelleId),
        );
        if ("fehler" in ergebnis) {
          return c.json(
            { code: ergebnis.fehler, message: FEHLER_TEXT[ergebnis.fehler] },
            400,
          );
        }
        await ergebnis.zustellung.senden({ db, fcm, c });
        return c.json({ personIds: ergebnis.personIds, neu: ergebnis.neu });
      },
    )
    .patch(
      "/:id/erwaehnungen/:erwaehnungId",
      mitglied,
      eingabe("param", erwaehnungPfad),
      eingabe("json", erledigtSetzen),
      async (c) => {
        const zugriff = c.get("lager");
        const { erwaehnungId } = c.req.valid("param");
        const { erledigt } = c.req.valid("json");
        // Nur die eigene und nur, solange die Person den Inhalt sieht; sonst dasselbe 404
        const [alt] = (
          await ladeErwaehnungen(db, zugriff, { id: erwaehnungId })
        ).eintraege;
        if (!alt) throw new HTTPException(404);
        await setzeErledigt(db, zugriff, erwaehnungId, erledigt);
        return c.json({ ...alt, erledigt });
      },
    )
    .post(
      "/:id/erwaehnungen/:erwaehnungId/als-aufgabe",
      aufgabeAnlegen,
      eingabe("param", erwaehnungPfad),
      async (c) => {
        const zugriff = c.get("lager");
        const { erwaehnungId } = c.req.valid("param");
        const [e] = (await ladeErwaehnungen(db, zugriff, { id: erwaehnungId }))
          .eintraege;
        if (!e) throw new HTTPException(404);
        const ergebnis = await db.transaction((tx) =>
          alsAufgabe(
            tx,
            { lagerId: zugriff.lager.id, personId: zugriff.personId },
            e,
          ),
        );
        return c.json(
          { aufgabeId: ergebnis.aufgabeId },
          ergebnis.neu ? 201 : 200,
        );
      },
    );
}
