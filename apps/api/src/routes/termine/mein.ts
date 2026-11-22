import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  kind,
  kindEltern,
  leitungAnmeldung,
  programm,
  programmEckdaten,
  programmTag,
  tag,
  teilnahme,
} from "../../db/schema.js";
import { eingabe } from "../../eingabe.js";
import type { Fcm } from "../../push.js";
import { darfLeitungAnmelden, type Person } from "../../rechte.js";
import {
  alleSichtTags,
  alleTermine,
  ladeSichtTags,
  meineTermine,
  TERMIN_BEGINN,
} from "../../termine/sicht.js";
import type { TermineEnv } from "./index.js";

// «Mein Kalender» für die Apps (#435): die Termine, die für die Person sichtbar sind (termine/sicht.ts), mit Zeitraum, Cursor und Detail.
// Abfragen je Aufruf: Liste höchstens 3 (Tags der Person, Seite mit Tags, Kinder der Seite), Detail höchstens 5 (dazu Eckdaten und eigene Anmeldung). Nie je Zeile.

const MAX_TAGE = 400;
const tag_ = z.iso.date().refine((wert) => !wert.startsWith("0000"));
export const listeSchema = z.strictObject({
  von: tag_,
  bis: tag_,
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100)
    .optional(),
  nach: z.string().min(1).max(200).optional(),
});
const pfadSchema = z.strictObject({ id: z.uuid() });
// Der Cursor ist undurchsichtig: Beginn in ganzen Millisekunden und ID des letzten Termins der Vorseite
const cursorSchema = z.tuple([
  z.number().int().min(0).max(8.64e15),
  z.uuid().toLowerCase(),
]);

// Beginn auf ganze Millisekunden, damit Sortierung, Cursor und Vergleich dieselbe Zahl benutzen
const SORT_MS = sql`floor(extract(epoch from ${TERMIN_BEGINN}) * 1000)::bigint`;

type TagEintrag = { id: string; name: string; typ: string };

function terminFelder(tagsDerPerson: SQL) {
  return {
    id: programm.id,
    titel: programm.titel,
    status: programm.status,
    ganztaegig: programm.ganztaegig,
    beginn: programm.beginn,
    ende: programm.ende,
    tagVon: programm.tagVon,
    tagBis: programm.tagBis,
    ort: programm.ort,
    // Nur Tags, die die Person selbst hat (die Abteilungsleitung in «Alle» alle); was sonst an einem Termin hängt, bleibt ihr verborgen
    tags: sql<
      TagEintrag[]
    >`coalesce((select jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name, 'typ', tag.typ) order by tag.name, tag.id) from programm_tag join tag on tag.id = programm_tag.tag_id and tag.abteilung_id = programm.abteilung_id where programm_tag.programm_id = programm.id and ${tagsDerPerson}), '[]'::jsonb)`,
  };
}

// Die eigenen, aktiven Kinder, deren Stufe an den Terminen hängt, mit ihrer Antwort; eine Abfrage für alle Termine der Seite
export async function eigeneKinder(
  db: Db,
  person: Person,
  programmIds: string[],
) {
  const nachTermin = new Map<
    string,
    { id: string; vorname: string; status: "ja" | "nein" | null }[]
  >();
  if (programmIds.length === 0) return nachTermin;
  const zeilen = await db
    .select({
      programmId: programmTag.programmId,
      id: kind.id,
      vorname: kind.vorname,
      status: teilnahme.status,
    })
    .from(kind)
    .innerJoin(
      kindEltern,
      and(eq(kindEltern.kindId, kind.id), eq(kindEltern.userId, person.id)),
    )
    .innerJoin(
      programmTag,
      and(
        eq(programmTag.tagId, kind.stufeId),
        inArray(programmTag.programmId, programmIds),
      ),
    )
    .leftJoin(
      teilnahme,
      and(
        eq(teilnahme.kindId, kind.id),
        eq(teilnahme.programmId, programmTag.programmId),
      ),
    )
    .where(
      and(eq(kind.abteilungId, person.abteilungId), isNull(kind.inaktivSeit)),
    )
    .orderBy(kind.vorname, kind.id);
  for (const { programmId, ...eintrag } of zeilen) {
    const liste = nachTermin.get(programmId) ?? [];
    liste.push(eintrag);
    nachTermin.set(programmId, liste);
  }
  return nachTermin;
}

