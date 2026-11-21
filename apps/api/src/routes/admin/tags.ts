import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, personTag, tag, user } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";

const typ = z.enum(["stufe", "funktion", "team", "lager"]);
const name = z.string().trim().min(1).max(100);
const kuerzel = z.string().trim().min(1).max(20);
const rolle = z.string().trim().min(1).max(50);
const prioritaet = z.number().int().min(1).max(1000);

// Ein Schema pro Route, mit keiner Nicht-Admin-Route geteilt. Der Typ eines Tags bleibt nach dem Anlegen fest
const anlegenSchema = z.strictObject({
  typ,
  name,
  kuerzel: kuerzel.optional(),
});
const aendernSchema = z.strictObject({
  name: name.optional(),
  kuerzel: kuerzel.optional(),
});
// Ohne Schlüssel bleibt der Wert, wie er ist (bei einer neuen Zuordnung: leer); null leert ihn
const zuweisenSchema = z.strictObject({
  rolle: rolle.nullable().optional(),
  prioritaet: prioritaet.nullable().optional(),
});
const pfad = () => z.strictObject({ id: z.uuid() });
const pfadPerson = () => z.strictObject({ id: z.uuid(), userId: z.uuid() });

const NAME_VERGEBEN = {
  code: "TAGNAME_VERGEBEN",
  message: "Es gibt schon einen Tag mit diesem Namen.",
} as const;

// Drizzle legt den Fehler von Postgres in cause: 23505 = Index verletzt, 23503 = Fremdschlüssel verletzt
const pgCode = (fehler: unknown) =>
  (fehler as { cause?: { code?: string } })?.cause?.code;

class Belegt extends Error {
  constructor(readonly personen: number) {
    super();
  }
}

