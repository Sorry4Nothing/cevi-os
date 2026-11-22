import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { raum, raumBuchung, tag } from "../db/schema.js";
import type { Person } from "../rechte.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Die Abfrage beider Listen (Mitglieder und Verwaltung): limit 1 bis 100 (50), nach = naechste der Vorseite
export const raeumeListeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.string().min(1).max(100).optional(),
});

// Räume (#446, Epic #430). Die Raumanfragen (#447, termine/raum-buchung.ts) bauen auf diesen Funktionen auf: ladeRaum (Raum der Abteilung, fremd = undefined = 404), ladeRaeume (Liste), zaehleOffeneAnfragen.

// Wer Räume anlegt und pflegt (Recht «raum.verwalten», Annahme R1, vom Nutzer zu bestätigen): nur die Abteilungsleitung, also ein Admin mit zweitem Faktor (den verlangt schon der Pfad /api/v1/admin/*). Lesen darf jede Person der Abteilung. Alle Routen der Verwaltung prüfen hier und nirgends sonst; kommen Rollen dazu (#423), ändert sich nur diese Funktion.
export const darfRaeumeVerwalten = (person: Pick<Person, "admin">) =>
  person.admin;

// Erst das Objekt laden (fremd = 404), dann diese Prüfung (403)
export function pruefeRaumRecht(person: Pick<Person, "admin">) {
  if (!darfRaeumeVerwalten(person)) throw new HTTPException(403);
}

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
