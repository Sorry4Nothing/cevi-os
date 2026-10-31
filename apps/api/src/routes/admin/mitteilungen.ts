import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  auditLog,
  kind,
  kindEltern,
  rolle,
  stufe,
  user,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { sendePush, type Fcm } from "../../push.js";
import { aktivesKonto, type Person } from "../../rechte.js";

// Höchstens so viele Mitteilungen pro Abteilung und Stunde: Ein gekapertes Konto soll nicht beliebig oft alle Geräte anstossen
const MITTEILUNGEN_PRO_STUNDE = 10;

// Eltern sind die Teilnehmenden: Kinder haben kein Konto
const ROLLEN = ["stufenleitung", "leitung", "eltern"] as const;

// Der Text ist der ganze Push-Titel (kein Textkörper), darum kurz
const sendenSchema = z
  .strictObject({
    titel: z.string().trim().min(1).max(100),
    empfaenger: z.enum(["alle", "stufen"]),
    stufeIds: z.array(z.uuid()).min(1).max(50).optional(),
    rollen: z.array(z.enum(ROLLEN)).min(1).max(ROLLEN.length).optional(),
  })
  .refine((e) => (e.empfaenger === "stufen") === (e.stufeIds !== undefined));

const PUSH_NICHT_EINGERICHTET = {
  code: "PUSH_NICHT_EINGERICHTET",
  message: "Der Push-Dienst ist auf diesem Server nicht eingerichtet.",
} as const;

export function erstelleMitteilungenRouten({ db, fcm }: { db: Db; fcm?: Fcm }) {
  return new Hono<{ Variables: { person: Person } }>().post(
    "/",
    eingabe("json", sendenSchema),
    async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      if (!fcm) return c.json(PUSH_NICHT_EINGERICHTET, 503);
      const {
        titel,
        empfaenger,
        stufeIds: roh,
        rollen: rollenRoh,
      } = c.req.valid("json");
      const stufeIds = [...new Set(roh)];
      // Ohne Angabe gelten alle Rollen, wie vor dem Filter
      const rollen = new Set(rollenRoh ?? ROLLEN);
      const alleRollen = rollen.size === ROLLEN.length;

      // Die Zählung, die Empfängerwahl und der Audit-Eintrag stehen in einer Transaktion unter einer Sperre pro Abteilung: Gleichzeitige Anfragen sehen dasselbe Limit
      const ids = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${person.abteilungId}, 0))`,
        );
        const [{ anzahl: bisher }] = await tx
          .select({ anzahl: count() })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.abteilungId, person.abteilungId),
              eq(auditLog.aktion, "mitteilung_gesendet"),
              gt(auditLog.erstelltAm, sql`now() - interval '1 hour'`),
            ),
          );
        if (bisher >= MITTEILUNGEN_PRO_STUNDE) throw new HTTPException(429);

        // Aktive Konten, die «Mitteilungen» (push_programme) eingeschaltet haben
        const mitOption = and(
          aktivesKonto(person.abteilungId),
          eq(user.pushProgramme, true),
        );
        const empfaengerIds = new Set<string>();
        if (empfaenger === "alle" && alleRollen) {
          const zeilen = await tx
            .select({ id: user.id })
            .from(user)
            .where(mitOption);
          zeilen.forEach((z) => empfaengerIds.add(z.id));
        } else {
          // «alle» mit einem Teil der Rollen: alle Stufen der Abteilung
          // Fremde Stufen und unbekannte IDs wie ungültige Eingaben
          const eigene = await tx
            .select({ id: stufe.id })
            .from(stufe)
            .where(
              and(
                empfaenger === "stufen"
                  ? inArray(stufe.id, stufeIds)
                  : undefined,
                eq(stufe.abteilungId, person.abteilungId),
              ),
            );
          if (empfaenger === "stufen" && eigene.length !== stufeIds.length) {
            throw new HTTPException(400);
          }
          const ziele = eigene.map((s) => s.id);
          if (ziele.length > 0 && rollen.has("eltern")) {
            const eltern = await tx
              .select({ id: user.id })
              .from(kindEltern)
              .innerJoin(
                kind,
                and(eq(kind.id, kindEltern.kindId), isNull(kind.inaktivSeit)),
              )
              .innerJoin(user, and(eq(user.id, kindEltern.userId), mitOption))
              .where(inArray(kind.stufeId, ziele));
            eltern.forEach((z) => empfaengerIds.add(z.id));
          }
          const leitungsTypen = (["leitung", "stufenleitung"] as const).filter(
            (t) => rollen.has(t),
          );
          if (ziele.length > 0 && leitungsTypen.length > 0) {
            const leitende = await tx
              .select({ id: user.id })
              .from(rolle)
              .innerJoin(user, and(eq(user.id, rolle.userId), mitOption))
              .where(
                and(
                  inArray(rolle.stufeId, ziele),
                  inArray(rolle.typ, leitungsTypen),
                ),
              );
            leitende.forEach((z) => empfaengerIds.add(z.id));
          }
          // Die absendende Person bekommt den Push nur bei allen Rollen, sonst wüsste sie nicht, wen er trifft
          if (alleRollen) {
            const absender = await tx
              .select({ id: user.id })
              .from(user)
              .where(and(mitOption, eq(user.id, person.id)));
            absender.forEach((z) => empfaengerIds.add(z.id));
          }
        }

        // Ziel ist die Abteilung (ziel_id ist Pflicht und ohne Fremdschlüssel): Eine Mitteilung gilt ihr, nicht einem einzelnen Objekt. Kein Text, keine Namen; nur die Gruppe und die Zahl
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "mitteilung_gesendet",
          zielTyp: "abteilung",
          zielId: person.abteilungId,
          details: {
            empfaenger,
            ...(empfaenger === "stufen" && { stufeIds }),
            ...(!alleRollen && { rollen: ROLLEN.filter((r) => rollen.has(r)) }),
            anzahl: empfaengerIds.size,
          },
        });
        return [...empfaengerIds];
      });

      // Nach dem Commit: Der Eintrag steht, auch wenn der Versand scheitert (sendePush wirft nie)
      if (ids.length > 0) {
        await sendePush({ db, fcm, c }, ids, {
          typ: "mitteilung",
          id: "",
          titel,
        });
      }
      return c.json({ empfaenger: ids.length });
    },
  );
}
