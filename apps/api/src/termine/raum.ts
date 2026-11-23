import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  abteilung,
  personTag,
  raum,
  raumBuchung,
  tag,
  user,
} from "../db/schema.js";
import { TEAM_ROLLE } from "../bearbeiten.js";
import type { Person } from "../rechte.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Die Abfrage beider Listen (Mitglieder und Verwaltung): limit 1 bis 100 (50), nach = naechste der Vorseite
export const raeumeListeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.string().min(1).max(100).optional(),
});

// Räume (#446, Epic #430). Die Raumanfragen (#447, termine/raum-buchung.ts) bauen auf diesen Funktionen auf: ladeRaum (Raum der Abteilung, fremd = undefined = 404), ladeRaeume (Liste), zaehleOffeneAnfragen.

// Wer Räume anlegt, pflegt und einem Team zuweist, bestimmen die Rechte «raum.verwalten» und «raum.team_zuweisen» (rechtemodell/katalog.ts); die Routen der Verwaltung prüfen sie mit verlange() (#649). Lesen darf jede Person der Abteilung.

// Der Raum der Abteilung, in SQL auf sie gefiltert; mit sperren (FOR UPDATE, nur in einer Transaktion) hält die Zeile still, bis die Transaktion endet
export async function ladeRaum(
  tx: Db | Tx,
  abteilungId: string,
  id: string,
  sperren = false,
) {
  const abfrage = tx
    .select({
      id: raum.id,
      name: raum.name,
      aktiv: raum.aktiv,
      teamTagId: raum.teamTagId,
    })
    .from(raum)
    .where(and(eq(raum.id, id), eq(raum.abteilungId, abteilungId)));
  const [zeile] = await (sperren ? abfrage.for("update") : abfrage);
  return zeile;
}

// Wie viele Anfragen und Buchungen den Raum noch festhalten: offene Anfragen und bestätigte Buchungen, die noch nicht vorbei sind (#447). Darüber sperrt das Löschen eines Raums (409 ANFRAGEN_OFFEN). Läuft in der Transaktion der Route, die den Raum schon gesperrt hat; eine Abfrage (Indizes raum_buchung_offen_idx und der GiST-Index der Überschneidung)
export async function zaehleOffeneAnfragen(
  tx: Db | Tx,
  raumId: string,
): Promise<number> {
  const [zeile] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(raumBuchung)
    .where(
      and(
        eq(raumBuchung.raumId, raumId),
        inArray(raumBuchung.status, ["angefragt", "bestaetigt"]),
        sql`${raumBuchung.ende} > now()`,
      ),
    );
  return zeile?.n ?? 0;
}

// Sortierschlüssel und zugleich Seitenmarke: Der Name ist je Abteilung ohne Gross-/Kleinschreibung eindeutig (Index raum_name_eindeutig), also ordnet lower(name) die Räume lückenlos und ohne Doppelte
const sortName = sql<string>`lower(${raum.name})`;

export interface RaumAnsicht {
  id: string;
  name: string;
  ort: string | null;
  beschreibung: string | null;
  kapazitaet: number | null;
  aktiv: boolean;
  team: { id: string; name: string } | null;
}

