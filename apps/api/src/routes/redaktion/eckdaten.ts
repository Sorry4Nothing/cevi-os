import { and, asc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { darfBearbeiten } from "../../bearbeiten.js";
import type { Db } from "../../db/client.js";
import { auditLog, programmEckdaten, seite, tag } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Person } from "../../rechte.js";
import { meldeWebsiteEreignis } from "../../website/ereignisse.js";
import {
  heuteZuerich,
  istTag,
  MAX_GEPFLEGT,
  MAX_MITNEHMEN,
  MAX_ORT,
  vergissStufenfakten,
  ZEIT_MUSTER,
} from "../../website/stufenfakten.js";

// Steuerzeichen ausser Tab und Zeilenumbruch sind verboten, vor allem NUL: Postgres kann es nicht speichern, das wäre ein 500 statt 400
// eslint-disable-next-line no-control-regex
const OHNE_STEUERZEICHEN = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
// Leer heisst «nicht gesetzt» und wird null
const leerZuNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const zeit = z.preprocess(
  leerZuNull,
  z.string().regex(ZEIT_MUSTER).nullable().optional(),
);
const text = (max: number) =>
  z.preprocess(
    leerZuNull,
    z.string().trim().max(max).regex(OHNE_STEUERZEICHEN).nullable().optional(),
  );

const pfad = () =>
  z.strictObject({
    stufeId: z.uuid(),
    tag: z.string().refine(istTag),
  });
const stufePfad = () => z.strictObject({ stufeId: z.uuid() });
const speichernSchema = z
  .strictObject({
    treffZeit: zeit,
    treffpunkt: text(MAX_ORT),
    schlussZeit: zeit,
    schlussOrt: text(MAX_ORT),
    mitnehmen: text(MAX_MITNEHMEN),
  })
  .refine((f) => Object.values(f).some((w) => w != null));

const VERGANGEN = {
  code: "DATUM_VERGANGEN",
  message: "Das Datum liegt in der Vergangenheit.",
} as const;
const ZU_VIELE = {
  code: "ECKDATEN_ZU_VIELE",
  message: `Es sind höchstens ${MAX_GEPFLEGT} kommende Daten je Stufe möglich. Lösche zuerst ein altes.`,
} as const;

// Ohne eine Stufenseite gilt eine Zeile ohne Objekt: Dann haben nur Abteilungsleitung, Stufenleitung und die Redaktion (Zeile ohne Objekt) das Recht
const KEINE_SEITE = "00000000-0000-0000-0000-000000000000";

const spalten = {
  tag: programmEckdaten.tag,
  treffZeit: programmEckdaten.treffZeit,
  treffpunkt: programmEckdaten.treffpunkt,
  schlussZeit: programmEckdaten.schlussZeit,
  schlussOrt: programmEckdaten.schlussOrt,
  mitnehmen: programmEckdaten.mitnehmen,
  quelle: programmEckdaten.quelle,
};

