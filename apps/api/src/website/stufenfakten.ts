import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { ort, programmEckdaten, seite, tag } from "../db/schema.js";
import { kartenLink } from "../karten-standort.js";
import type { Datenquelle } from "./abgleich.js";
import { teileMitnehmen } from "./mitnehmen.js";
import type { Fakt } from "./rendern.js";

// Die festen Felder einer Stufenseite (#355): je Stufe und Datum eine Zeile in programm_eckdaten.
// Die Zeile des nächsten Datums ab heute (Zürich) füllt den Baustein «stufenfakten».
// Die App liest dieselbe Tabelle in routes/programme.ts und merkt nichts davon.

export type Eckdatenzeile = {
  tag: string;
  treffZeit: string | null;
  treffpunkt: string | null;
  schlussZeit: string | null;
  schlussOrt: string | null;
  mitnehmen: string | null;
  // Aus dem Ort der Bibliothek (#646), wenn die Angabe einen wählt: Adresszeile und der Link zur Karte. Ohne Ort (Freitext, gelöscht) fehlen beide
  treffpunktZusatz?: string | null;
  treffpunktKarte?: string | null;
  schlussOrtZusatz?: string | null;
  schlussOrtKarte?: string | null;
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
  const mitOrt = (
    bezeichnung: string,
    wert: string | null,
    zusatz?: string | null,
    karte?: string | null,
  ) => {
    if (wert === null || wert.trim() === "") return;
    fakten.push({
      bezeichnung,
      wert,
      ...(zusatz && { zusatz }),
      ...(karte && { karte }),
    });
  };
  mit("Treffzeit", z.treffZeit && `${z.treffZeit} Uhr`);
  mitOrt("Treffpunkt", z.treffpunkt, z.treffpunktZusatz, z.treffpunktKarte);
  mit("Schlusszeit", z.schlussZeit && `${z.schlussZeit} Uhr`);
  mitOrt("Schlussort", z.schlussOrt, z.schlussOrtZusatz, z.schlussOrtKarte);
  // Mitnehmen ist ein längerer Text: als Liste, wenn es mehrere Dinge sind (#645)
  if (z.mitnehmen !== null && z.mitnehmen.trim() !== "") {
    const liste = teileMitnehmen(z.mitnehmen);
    fakten.push({
      bezeichnung: "Mitnehmen",
      wert: z.mitnehmen.trim(),
      lang: true,
      ...(liste && { liste }),
    });
  }
  return fakten;
}

// Eine Abfrage für alle Seiten: Seiten, deren Tag eine Stufe ist, mit der Zeile des nächsten Datums ab heute.
// Seiten ohne Zeile bekommen keinen Eintrag: Der Baustein entfällt dann
export const ladeStufenfakten: Datenquelle = async (
  db,
  abteilungId,
  seitenIds,
) => {
  const stufenfakten = new Map<string, Fakt[]>();
  if (seitenIds.length === 0) return { stufenfakten };
  // Der Ort der Bibliothek je Angabe (#646): nur ein Ort dieser Abteilung gibt Adresszeile und Karte her
  const treffOrt = alias(ort, "treff_ort");
  const schlussOrt = alias(ort, "schluss_ort_bib");
  const zeilen = await db
    .selectDistinctOn([seite.id], {
      seiteId: seite.id,
      tag: programmEckdaten.tag,
      treffZeit: programmEckdaten.treffZeit,
      treffpunkt: programmEckdaten.treffpunkt,
      schlussZeit: programmEckdaten.schlussZeit,
      schlussOrt: programmEckdaten.schlussOrt,
      mitnehmen: programmEckdaten.mitnehmen,
      treffBeschreibung: treffOrt.beschreibung,
      treffAdresse: treffOrt.karteAdresse,
      treffBreite: treffOrt.breite,
      treffLaenge: treffOrt.laenge,
      treffUrl: treffOrt.karteUrl,
      schlussBeschreibung: schlussOrt.beschreibung,
      schlussAdresse: schlussOrt.karteAdresse,
      schlussBreite: schlussOrt.breite,
      schlussLaenge: schlussOrt.laenge,
      schlussUrl: schlussOrt.karteUrl,
    })
    .from(seite)
    .innerJoin(tag, and(eq(tag.id, seite.tagId), eq(tag.typ, "stufe")))
    .innerJoin(programmEckdaten, eq(programmEckdaten.stufeId, tag.id))
    .leftJoin(
      treffOrt,
      and(
        eq(treffOrt.id, programmEckdaten.treffpunktOrtId),
        eq(treffOrt.abteilungId, abteilungId),
      ),
    )
    .leftJoin(
      schlussOrt,
      and(
        eq(schlussOrt.id, programmEckdaten.schlussOrtId),
        eq(schlussOrt.abteilungId, abteilungId),
      ),
    )
    .where(
      and(
        eq(seite.abteilungId, abteilungId),
        inArray(seite.id, seitenIds),
        sql`${programmEckdaten.tag} >= (now() at time zone 'Europe/Zurich')::date`,
      ),
    )
    .orderBy(seite.id, asc(programmEckdaten.tag));
  for (const z of zeilen) {
    stufenfakten.set(
      z.seiteId,
      faktenAus({
        ...z,
        treffpunktZusatz: z.treffBeschreibung,
        treffpunktKarte: kartenLink({
          adresse: z.treffAdresse,
          breite: z.treffBreite,
          laenge: z.treffLaenge,
          url: z.treffUrl,
        }),
        schlussOrtZusatz: z.schlussBeschreibung,
        schlussOrtKarte: kartenLink({
          adresse: z.schlussAdresse,
          breite: z.schlussBreite,
          laenge: z.schlussLaenge,
          url: z.schlussUrl,
        }),
      }),
    );
  }
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
