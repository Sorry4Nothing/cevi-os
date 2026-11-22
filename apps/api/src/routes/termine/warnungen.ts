import { and, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { programm } from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import { TERMIN_BEGINN } from "../../termine/sicht.js";
import type { TermineEnv } from "./index.js";

// Warnliste «Termine ohne Kategorie» (#433, Epic #430): Welche kommenden Termine keinen Tag haben (keiner Gruppe zugewiesen), und welche Kategorien aus Outlook noch keinem Tag entsprechen. Nur die Abteilungsleitung (Admin mit zweitem Faktor, den der Pfad /api/v1/admin/* verlangt).
// Abfragen je Aufruf: zwei, unabhängig von der Seitengrösse (die Seite der Termine, die Zusammenfassung der unbekannten Kategorien). Keine Abfrage je Zeile.

const listeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.string().min(1).max(200).optional(),
});
// Der Cursor ist undurchsichtig: Beginn in ganzen Millisekunden und ID des letzten Termins der Vorseite (wie bei «Mein Kalender»)
const cursorSchema = z.tuple([
  z.number().int().min(0).max(8.64e15),
  z.uuid().toLowerCase(),
]);

// Höchstens so viele unbekannte Kategorien; Namen sind höchstens 100 Zeichen, die Liste bleibt klein
const MAX_UNBEKANNT = 200;

const SORT_MS = sql`floor(extract(epoch from ${TERMIN_BEGINN}) * 1000)::bigint`;
// Kommend oder laufend: Das Ende (bei Ganztägigen das Ende des letzten Tages, Schweizer Zeit) liegt noch vor uns
const KOMMEND = sql`coalesce(programm.ende, (programm.tag_bis + 1)::timestamp at time zone 'Europe/Zurich') > now()`;
// Abgesagte und intern ausgeblendete Termine gehören nicht auf die Liste
const ZAEHLT = sql`programm.status <> 'abgesagt' and programm.sichtbarkeit <> 'intern' and ${KOMMEND}`;

export function erstelleWarnungenRouten({ db }: { db: Db }) {
  return new Hono<TermineEnv>().get(
    "/admin/termine/warnungen",
    eingabe("query", listeSchema),
    async (c) => {
      const person = c.get("person");
      // Keine Objekte im Pfad: nur das Recht
      if (!person.admin) throw new HTTPException(403);
      const { limit, nach } = c.req.valid("query");
      let cursor: z.infer<typeof cursorSchema> | undefined;
      if (nach !== undefined) {
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(nach, "base64url").toString("utf8")),
          );
        } catch {
          throw new HTTPException(400);
        }
      }
      // Ohne Zeile in programm_tag sieht den Termin niemand (#432)
      const zeilen = await db
        .select({
          id: programm.id,
          titel: programm.titel,
          ganztaegig: programm.ganztaegig,
          beginn: programm.beginn,
          ende: programm.ende,
          tagVon: programm.tagVon,
          tagBis: programm.tagBis,
          kategorien: programm.kategorien,
          sortMs: sql<number>`${SORT_MS}::float8`,
        })
        .from(programm)
        .where(
          and(
            sql`programm.abteilung_id = ${person.abteilungId}`,
            ZAEHLT,
            sql`not exists (select 1 from programm_tag where programm_tag.programm_id = programm.id)`,
            cursor &&
              sql`(${SORT_MS}, programm.id) > (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
          ),
        )
        .orderBy(SORT_MS, programm.id)
        .limit(limit + 1);
      const weitere = zeilen.length > limit;
      const seite = zeilen.slice(0, limit);
      const letzte = seite.at(-1);

      // Alle Kategorienamen der kommenden Termine ohne Tag, nach der Regel des Abgleichs (kalender/tags-zuordnen.ts): erst eine Abweichung, sonst ein Tag gleichen Namens, getrimmt und ohne Gross-/Kleinschreibung. Auch Termine, die über eine andere Kategorie sichtbar sind, zählen mit.
      const unbekannt = await db.execute<{ name: string; anzahl: number }>(sql`
        select min(trim(k.name)) as name, count(distinct programm.id)::int as anzahl
        from programm
        cross join lateral unnest(programm.kategorien) as k(name)
        where programm.abteilung_id = ${person.abteilungId}
          and ${ZAEHLT}
          and not exists (
            select 1 from kategorie_zuordnung kz
            where kz.abteilung_id = programm.abteilung_id and lower(trim(kz.kategorie)) = lower(trim(k.name))
          )
          and not exists (
            select 1 from tag
            where tag.abteilung_id = programm.abteilung_id and lower(trim(tag.name)) = lower(trim(k.name))
          )
        group by lower(trim(k.name))
        order by anzahl desc, lower(trim(k.name))
        limit ${MAX_UNBEKANNT}
      `);

      return c.json({
        termine: seite.map((t) => ({
          ...t,
          // Der Sortierschlüssel gehört nur in den Cursor; undefined fällt aus dem JSON
          sortMs: undefined,
          grund:
            t.kategorien.length === 0
              ? ("keine_kategorie" as const)
              : ("unbekannte_kategorie" as const),
        })),
        unbekannteKategorien: unbekannt.map((z) => ({
          name: z.name,
          anzahl: z.anzahl,
        })),
        weitere,
        naechste:
          weitere && letzte
            ? Buffer.from(JSON.stringify([letzte.sortMs, letzte.id])).toString(
                "base64url",
              )
            : null,
      });
    },
  );
}