// Die festen Felder der Stufenseite (#355): wirken sofort, ohne Veröffentlichen. Recht wie an der Stufenseite (Stufenleitung der Stufe, Redaktion, Abteilungsleitung); die Stufe der Sitzung wird zuerst geladen (fremde und unbekannte IDs sind 404)
export function erstelleEckdatenRouten({ db }: { db: Db }) {
  async function ladeMitRecht(person: Person, stufeId: string) {
    const [stufe] = await db
      .select({ id: tag.id })
      .from(tag)
      .where(
        and(
          eq(tag.id, stufeId),
          eq(tag.typ, "stufe"),
          eq(tag.abteilungId, person.abteilungId),
        ),
      );
    if (!stufe) throw new HTTPException(404);
    const [stufenseite] = await db
      .select({ id: seite.id })
      .from(seite)
      .where(
        and(
          eq(seite.tagId, stufeId),
          eq(seite.abteilungId, person.abteilungId),
        ),
      )
      .limit(1);
    const darf = await darfBearbeiten(
      db,
      person,
      "seite",
      stufenseite?.id ?? KEINE_SEITE,
      { stufeId },
    );
    if (!darf) throw new HTTPException(403);
    return stufenseite?.id;
  }

  // Die Stufenseite wird neu erzeugt, weil der Baustein andere Felder zeigt (nach dem Commit, nie mit Inhalt)
  const meldeAenderung = (abteilungId: string, seiteId: string | undefined) => {
    vergissStufenfakten();
    if (seiteId) {
      meldeWebsiteEreignis({ art: "seite_geaendert", abteilungId, seiteId });
    }
  };

  return new Hono<{ Variables: { person: Person } }>()
    .get("/:stufeId/eckdaten", eingabe("param", stufePfad()), async (c) => {
      const person = c.get("person");
      const { stufeId } = c.req.valid("param");
      await ladeMitRecht(person, stufeId);
      // Kommende Daten, beide Quellen; höchstens so viele, wie gepflegt werden dürfen, plus die eine ausgelesene
      const eckdaten = await db
        .select(spalten)
        .from(programmEckdaten)
        .where(
          and(
            eq(programmEckdaten.stufeId, stufeId),
            gte(programmEckdaten.tag, heuteZuerich()),
          ),
        )
        .orderBy(asc(programmEckdaten.tag))
        .limit(MAX_GEPFLEGT + 1);
      return c.json({ eckdaten });
    })
    .get("/:stufeId/eckdaten/:tag", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { stufeId, tag: tagWert } = c.req.valid("param");
      await ladeMitRecht(person, stufeId);
      const [zeile] = await db
        .select(spalten)
        .from(programmEckdaten)
        .where(
          and(
            eq(programmEckdaten.stufeId, stufeId),
            eq(programmEckdaten.tag, tagWert),
          ),
        );
      if (!zeile) throw new HTTPException(404);
      return c.json(zeile);
    })
    .put("/:stufeId/eckdaten/:tag", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { stufeId, tag: tagWert } = c.req.valid("param");
      const stufenseiteId = await ladeMitRecht(person, stufeId);
      const parsed = speichernSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) throw new HTTPException(400);
      const f = parsed.data;
      if (tagWert < heuteZuerich()) return c.json(VERGANGEN, 400);

      const werte = {
        treffZeit: f.treffZeit ?? null,
        treffpunkt: f.treffpunkt ?? null,
        schlussZeit: f.schlussZeit ?? null,
        schlussOrt: f.schlussOrt ?? null,
        mitnehmen: f.mitnehmen ?? null,
        quelle: "seite" as const,
        abgerufenAm: sql`now()`,
      };
      const ok = await db.transaction(async (tx) => {
        // Zwei Speicherungen derselben Stufe zählen nacheinander (die Obergrenze gilt je Stufe)
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`eckdaten:${stufeId}`}, 0))`,
        );
        const [zeile] = await tx
          .select({ quelle: programmEckdaten.quelle })
          .from(programmEckdaten)
          .where(
            and(
              eq(programmEckdaten.stufeId, stufeId),
              eq(programmEckdaten.tag, tagWert),
            ),
          );
        if (zeile?.quelle !== "seite") {
          // Vergangene gepflegte Zeilen räumt jede Speicherung weg: Sie dienen nirgends mehr
          await tx
            .delete(programmEckdaten)
            .where(
              and(
                eq(programmEckdaten.stufeId, stufeId),
                eq(programmEckdaten.quelle, "seite"),
                sql`${programmEckdaten.tag} < ${heuteZuerich()}::date`,
              ),
            );
          const [{ n }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(programmEckdaten)
            .where(
              and(
                eq(programmEckdaten.stufeId, stufeId),
                eq(programmEckdaten.quelle, "seite"),
              ),
            );
          if (n >= MAX_GEPFLEGT) return false;
        }
        await tx
          .insert(programmEckdaten)
          .values({ stufeId, tag: tagWert, ...werte })
          .onConflictDoUpdate({
            target: [programmEckdaten.stufeId, programmEckdaten.tag],
            set: werte,
          });
        // Nur Feldnamen, nie Werte
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "eckdaten_geaendert",
          zielTyp: "stufe",
          zielId: stufeId,
          details: {
            tag: tagWert,
            felder: Object.entries(f)
              .filter(([, w]) => w != null)
              .map(([name]) => name),
          },
        });
        return true;
      });
      if (!ok) return c.json(ZU_VIELE, 409);
      meldeAenderung(person.abteilungId, stufenseiteId);
      return c.body(null, 204);
    })
    .delete("/:stufeId/eckdaten/:tag", eingabe("param", pfad()), async (c) => {
      const person = c.get("person");
      const { stufeId, tag: tagWert } = c.req.valid("param");
      const stufenseiteId = await ladeMitRecht(person, stufeId);
      // Nur gepflegte Zeilen: Die ausgelesene gehört dem Auslesen (bis #361)
      const weg = await db.transaction(async (tx) => {
        const geloescht = await tx
          .delete(programmEckdaten)
          .where(
            and(
              eq(programmEckdaten.stufeId, stufeId),
              eq(programmEckdaten.tag, tagWert),
              eq(programmEckdaten.quelle, "seite"),
            ),
          )
          .returning({ tag: programmEckdaten.tag });
        if (geloescht.length === 0) return false;
        await tx.insert(auditLog).values({
          abteilungId: person.abteilungId,
          akteurId: person.id,
          aktion: "eckdaten_geloescht",
          zielTyp: "stufe",
          zielId: stufeId,
          details: { tag: tagWert },
        });
        return true;
      });
      if (!weg) throw new HTTPException(404);
      meldeAenderung(person.abteilungId, stufenseiteId);
      return c.body(null, 204);
    });
}
