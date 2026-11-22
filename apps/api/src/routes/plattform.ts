import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  BEREICHE,
  type Schalter,
  type SchalterArt,
  type SchalterZustand,
} from "../bereichsschalter.js";
import type { Db } from "../db/client.js";
import { auditLog, bereichsschalter } from "../db/schema.js";
import { eingabe } from "../eingabe.js";
import { hatPlattformRecht, istEntwickler } from "../plattform.js";
import { zweiterFaktorFehlt, type Person } from "../rechte.js";

// Wartungsmodus (#424) und Informationssperre (#425): schalten, aufheben, Zustand lesen. Die Routen liegen unter /api/v1/plattform und nicht unter /admin, weil auch Entwickler und Webmaster ohne Verwaltungskonto hier schalten; weder Wartung noch Sperre treffen diesen Pfad.
// Wer schaltet (Entscheid vom 22.11.2026): Entwickler und Abteilungsleitung jeden Bereich; weitere Rollen nur die Wartung der Website und nur mit dem Recht «wartungsmodus.website». Jede Schaltung braucht den zweiten Faktor, wie jedes erweiterte Recht.
// Art und Bereich stehen im Body (PUT) und in der Query (DELETE), nicht im Pfad: Der Schalter gehört der Abteilung der Sitzung, es gibt kein fremdes Objekt, das ein Pfad nennen könnte.

// Heute nur die Wartung; die Sperre folgt mit #425
const SCHALTBAR = ["wartung"] as const;
const zielSchema = {
  art: z.enum(SCHALTBAR),
  bereich: z.enum(BEREICHE),
};
const loeschenSchema = z.strictObject(zielSchema);
const setzenSchema = z.strictObject({
  ...zielSchema,
  hinweis: z.string().trim().min(1).max(500).nullable().optional(),
  ende: z.iso.datetime({ offset: true }).nullable().optional(),
});

type Env = { Variables: { person: Person } };

const alsAntwort = (s: Schalter) => ({
  art: s.art,
  bereich: s.bereich,
  hinweis: s.hinweis,
  ende: s.ende?.toISOString() ?? null,
  ausgeloestVon: s.ausgeloestVon,
  ausgeloestAm: s.ausgeloestAm.toISOString(),
});

export function erstellePlattformRouten({
  db,
  zustand,
}: {
  db: Db;
  zustand: SchalterZustand;
}) {
  // Darf diese Person genau diesen Schalter lesen und schalten? Entwickler und Abteilungsleitung alle, andere Rollen nur die Wartung der Website mit ihrem Recht
  async function darf(person: Person, art: SchalterArt, bereich: string) {
    if (person.admin || (await istEntwickler(db, person))) return true;
    return (
      art === "wartung" &&
      bereich === "website" &&
      (await hatPlattformRecht(db, person, "wartungsmodus.website"))
    );
  }

  // Vor jeder Prüfung des Inhalts: Wer gar nichts schalten darf, erfährt nichts über Eingabe oder Zustand; der zweite Faktor gilt für jede Route hier
  const berechtigt = createMiddleware<Env>(async (c, next) => {
    const person = c.get("person");
    if (!(await darf(person, "wartung", "website"))) {
      throw new HTTPException(403);
    }
    if (!person.zweiterFaktor) {
      return c.json(
        zweiterFaktorFehlt(
          "Für diese Schaltung braucht es den zweiten Faktor.",
        ),
        403,
      );
    }
    await next();
  });

  return new Hono<Env>()
    .get("/schalter", berechtigt, async (c) => {
      const person = c.get("person");
      // Aus dem Speicher, ohne Datenbank; wer nur die Wartung der Website darf, sieht nur diese
      const sichtbar = [];
      for (const s of zustand.vonAbteilung(person.abteilungId)) {
        if (await darf(person, s.art, s.bereich)) sichtbar.push(s);
      }
      // Die Bereiche, die die Person schalten darf: Die Verwaltung zeigt nur diese Zeilen
      const bereiche = [];
      for (const b of BEREICHE) {
        if (await darf(person, "wartung", b)) bereiche.push(b);
      }
      return c.json({ schalter: sichtbar.map(alsAntwort), bereiche });
    })
    .put("/schalter", berechtigt, eingabe("json", setzenSchema), async (c) => {
      const person = c.get("person");
      const { art, bereich, ...eingang } = c.req.valid("json");
      if (!(await darf(person, art, bereich))) {
        throw new HTTPException(403);
      }
      const ende = eingang.ende ? new Date(eingang.ende) : null;
      const zeile = await db.transaction(async (tx) => {
        const [vorher] = await tx
          .select({ id: bereichsschalter.id })
          .from(bereichsschalter)
          .where(
            and(
              eq(bereichsschalter.abteilungId, person.abteilungId),
              eq(bereichsschalter.bereich, bereich),
              eq(bereichsschalter.art, art),
            ),
          );
        const werte = {
          hinweis: eingang.hinweis ?? null,
          ende,
          ausgeloestVon: person.id,
          ausgeloestAm: new Date(),
        };
        const [neu] = await tx
          .insert(bereichsschalter)
          .values({ abteilungId: person.abteilungId, bereich, art, ...werte })
          .onConflictDoUpdate({
            target: [
              bereichsschalter.abteilungId,
              bereichsschalter.bereich,
              bereichsschalter.art,
            ],
            set: werte,
          })
          .returning();
        // Ohne Hinweistext: nur Art, Bereich und Ende
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: vorher ? "schalter_geaendert" : "schalter_gesetzt",
          zielTyp: "bereichsschalter",
          zielId: neu.id,
          details: { art, bereich, ende: ende?.toISOString() ?? null },
        });
        return neu as Schalter;
      });
      // Erst nach dem Commit: Eine zurückgerollte Schaltung gilt nie
      zustand.setze(zeile);
      return c.json(alsAntwort(zeile));
    })
    .delete(
      "/schalter",
      berechtigt,
      eingabe("query", loeschenSchema),
      async (c) => {
        const person = c.get("person");
        const { art, bereich } = c.req.valid("query");
        if (!(await darf(person, art, bereich))) {
          throw new HTTPException(403);
        }
        const geloescht = await db.transaction(async (tx) => {
          const [zeile] = await tx
            .delete(bereichsschalter)
            .where(
              and(
                eq(bereichsschalter.abteilungId, person.abteilungId),
                eq(bereichsschalter.bereich, bereich),
                eq(bereichsschalter.art, art),
              ),
            )
            .returning({ id: bereichsschalter.id });
          if (!zeile) return false;
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "schalter_aufgehoben",
            zielTyp: "bereichsschalter",
            zielId: zeile.id,
            details: { art, bereich },
          });
          return true;
        });
        if (!geloescht) throw new HTTPException(404);
        // Wirkt sofort: die nächste Anfrage sieht den Bereich wieder frei
        zustand.hebeAuf(person.abteilungId, bereich, art);
        return c.body(null, 204);
      },
    );
}