export function erstelleTagRouten({ db }: { db: Db }) {
  // In SQL auf die Abteilung der Sitzung gefiltert: fremde wie unbekannte IDs sind 404, erst danach zählt das Recht
  async function ladeTag(person: Person, id: string) {
    const [ziel] = await db
      .select({
        id: tag.id,
        typ: tag.typ,
        name: tag.name,
        kuerzel: tag.kuerzel,
      })
      .from(tag)
      .where(and(eq(tag.id, id), eq(tag.abteilungId, person.abteilungId)));
    if (!ziel) throw new HTTPException(404);
    if (!person.admin) throw new HTTPException(403);
    return ziel;
  }

  return new Hono<{ Variables: { person: Person } }>()
    .get("/", async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const tags = await db
        .select({
          id: tag.id,
          typ: tag.typ,
          name: tag.name,
          kuerzel: tag.kuerzel,
          anzahlPersonen: count(personTag.userId),
        })
        .from(tag)
        .leftJoin(personTag, eq(personTag.tagId, tag.id))
        .where(eq(tag.abteilungId, person.abteilungId))
        .groupBy(tag.id)
        .orderBy(asc(tag.typ), asc(tag.name), asc(tag.id));
      return c.json({ tags });
    })
    .post("/", eingabe("json", anlegenSchema), async (c) => {
      const person = c.get("person");
      if (!person.admin) throw new HTTPException(403);
      const felder = c.req.valid("json");
      try {
        const neu = await db.transaction(async (tx) => {
          const [zeile] = await tx
            .insert(tag)
            .values({
              ...felder,
              kuerzel: felder.kuerzel ?? "",
              abteilungId: person.abteilungId,
            })
            .returning({ id: tag.id });
          // Nur der Typ, nie der Name
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_angelegt",
            zielTyp: "tag",
            zielId: zeile.id,
            details: { typ: felder.typ },
          });
          return zeile;
        });
        return c.json({ id: neu.id }, 201);
      } catch (fehler) {
        if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
        throw fehler;
      }
    })
    .get("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const ziel = await ladeTag(person, c.req.valid("param").id);
      // Wo der Tag verwendet wird: bisher nur die Zuordnung zu Personen; Sichtbarkeit und Rechte kommen mit #333 und #334
      const personen = await db
        .select({
          userId: personTag.userId,
          rolle: personTag.rolle,
          prioritaet: personTag.prioritaet,
        })
        .from(personTag)
        .where(eq(personTag.tagId, ziel.id))
        .orderBy(asc(personTag.prioritaet), asc(personTag.userId));
      return c.json({
        ...ziel,
        verwendung: { personen: personen.length },
        personen,
      });
    })
    .patch(
      "/:id",
      eingabe("param", pfad()),
      eingabe("json", aendernSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const felder = c.req.valid("json");
        await ladeTag(person, id);
        // Ohne Schlüssel wirft Drizzle bei set({}): kein Schreibzugriff
        if (Object.keys(felder).length > 0) {
          try {
            await db.transaction(async (tx) => {
              await tx.update(tag).set(felder).where(eq(tag.id, id));
              // Welche Felder, nie die Werte
              await tx.insert(auditLog).values({
                abteilungId: person.abteilungId,
                akteurId: person.id,
                aktion: "tag_geaendert",
                zielTyp: "tag",
                zielId: id,
                details: {
                  name: felder.name !== undefined,
                  kuerzel: felder.kuerzel !== undefined,
                },
              });
            });
          } catch (fehler) {
            if (pgCode(fehler) === "23505") return c.json(NAME_VERGEBEN, 409);
            throw fehler;
          }
        }
        return c.body(null, 204);
      },
    )
    .delete("/:id", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { id } = c.req.valid("param");
      const ziel = await ladeTag(person, id);
      try {
        await db.transaction(async (tx) => {
          const [{ n }] = await tx
            .select({ n: count() })
            .from(personTag)
            .where(eq(personTag.tagId, id));
          if (n > 0) throw new Belegt(n);
          await tx.delete(tag).where(eq(tag.id, id));
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_geloescht",
            zielTyp: "tag",
            zielId: id,
            details: { typ: ziel.typ },
          });
        });
      } catch (fehler) {
        // 23503: eine Zuordnung, die gleichzeitig entsteht
        if (fehler instanceof Belegt || pgCode(fehler) === "23503") {
          return c.json(
            {
              code: "TAG_BELEGT",
              message:
                "Der Tag ist noch Personen zugewiesen. Entziehe ihn zuerst allen Personen.",
              verwendung: {
                personen: fehler instanceof Belegt ? fehler.personen : null,
              },
            },
            409,
          );
        }
        throw fehler;
      }
      return c.body(null, 204);
    })
    .put(
      "/:id/personen/:userId",
      eingabe("param", pfadPerson()),
      eingabe("json", zuweisenSchema),
      async (c) => {
        const person = c.get("person");
        const { id, userId } = c.req.valid("param");
        const felder = c.req.valid("json");
        await ladeTag(person, id);
        // Eine Person einer anderen Abteilung ist für diese Route unbekannt
        const [ziel] = await db
          .select({ id: user.id })
          .from(user)
          .where(
            and(eq(user.id, userId), eq(user.abteilungId, person.abteilungId)),
          );
        if (!ziel) throw new HTTPException(404);
        await db.transaction(async (tx) => {
          // Anlegen und Ändern in einem Schritt; ein Schlüssel ohne Wert bleibt bei einer bestehenden Zuordnung stehen
          const einfuegen = tx.insert(personTag).values({
            userId,
            tagId: id,
            rolle: felder.rolle ?? null,
            prioritaet: felder.prioritaet ?? null,
          });
          // Ohne Schlüssel wirft Drizzle bei set({}): dann bleibt eine bestehende Zuordnung, wie sie ist
          await (Object.keys(felder).length > 0
            ? einfuegen.onConflictDoUpdate({
                target: [personTag.userId, personTag.tagId],
                set: felder,
              })
            : einfuegen.onConflictDoNothing());
          // Ohne die Rolle: Sie ist Freitext
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_zugewiesen",
            zielTyp: "tag",
            zielId: id,
            details: {
              userId,
              rolle:
                felder.rolle === undefined ? undefined : felder.rolle !== null,
              prioritaet: felder.prioritaet,
            },
          });
        });
        return c.body(null, 204);
      },
    )
    .delete(
      "/:id/personen/:userId",
      eingabe("param", pfadPerson()),
      async (c) => {
        const person = c.get("person");
        const { id, userId } = c.req.valid("param");
        await ladeTag(person, id);
        await db.transaction(async (tx) => {
          const entfernt = await tx
            .delete(personTag)
            .where(and(eq(personTag.tagId, id), eq(personTag.userId, userId)))
            .returning({ userId: personTag.userId });
          // Die Person trägt den Tag nicht (oder gehört nicht zur Abteilung: dann gibt es keine Zuordnung zu einem Tag dieser Abteilung)
          if (entfernt.length === 0) throw new HTTPException(404);
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "tag_entzogen",
            zielTyp: "tag",
            zielId: id,
            details: { userId },
          });
        });
        return c.body(null, 204);
      },
    );
}
