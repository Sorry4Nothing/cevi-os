import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { auditLog, kategorieZuordnung, tag } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import type { TermineEnv } from "./index.js";

// Abweichungen «Outlook-Kategorie meint diesen Tag» verwalten (#434, Epic #430; Recht «termine.kategorien_zuordnen»). Nur die Abteilungsleitung (Admin; den zweiten Faktor verlangt schon der Pfad /api/v1/admin/*).
// Eine Änderung wirkt beim nächsten Kalender-Abgleich (bis 5 Minuten): kalender/tags-zuordnen.ts liest die Zeilen und rechnet programm_tag in jedem Lauf neu. Darum hier kein Neuzuordnen der bestehenden Termine.
const HOECHSTENS = 500;

// Ohne Steuerzeichen (auch keine Zeilenumbrüche); getrimmt, wie kategorienVon die Namen liest
const kategorie = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]+$/u);
const setzenSchema = z.strictObject({ kategorie, tagId: z.uuid() });
const pfad = z.strictObject({ id: z.uuid() });

const TAG_UNBEKANNT = {
  code: "TAG_UNBEKANNT",
  message: "Der Tag gehört nicht zur Abteilung.",
} as const;
const ZU_VIELE = {
  code: "ZUORDNUNGEN_VOLL",
  message: `Es gibt schon ${HOECHSTENS} Zuordnungen. Entferne zuerst eine.`,
} as const;

// Bricht die Transaktion ab, damit die Zeile über der Grenze nicht bleibt
class ZuVieleFehler extends Error {}

const pruefeRecht = (person: Pick<Person, "admin">) => {
  if (!person.admin) throw new HTTPException(403);
};

export function erstelleKategorieZuordnungenRouten({ db }: { db: Db }) {
  return new Hono<TermineEnv>()
    .get("/admin/kategorie-zuordnungen", async (c) => {
      const person = c.get("person");
      pruefeRecht(person);
      // Eine Abfrage: Zuordnung mit Namen und Typ des Tags
      const zeilen = await db
        .select({
          id: kategorieZuordnung.id,
          kategorie: kategorieZuordnung.kategorie,
          tagId: kategorieZuordnung.tagId,
          tagName: tag.name,
          tagTyp: tag.typ,
        })
        .from(kategorieZuordnung)
        .innerJoin(tag, eq(tag.id, kategorieZuordnung.tagId))
        .where(eq(kategorieZuordnung.abteilungId, person.abteilungId))
        .orderBy(
          asc(sql`lower(${kategorieZuordnung.kategorie})`),
          asc(kategorieZuordnung.id),
        )
        .limit(HOECHSTENS);
      return c.json({ zuordnungen: zeilen });
    })
    .put(
      "/admin/kategorie-zuordnungen",
      eingabe("json", setzenSchema),
      async (c) => {
        const person = c.get("person");
        pruefeRecht(person);
        const b = c.req.valid("json");
        const antwort = await db
          .transaction(async (tx) => {
            // Der Tag muss zur Abteilung gehören (ein fremder wie ein unbekannter ist 400)
            const [ziel] = await tx
              .select({ id: tag.id })
              .from(tag)
              .where(
                and(
                  eq(tag.id, b.tagId),
                  eq(tag.abteilungId, person.abteilungId),
                ),
              );
            if (!ziel) return { fehler: TAG_UNBEKANNT };
            // Ersetzt die Zeile derselben Kategorie (ohne Gross-/Kleinschreibung) samt neuer Schreibweise; xmax = 0 heisst: neu eingefügt
            const [zeile] = await tx.execute<{ id: string; neu: boolean }>(sql`
            insert into kategorie_zuordnung (abteilung_id, kategorie, tag_id)
            values (${person.abteilungId}, ${b.kategorie}, ${b.tagId})
            on conflict (abteilung_id, lower(kategorie))
            do update set kategorie = excluded.kategorie, tag_id = excluded.tag_id
            returning id, (xmax = 0) as neu`);
            if (zeile!.neu) {
              // Grenze für die Liste; zählt nach dem Einfügen, damit zwei Anfragen zugleich nicht beide durchkommen
              const [{ n }] = await tx.execute<{ n: number }>(sql`
              select count(*)::int as n from kategorie_zuordnung where abteilung_id = ${person.abteilungId}`);
              if (n! > HOECHSTENS) throw new ZuVieleFehler();
            }
            // Nur die Tag-ID, nie der Name
            await tx.insert(auditLog).values({
              abteilungId: person.abteilungId,
              akteurId: person.id,
              aktion: "kategorie_zugeordnet",
              zielTyp: "kategorie_zuordnung",
              zielId: zeile!.id,
              details: { tagId: b.tagId },
            });
            return { id: zeile!.id, neu: zeile!.neu };
          })
          .catch((f) => {
            if (f instanceof ZuVieleFehler) return "voll" as const;
            throw f;
          });
        if (antwort === "voll") return c.json(ZU_VIELE, 409);
        if ("fehler" in antwort) return c.json(antwort.fehler, 400);
        return c.json({ id: antwort.id }, antwort.neu ? 201 : 200);
      },
    )
    .delete(
      "/admin/kategorie-zuordnungen/:id",
      eingabe("param", pfad),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        await db.transaction(async (tx) => {
          // Erst das Objekt in der eigenen Abteilung (fremd = 404), dann das Recht
          const [ziel] = await tx
            .select({ tagId: kategorieZuordnung.tagId })
            .from(kategorieZuordnung)
            .where(
              and(
                eq(kategorieZuordnung.id, id),
                eq(kategorieZuordnung.abteilungId, person.abteilungId),
              ),
            )
            .for("update");
          if (!ziel) throw new HTTPException(404);
          pruefeRecht(person);
          await tx
            .delete(kategorieZuordnung)
            .where(eq(kategorieZuordnung.id, id));
          await tx.insert(auditLog).values({
            abteilungId: person.abteilungId,
            akteurId: person.id,
            aktion: "kategorie_entfernt",
            zielTyp: "kategorie_zuordnung",
            zielId: id,
            details: { tagId: ziel.tagId },
          });
        });
        return c.body(null, 204);
      },
    );
}
