import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, vorlage } from "../../db/schema.js";
import { VORLAGE_ARTEN } from "../../db/schema-lager-vorlagen.js";
import { eingabe } from "../../eingabe.js";
import {
  INHALT_SCHEMA,
  ladeVorlage,
  vorlageAnsicht,
  vorlageUebersicht,
  VORLAGEN_MAX,
} from "../../lager/vorlagen.js";
import type { Person } from "../../rechte.js";
import { verlange } from "../../rechtemodell/darf.js";

// Admin-Routen für Vorlagen (#376): Aufgaben- und Packlisten-Vorlagen der Abteilung. Nur die Abteilungsleitung (403), die Vorlage der eigenen Abteilung (fremd oder unbekannt 404, vor dem Recht). Die Lagerleitung wendet eine Vorlage im Lager an (POST /lager/{id}/vorlagen/{vorlageId}/anwenden), ändert sie aber nicht. Inhalt und Fristen: lager/vorlagen.ts. Das Audit-Log nennt Vorlage und Art, nie den Inhalt
const name = z.string().trim().min(1).max(100);
const art = z.enum(VORLAGE_ARTEN);
const inhalt = z.record(z.string(), z.unknown());
const pfad = z.strictObject({ id: z.uuid() });
const liste = z.strictObject({ art: art.optional() });
const anlegen = z
  .strictObject({ art, name, inhalt })
  .refine((b) => INHALT_SCHEMA[b.art].safeParse(b.inhalt).success);
const aendern = z
  .strictObject({ name: name.optional(), inhalt: inhalt.optional() })
  .refine((b) => Object.keys(b).length > 0);

const NAME_VERGEBEN = {
  code: "VORLAGENNAME_VERGEBEN",
  message: "Es gibt schon eine Vorlage dieser Art mit diesem Namen.",
} as const;
const LIMIT_ERREICHT = {
  code: "LIMIT_ERREICHT",
  message: "Die Abteilung hat die höchste Zahl an Vorlagen erreicht.",
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

export function erstelleAdminVorlagenRouten({ db }: { db: Db }) {
  const admin = (person: Person) =>
    verlange(db, person, "lager.vorlagen_pflegen");
  // Erst die Vorlage der eigenen Abteilung (404), dann das Recht (403)
  async function laden(person: Person, id: string) {
    const zeile = await ladeVorlage(db, person.abteilungId, id);
    if (!zeile) throw new HTTPException(404);
    await admin(person);
    return zeile;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", eingabe("query", liste), async (c) => {
      const person = c.get("person");
      await admin(person);
      // Eine Abfrage, höchstens VORLAGEN_MAX Zeilen: kein Seitenwechsel nötig
      const zeilen = await db
        .select()
        .from(vorlage)
        .where(
          and(
            eq(vorlage.abteilungId, person.abteilungId),
            c.req.valid("query").art
              ? eq(vorlage.art, c.req.valid("query").art!)
              : undefined,
          ),
        )
        .orderBy(asc(vorlage.art), asc(vorlage.name), asc(vorlage.id))
        .limit(VORLAGEN_MAX);
      return c.json({ vorlagen: zeilen.map(vorlageUebersicht) });
    })
    .post("/", eingabe("json", anlegen), async (c) => {
      const person = c.get("person");
      await admin(person);
      const w = c.req.valid("json");
      const [stand] = await db
        .select({ n: count() })
        .from(vorlage)
        .where(eq(vorlage.abteilungId, person.abteilungId));
      if (stand!.n >= VORLAGEN_MAX) return c.json(LIMIT_ERREICHT, 409);
      try {
        const zeile = await db.transaction(async (tx) => {
          const [neu] = await tx
            .insert(vorlage)
            .values({
              abteilungId: person.abteilungId,
              art: w.art,
              name: w.name,
              // Geparst: getrimmt und ohne fremde Schlüssel
              inhalt: INHALT_SCHEMA[w.art].parse(w.inhalt),
              erstelltVon: person.id,
              geaendertVon: person.id,
            })
            .returning();
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "vorlage_angelegt",
            zielTyp: "vorlage",
            zielId: neu!.id,
            details: { art: w.art },
          });
          return neu!;
        });
        return c.json(vorlageAnsicht(zeile), 201);
      } catch (fehler) {
        if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
        throw fehler;
      }
    })
    .get("/:id", eingabe("param", pfad), async (c) =>
      c.json(
        vorlageAnsicht(await laden(c.get("person"), c.req.valid("param").id)),
      ),
    )
    .patch(
      "/:id",
      eingabe("param", pfad),
      eingabe("json", aendern),
      async (c) => {
        const person = c.get("person");
        const alt = await laden(person, c.req.valid("param").id);
        const w = c.req.valid("json");
        // Die Art bleibt; der neue Inhalt muss zu ihr passen
        let neuerInhalt: unknown;
        if (w.inhalt !== undefined) {
          const r = INHALT_SCHEMA[alt.art].safeParse(w.inhalt);
          if (!r.success) throw new HTTPException(400);
          neuerInhalt = r.data;
        }
        try {
          const zeile = await db.transaction(async (tx) => {
            const [neu] = await tx
              .update(vorlage)
              .set({
                ...(w.name !== undefined && { name: w.name }),
                ...(neuerInhalt !== undefined && { inhalt: neuerInhalt }),
                geaendertAm: new Date(),
                geaendertVon: person.id,
              })
              .where(
                and(
                  eq(vorlage.id, alt.id),
                  eq(vorlage.abteilungId, person.abteilungId),
                ),
              )
              .returning();
            if (!neu) throw new HTTPException(404);
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "vorlage_geaendert",
              zielTyp: "vorlage",
              zielId: alt.id,
              // Welche Felder, nie die Werte
              details: { art: alt.art, felder: Object.keys(w) },
            });
            return neu;
          });
          return c.json(vorlageAnsicht(zeile));
        } catch (fehler) {
          if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
          throw fehler;
        }
      },
    )
    .delete("/:id", eingabe("param", pfad), async (c) => {
      const person = c.get("person");
      const alt = await laden(person, c.req.valid("param").id);
      await db.transaction(async (tx) => {
        await tx.delete(vorlage).where(eq(vorlage.id, alt.id));
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "vorlage_geloescht",
          zielTyp: "vorlage",
          zielId: alt.id,
          details: { art: alt.art },
        });
      });
      return c.body(null, 204);
    });
}
