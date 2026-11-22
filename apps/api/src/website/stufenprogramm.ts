import { and, eq, sql as roh } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { programm, programmStufe } from "../db/schema.js";
import { programmBeginn } from "../rechte.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Die ID ersetzt die Google-ID; so findet das Speichern und Löschen der gepflegten Zeile (#355, #361) dasselbe Programm wieder
const eventId = (stufeId: string, tag: string) => `web:${stufeId}:${tag}`;

// Abteilungen ohne Kalender: Das Programm entsteht aus den gepflegten Feldern der Stufenseite (Datum, Treffzeit, Schlusszeit). Mit Kalender ist er die Quelle der Samstage, dann entsteht nichts.
// Läuft nur beim Speichern der Felder (Ereignis), nie im Takt.
// shortcut: Hängt die Abteilung später einen Kalender an, räumt der Kalender-Sync diese Programme nicht weg; dann eine Spalte «quelle» an «programm» einführen
export async function legeStufenprogrammAn(
  tx: Tx,
  eine: {
    stufeId: string;
    stufeName: string;
    abteilungId: string;
    kalenderId: string | null;
  },
  e: { tag: string; treffZeit: string | null; schlussZeit: string | null },
) {
  if (eine.kalenderId !== null) return;
  const googleEventId = eventId(eine.stufeId, e.tag);
  // Ohne beide Zeiten (oder mit Schluss vor Beginn) ganztägig; «HH:MM» vergleicht sich als Text
  const mitZeit =
    e.treffZeit !== null &&
    e.schlussZeit !== null &&
    e.treffZeit < e.schlussZeit;
  const zeit = (hhmm: string | null) =>
    mitZeit
      ? roh`(${e.tag}::date + ${hhmm}::time) at time zone 'Europe/Zurich'`
      : null;
  const werte = {
    titel: `Cevi-Programm ${eine.stufeName}`,
    ganztaegig: !mitZeit,
    beginn: zeit(e.treffZeit),
    ende: zeit(e.schlussZeit),
    tagVon: mitZeit ? null : e.tag,
    tagBis: mitZeit ? null : e.tag,
  };
  const [eins] = await tx
    .insert(programm)
    .values({
      abteilungId: eine.abteilungId,
      googleEventId,
      sichtbarkeit: "eltern",
      ...werte,
    })
    .onConflictDoUpdate({
      target: [programm.abteilungId, programm.googleEventId],
      set: werte,
    })
    .returning({ id: programm.id });
  await tx
    .insert(programmStufe)
    .values({ programmId: eins.id, stufeId: eine.stufeId })
    .onConflictDoNothing();
}

// Löscht der Editor die gepflegte Zeile, verschwindet das kommende Programm dazu (Vergangenes bleibt)
export async function entferneStufenprogramm(
  tx: Tx,
  abteilungId: string,
  stufeId: string,
  tag: string,
) {
  await tx
    .delete(programm)
    .where(
      and(
        eq(programm.abteilungId, abteilungId),
        eq(programm.googleEventId, eventId(stufeId, tag)),
        roh`${programmBeginn} > now()`,
      ),
    );
}