// Eine Seite der Räume der Abteilung, nach Name. Eine Abfrage (der Tag des Teams per Join), limit + 1 Zeilen; nach = naechste der Vorseite. nurAktiv: Mitglieder sehen nur aktive Räume, die Verwaltung alle
export async function ladeRaeume(
  db: Db | Tx,
  opt: {
    abteilungId: string;
    nurAktiv: boolean;
    limit: number;
    nach?: string;
    // Nur die Räume dieses Teams (die Teamansicht)
    teamId?: string;
    // Nur die Räume, für die die Person ein Recht hat (termine/rechte.ts: raumBedingung)
    bedingung?: SQL;
  },
): Promise<{
  raeume: RaumAnsicht[];
  weitere: boolean;
  naechste: string | null;
}> {
  const zeilen = await db
    .select({
      id: raum.id,
      name: raum.name,
      ort: raum.ort,
      beschreibung: raum.beschreibung,
      kapazitaet: raum.kapazitaet,
      aktiv: raum.aktiv,
      teamId: tag.id,
      teamName: tag.name,
      sortName,
    })
    .from(raum)
    .leftJoin(tag, eq(tag.id, raum.teamTagId))
    .where(
      and(
        eq(raum.abteilungId, opt.abteilungId),
        opt.nurAktiv ? eq(raum.aktiv, true) : undefined,
        opt.teamId ? eq(raum.teamTagId, opt.teamId) : undefined,
        opt.bedingung,
        opt.nach !== undefined ? sql`${sortName} > ${opt.nach}` : undefined,
      ),
    )
    .orderBy(asc(sortName))
    .limit(opt.limit + 1);
  const seite = zeilen.slice(0, opt.limit);
  const weitere = zeilen.length > opt.limit;
  return {
    raeume: seite.map((z) => ({
      id: z.id,
      name: z.name,
      ort: z.ort,
      beschreibung: z.beschreibung,
      kapazitaet: z.kapazitaet,
      aktiv: z.aktiv,
      team:
        z.teamId && z.teamName !== null
          ? { id: z.teamId, name: z.teamName }
          : null,
    })),
    weitere,
    naechste: weitere ? seite[seite.length - 1]!.sortName : null,
  };
}

// Belegungsplan (#628): Der alte Weg für «raum.belegung», nur noch von der Hülle rechtemodell/alt.ts und vom Schattenbetrieb gebraucht; die Routen fragen verlange(). Wer die Belegung der Räume sieht (Wunsch des Nutzers: «alle Leiter»; Annahme, vom Nutzer zu bestätigen): jede Leitung, also die Abteilungsleitung, wer eine Rolle «leitung» oder «stufenleitung» an einer Stufe hat, Verantwortliche eines Teams und wer den Team-Tag eines Raums trägt (entscheidet über dessen Anfragen). Eltern und Personen ohne eine dieser Aufgaben nicht. Eine Abfrage, und nur für Personen, die nicht schon über Admin oder eine Stufenrolle zählen. Ein Admin ohne zweiten Faktor zählt mit: Die Route liegt nicht unter /admin und gibt nichts frei, was die Leitung nicht schon in der App sieht.
export async function darfBelegungSehen(db: Db, person: Person) {
  if (person.admin || person.rollen.length > 0) return true;
  const [zeile] = await db
    .select({
      ok: sql<boolean>`exists (select 1 from ${personTag} inner join ${tag} on ${tag.id} = ${personTag.tagId} where ${personTag.userId} = ${person.id} and ${tag.abteilungId} = ${person.abteilungId} and ((lower(${personTag.rolle}) = ${TEAM_ROLLE} and ${tag.typ} = 'team') or ${personTag.tagId} in (select ${raum.teamTagId} from ${raum} where ${raum.abteilungId} = ${person.abteilungId} and ${raum.teamTagId} is not null)))`,
    })
    .from(abteilung)
    .where(eq(abteilung.id, person.abteilungId));
  return zeile?.ok === true;
}

// Höchstens 31 Tage je Aufruf (von und bis eingeschlossen, Schweizer Tage) und höchstens so viele Zeilen
export const BELEGUNG_MAX_TAGE = 31;
export const BELEGUNG_MAX_ZEILEN = 500;
const TAG_MS = 864e5;

export const belegungSchema = z
  .strictObject({
    von: z.iso.date(),
    bis: z.iso.date(),
    // «nein» lässt die offenen Anfragen weg; Vorgabe «ja»
    anfragen: z.enum(["ja", "nein"]).default("ja"),
    raumId: z.uuid().optional(),
  })
  .refine((v) => v.bis >= v.von)
  .refine(
    (v) => (Date.parse(v.bis) - Date.parse(v.von)) / TAG_MS < BELEGUNG_MAX_TAGE,
  );

