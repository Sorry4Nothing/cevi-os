import { and, eq, gt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  anlass,
  anlassAnmeldung,
  anlassFeld,
  kind,
  tag,
  user,
} from "../db/schema.js";

// Anmeldungen eines Anlasses für die Abteilungsleitung (#444): die Daten für Liste und CSV-Export, wiederverwendbar für den Reiter (#445).
// Name, Telefon und die Angaben des Kindes liest jede Abfrage live aus dem Konto; die Anmeldung speichert nur die Antworten. Alle Abfragen sind gebündelt, keine läuft je Zeile.

export type AnmeldungStatus = "angemeldet" | "abgemeldet";
export type StatusFilter = AnmeldungStatus | "alle";
export type Antworten = Record<string, string | boolean>;

export type Anmeldung = {
  id: string;
  person: { id: string; name: string; telefon: string | null };
  kind: {
    id: string;
    vorname: string;
    nachname: string;
    ceviName: string | null;
    stufe: string;
  } | null;
  status: AnmeldungStatus;
  antworten: Antworten;
  geaendertAm: Date;
};

// Der Cursor der Liste ist undurchsichtig: Änderungszeit in ganzen Millisekunden und ID des letzten Eintrags der Vorseite
const cursorSchema = z.tuple([
  z.number().int().min(0).max(8.64e15),
  z.uuid().toLowerCase(),
]);
export type Cursor = z.infer<typeof cursorSchema>;

export function liesCursor(nach: string): Cursor | null {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(nach, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}
export const schreibeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");

// Änderungszeit auf ganze Millisekunden, damit Sortierung, Cursor und Vergleich dieselbe Zahl benutzen
const AENDERUNG_MS = sql`floor(extract(epoch from ${anlassAnmeldung.geaendertAm}) * 1000)::bigint`;

export type Feld = {
  schluessel: string;
  beschriftung: string;
  typ: "text" | "ja_nein" | "auswahl";
};

// Der Anlass der eigenen Abteilung mit der Zahl der Anmeldungen je Status und seinen Feldern, in einer Abfrage. null = unbekannt oder fremd (404)
export async function ladeAnlassMitSumme(
  db: Db,
  abteilungId: string,
  anlassId: string,
) {
  const zeilen = await db.execute<{
    angemeldet: number;
    abgemeldet: number;
    felder: Feld[];
  }>(sql`
    select
      (select count(*) from ${anlassAnmeldung} m where m.anlass_id = a.id and m.status = 'angemeldet')::int as angemeldet,
      (select count(*) from ${anlassAnmeldung} m where m.anlass_id = a.id and m.status = 'abgemeldet')::int as abgemeldet,
      coalesce((
        select jsonb_agg(jsonb_build_object('schluessel', f.schluessel, 'beschriftung', f.beschriftung, 'typ', f.typ) order by f.reihenfolge, f.schluessel)
        from ${anlassFeld} f where f.anlass_id = a.id
      ), '[]'::jsonb) as felder
    from ${anlass} a
    where a.id = ${anlassId} and a.abteilung_id = ${abteilungId}`);
  return zeilen[0] ?? null;
}

const statusBedingung = (status: StatusFilter) =>
  status === "alle" ? undefined : eq(anlassAnmeldung.status, status);

function ladeZeilen(
  db: Db,
  anlassId: string,
  status: StatusFilter,
  zusatz: SQL | undefined,
) {
  return db
    .select({
      id: anlassAnmeldung.id,
      status: anlassAnmeldung.status,
      antworten: anlassAnmeldung.antworten,
      geaendertAm: anlassAnmeldung.geaendertAm,
      sortMs: sql<number>`${AENDERUNG_MS}::float8`,
      personId: user.id,
      personName: user.name,
      telefon: user.telefon,
      kindId: kind.id,
      vorname: kind.vorname,
      nachname: kind.nachname,
      ceviName: kind.ceviName,
      stufe: tag.name,
    })
    .from(anlassAnmeldung)
    .innerJoin(user, eq(user.id, anlassAnmeldung.userId))
    .leftJoin(kind, eq(kind.id, anlassAnmeldung.kindId))
    .leftJoin(tag, eq(tag.id, kind.stufeId))
    .where(
      and(
        eq(anlassAnmeldung.anlassId, anlassId),
        statusBedingung(status),
        zusatz,
      ),
    );
}

type Zeile = Awaited<ReturnType<typeof ladeZeilen>>[number];
const alsAnmeldung = (z: Zeile): Anmeldung => ({
  id: z.id,
  person: { id: z.personId, name: z.personName, telefon: z.telefon },
  kind:
    z.kindId && z.vorname !== null && z.nachname !== null && z.stufe !== null
      ? {
          id: z.kindId,
          vorname: z.vorname,
          nachname: z.nachname,
          ceviName: z.ceviName,
          stufe: z.stufe,
        }
      : null,
  status: z.status,
  antworten: z.antworten,
  geaendertAm: z.geaendertAm,
});

// Eine Seite der Liste: zuletzt geänderte zuerst, nach (Änderungszeit, ID). Eine Abfrage. shortcut: kein Index auf (anlass_id, geaendert_am), der Anlass hat höchstens einige hundert Anmeldungen und die Zeilen kommen über den Index auf anlass_id; mit Tausenden Anmeldungen je Anlass einen Index ergänzen
export async function ladeSeite(
  db: Db,
  anlassId: string,
  status: StatusFilter,
  limit: number,
  cursor?: Cursor,
) {
  const zeilen = await ladeZeilen(
    db,
    anlassId,
    status,
    cursor &&
      sql`(${AENDERUNG_MS}, ${anlassAnmeldung.id}) < (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
  )
    .orderBy(sql`${AENDERUNG_MS} desc`, sql`${anlassAnmeldung.id} desc`)
    .limit(limit + 1);
  const weitere = zeilen.length > limit;
  const seite = zeilen.slice(0, limit);
  const letzte = seite.at(-1);
  return {
    eintraege: seite.map(alsAnmeldung),
    weitere,
    naechste:
      weitere && letzte ? schreibeCursor([letzte.sortMs, letzte.id]) : null,
  };
}

// Ein Block für den Export, nach ID aufsteigend (uuidv7, also nach Anlegen). Die ID ändert sich nie: Eine Anmeldung, die während des Exports geändert wird, erscheint nicht doppelt. Eine Abfrage je Block
export function ladeBlock(
  db: Db,
  anlassId: string,
  status: StatusFilter,
  limit: number,
  nachId?: string,
) {
  return ladeZeilen(
    db,
    anlassId,
    status,
    nachId ? gt(anlassAnmeldung.id, nachId) : undefined,
  )
    .orderBy(anlassAnmeldung.id)
    .limit(limit)
    .then((zeilen) => zeilen.map(alsAnmeldung));
}
