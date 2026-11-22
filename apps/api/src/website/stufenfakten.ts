import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { programmEckdaten, seite, tag } from "../db/schema.js";
import type { Datenquelle } from "./abgleich.js";
import type { Fakt } from "./rendern.js";

// Die festen Felder einer Stufenseite (#355): je Stufe und Datum eine Zeile in programm_eckdaten.
// Die Zeile des nächsten Datums ab heute (Zürich) füllt den Baustein «stufenfakten»; eine im Editor gepflegte Zeile (quelle «seite») geht der ausgelesenen (quelle «web») vor, solange sie nicht in der Vergangenheit liegt.
// Die App liest dieselbe Tabelle in routes/programme.ts und merkt nichts davon.

export type Eckdatenzeile = {
  tag: string;
  treffZeit: string | null;
  treffpunkt: string | null;
  schlussZeit: string | null;
  schlussOrt: string | null;
  mitnehmen: string | null;
};

// Zeiten HH:MM und Datum JJJJ-MM-TT, wie die Datenbank sie führt
export const ZEIT_MUSTER = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_ORT = 500;
export const MAX_MITNEHMEN = 1000;
// Gepflegte Zeilen je Stufe, die in der Zukunft liegen dürfen
export const MAX_GEPFLEGT = 20;

// «2026-12-05» nur, wenn es den Tag gibt («2026-02-30» nicht)
export function istTag(wert: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wert)) return false;
  const d = new Date(`${wert}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(wert);
}

export const heuteZuerich = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

const datumFormat = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// Nur Felder mit Inhalt; der Text bleibt Text (der Renderer maskiert ihn)
export function faktenAus(z: Eckdatenzeile): Fakt[] {
  const fakten: Fakt[] = [
    {
      bezeichnung: "Datum",
      wert: datumFormat.format(new Date(`${z.tag}T12:00:00Z`)),
    },
  ];
  const mit = (bezeichnung: string, wert: string | null) => {
    if (wert !== null && wert.trim() !== "") fakten.push({ bezeichnung, wert });
  };
  mit("Treffzeit", z.treffZeit && `${z.treffZeit} Uhr`);
  mit("Treffpunkt", z.treffpunkt);
  mit("Schlusszeit", z.schlussZeit && `${z.schlussZeit} Uhr`);
  mit("Schlussort", z.schlussOrt);
  mit("Mitnehmen", z.mitnehmen);
  return fakten;
}

// Eine Abfrage für alle Seiten: Seiten, deren Tag eine Stufe ist, mit der Zeile des nächsten Datums ab heute; gepflegte Zeilen zuerst.
// Seiten ohne Zeile bekommen keinen Eintrag: Der Baustein entfällt dann
export const ladeStufenfakten: Datenquelle = async (
  db,
  abteilungId,
  seitenIds,
) => {
  const stufenfakten = new Map<string, Fakt[]>();
  if (seitenIds.length === 0) return { stufenfakten };
  const zeilen = await db
    .selectDistinctOn([seite.id], {
      seiteId: seite.id,
      tag: programmEckdaten.tag,
      treffZeit: programmEckdaten.treffZeit,
      treffpunkt: programmEckdaten.treffpunkt,
      schlussZeit: programmEckdaten.schlussZeit,
      schlussOrt: programmEckdaten.schlussOrt,
      mitnehmen: programmEckdaten.mitnehmen,
    })
    .from(seite)
    .innerJoin(tag, and(eq(tag.id, seite.tagId), eq(tag.typ, "stufe")))
    .innerJoin(programmEckdaten, eq(programmEckdaten.stufeId, tag.id))
    .where(
      and(
        eq(seite.abteilungId, abteilungId),
        inArray(seite.id, seitenIds),
        sql`${programmEckdaten.tag} >= (now() at time zone 'Europe/Zurich')::date`,
      ),
    )
    .orderBy(
      seite.id,
      desc(sql`${programmEckdaten.quelle} = 'seite'`),
      asc(programmEckdaten.tag),
    );
  for (const z of zeilen) stufenfakten.set(z.seiteId, faktenAus(z));
  return { stufenfakten };
};

// Für das Nachladen geschützter Bausteine (#354): höchstens ein Abruf je Seite und fünf Minuten in diesem Prozess.
// shortcut: Der Zwischenspeicher lebt im Prozess; bei mehreren Instanzen sieht eine Änderung nur die eigene sofort, die anderen nach fünf Minuten
const ZWISCHEN_MS = 5 * 60_000;
const MAX_ZWISCHEN = 500;
const zwischen = new Map<string, { bis: number; fakten: Fakt[] | undefined }>();

export const vergissStufenfakten = () => zwischen.clear();

export async function ladeStufenfaktenGemerkt(
  db: Db,
  abteilungId: string,
  seiteId: string,
): Promise<Fakt[] | undefined> {
  const jetzt = Date.now();
  const treffer = zwischen.get(seiteId);
  if (treffer && treffer.bis > jetzt) return treffer.fakten;
  const { stufenfakten } = await ladeStufenfakten(db, abteilungId, [seiteId]);
  const fakten = stufenfakten?.get(seiteId);
  if (zwischen.size >= MAX_ZWISCHEN) zwischen.clear();
  zwischen.set(seiteId, { bis: jetzt + ZWISCHEN_MS, fakten });
  return fakten;
}