export interface BelegungAnsicht {
  von: string;
  bis: string;
  zeitzone: "Europe/Zurich";
  raeume: { id: string; name: string; ort: string | null }[];
  buchungen: {
    id: string;
    raumId: string;
    beginn: Date;
    ende: Date;
    zweck: string;
    status: "bestaetigt" | "angefragt";
    person: string;
  }[];
  weitere: boolean;
}

// Die aktiven Räume und ihre Belegung im Zeitraum: zwei Abfragen (Räume, Buchungen mit Join auf das Konto), unabhängig von der Zahl der Räume. Bestätigte Buchungen; offene Anfragen nur, wenn sie noch nicht vorbei sind. Abgelehnte und stornierte nie. Zeitraum und Tage in Schweizer Zeit: von 00:00 bis zum Tag nach «bis» 00:00. Von der Person nur der Cevi-Name, sonst der Vorname; nie Nachname, Telefon oder E-Mail
export async function ladeBelegung(
  db: Db,
  opt: {
    abteilungId: string;
    von: string;
    bis: string;
    mitAnfragen: boolean;
    raumId?: string;
    // Nur die Räume, für die die Person «raum.belegung» hat (termine/rechte.ts: raumBedingung)
    bedingung?: SQL;
  },
): Promise<BelegungAnsicht> {
  const anfang = sql`(${opt.von}::date)::timestamp at time zone 'Europe/Zurich'`;
  const schluss = sql`((${opt.bis}::date) + 1)::timestamp at time zone 'Europe/Zurich'`;
  const raeumeZeilen = await db
    .select({ id: raum.id, name: raum.name, ort: raum.ort })
    .from(raum)
    .where(
      and(
        eq(raum.abteilungId, opt.abteilungId),
        eq(raum.aktiv, true),
        opt.raumId ? eq(raum.id, opt.raumId) : undefined,
        opt.bedingung,
      ),
    )
    .orderBy(asc(sortName))
    .limit(200);
  if (raeumeZeilen.length === 0) {
    return {
      von: opt.von,
      bis: opt.bis,
      zeitzone: "Europe/Zurich",
      raeume: [],
      buchungen: [],
      weitere: false,
    };
  }
  const zeilen = await db
    .select({
      id: raumBuchung.id,
      raumId: raumBuchung.raumId,
      beginn: raumBuchung.beginn,
      ende: raumBuchung.ende,
      zweck: raumBuchung.zweck,
      status: raumBuchung.status,
      person: sql<string>`coalesce(nullif(trim(${user.ceviName}), ''), split_part(trim(${user.name}), ' ', 1))`,
    })
    .from(raumBuchung)
    .innerJoin(raum, eq(raum.id, raumBuchung.raumId))
    .innerJoin(user, eq(user.id, raumBuchung.userId))
    .where(
      and(
        eq(raum.abteilungId, opt.abteilungId),
        eq(raum.aktiv, true),
        opt.raumId ? eq(raum.id, opt.raumId) : undefined,
        opt.bedingung,
        sql`${raumBuchung.beginn} < ${schluss} and ${raumBuchung.ende} > ${anfang}`,
        opt.mitAnfragen
          ? sql`(${raumBuchung.status} = 'bestaetigt' or (${raumBuchung.status} = 'angefragt' and ${raumBuchung.ende} > now()))`
          : eq(raumBuchung.status, "bestaetigt"),
      ),
    )
    .orderBy(asc(raumBuchung.beginn), asc(raumBuchung.id))
    .limit(BELEGUNG_MAX_ZEILEN + 1);
  return {
    von: opt.von,
    bis: opt.bis,
    zeitzone: "Europe/Zurich",
    raeume: raeumeZeilen,
    buchungen: zeilen.slice(0, BELEGUNG_MAX_ZEILEN).map((z) => ({
      ...z,
      status: z.status === "bestaetigt" ? "bestaetigt" : "angefragt",
    })),
    weitere: zeilen.length > BELEGUNG_MAX_ZEILEN,
  };
}