// Die Seite der Termine für «Mein Kalender» und «Alle» (#436); beide teilen Zeitraum, Cursor und Felder. Abfragen: Tags der Person, Seite mit Tags, Kinder der Seite
export async function ladeTerminListe(
  db: Db,
  person: Person,
  query: z.infer<typeof listeSchema>,
  art: "mein" | "alle",
) {
  const { von, bis, limit = 50, nach } = query;
  const tage = (Date.parse(bis) - Date.parse(von)) / 86_400_000 + 1;
  if (!(tage >= 1 && tage <= MAX_TAGE)) throw new HTTPException(400);
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
  const sichtTags = await ladeSichtTags(db, person);
  const imKalender = meineTermine(person, sichtTags);
  const zeilen = await db
    .select({
      ...terminFelder(
        art === "alle" && person.admin
          ? sql`true`
          : inArray(sql`programm_tag.tag_id`, alleSichtTags(sichtTags)),
      ),
      meine: sql<boolean>`${art === "mein" ? sql`true` : imKalender}`,
      sortMs: sql<number>`${SORT_MS}::float8`,
    })
    .from(programm)
    .where(
      and(
        art === "mein" ? imKalender : alleTermine(person, sichtTags),
        // Inklusive Schweizer Kalendertage: Ein Lager zählt an jedem seiner Tage
        sql`coalesce(programm.tag_bis, (programm.ende at time zone 'Europe/Zurich')::date) >= ${von}`,
        sql`coalesce(programm.tag_von, (programm.beginn at time zone 'Europe/Zurich')::date) <= ${bis}`,
        cursor &&
          sql`(${SORT_MS}, programm.id) > (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
      ),
    )
    .orderBy(SORT_MS, programm.id)
    .limit(limit + 1);
  const weitere = zeilen.length > limit;
  const seite = zeilen.slice(0, limit);
  const kinder = await eigeneKinder(
    db,
    person,
    seite.map((z) => z.id),
  );
  const letzte = seite.at(-1);
  return {
    termine: seite.map(({ meine, ...t }) => ({
      ...t,
      // Der Sortierschlüssel gehört nur in den Cursor
      sortMs: undefined,
      // Das Feld «meine» gibt es nur in «Alle»; undefined fällt aus dem JSON
      meine: art === "alle" ? meine : undefined,
      anlass: null,
      kinder: kinder.get(t.id) ?? [],
    })),
    weitere,
    naechste:
      weitere && letzte
        ? Buffer.from(JSON.stringify([letzte.sortMs, letzte.id])).toString(
            "base64url",
          )
        : null,
  };
}

// Private Antwort, die der Client mit If-None-Match erneuern darf; der Server rechnet weiter, spart aber den Rücktransport
export const kopf = (c: { header: (n: string, w: string) => void }) =>
  c.header("Cache-Control", "private, no-cache");

export function erstelleMeinRouten({ db }: { db: Db; fcm?: Fcm }) {
  const zwischenspeicher = etag();

  return new Hono<TermineEnv>()
    .get(
      "/termine/mein",
      zwischenspeicher,
      eingabe("query", listeSchema),
      async (c) => {
        kopf(c);
        return c.json(
          await ladeTerminListe(
            db,
            c.get("person"),
            c.req.valid("query"),
            "mein",
          ),
        );
      },
    )
    .get(
      "/termine/:id",
      zwischenspeicher,
      eingabe("param", pfadSchema),
      async (c) => {
        const person = c.get("person");
        const { id } = c.req.valid("param");
        const sichtTags = await ladeSichtTags(db, person);
        const sichtbar = alleSichtTags(sichtTags);
        // Unsichtbar, unbekannt und fremd sind alle 404
        const [zeile] = await db
          .select({
            ...terminFelder(inArray(sql`programm_tag.tag_id`, sichtbar)),
            teilnahmeOffen: sql<boolean>`(programm.status = 'aktiv' and ${TERMIN_BEGINN} > now())`,
            tag: sql<
              string | null
            >`coalesce(programm.tag_von, (programm.beginn at time zone 'Europe/Zurich')::date)::text`,
          })
          .from(programm)
          .where(and(eq(programm.id, id), meineTermine(person, sichtTags)));
        if (!zeile) throw new HTTPException(404);
        const { tag: terminTag, ...felder } = zeile;
        const tagIds = felder.tags.map((t) => t.id);
        const kinder = (await eigeneKinder(db, person, [id])).get(id) ?? [];
        // Eckdaten der Stufenseite: Tag und Stufe müssen passen; bei mehreren Stufen gewinnt die erste nach Name
        const [eckdaten] = await db
          .select({
            treffpunkt: programmEckdaten.treffpunkt,
            schlussOrt: programmEckdaten.schlussOrt,
            schlussZeit: programmEckdaten.schlussZeit,
            mitnehmen: programmEckdaten.mitnehmen,
          })
          .from(programmEckdaten)
          .innerJoin(tag, eq(tag.id, programmEckdaten.stufeId))
          .where(
            and(
              eq(programmEckdaten.tag, terminTag ?? ""),
              inArray(programmEckdaten.stufeId, tagIds),
            ),
          )
          .orderBy(tag.name, tag.id)
          .limit(1);
        // Nur wer sich anmelden dürfte, bekommt den Schlüssel; undefined fällt aus dem JSON
        let eigeneAnmeldung: "ja" | "nein" | "offen" | undefined;
        if (darfLeitungAnmelden(person, tagIds)) {
          const [anmeldung] = await db
            .select({ status: leitungAnmeldung.status })
            .from(leitungAnmeldung)
            .where(
              and(
                eq(leitungAnmeldung.programmId, id),
                eq(leitungAnmeldung.userId, person.id),
              ),
            );
          eigeneAnmeldung = anmeldung?.status ?? "offen";
        }
        kopf(c);
        return c.json({
          ...felder,
          treffpunkt: eckdaten?.treffpunkt ?? null,
          schlussOrt: eckdaten?.schlussOrt ?? null,
          schlussZeit: eckdaten?.schlussZeit ?? null,
          mitnehmen: eckdaten?.mitnehmen ?? null,
          anlass: null,
          kinder,
          eigeneAnmeldung,
        });
      },
    );
}
