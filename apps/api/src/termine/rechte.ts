import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import { personTag, raum, tag } from "../db/schema.js";
import { darf, ZweiterFaktorFehlt } from "../rechtemodell/darf.js";
import { ladeRechteSatz, type Objekt } from "../rechtemodell/satz.js";
import type { Person } from "../rechte.js";

// Rechte der Termine, Anlässe und Räume auf dem zentralen Weg (#649, Umstellung nach docs/rechte-umstellung.md). Die Routen prüfen mit verlange() (rechtemodell/darf.ts); diese Datei ergänzt, was Listen und Türen brauchen: die Antwort ohne Wurf, die Sicht auf Räume und Anlässe, für die eine Person ein Recht hat, und das Signal für die Verwaltung im Browser.
// Eine Liste fragt nie je Zeile: Sie holt einmal, welche Teams und Anlässe die Person trifft (der RechteSatz liegt je Anfrage im Speicher), und filtert danach in SQL.

type Lesbar = Pick<Db, "select" | "execute">;

// darf() samt zweitem Faktor, aber ohne Wurf: für Listen und Signale, die leer bleiben statt 403 zu antworten
export async function darfMitFaktor(
  db: Lesbar,
  person: Person,
  recht: string,
  objekt?: Objekt,
): Promise<boolean> {
  if (!(await darf(db, person, recht, objekt))) return false;
  if (person.zweiterFaktor) return true;
  return !(await ladeRechteSatz(db, person)).braucht2Faktor(recht, objekt);
}

// Wie verlange(), aber mit mehreren Rechten, von denen eines genügt (zum Beispiel «Anlass verwalten» oder «Anmeldungen sehen» für den Anlass). 403, wenn keines zutrifft; danach 403 ZWEITER_FAKTOR_FEHLT, wenn jedes zutreffende ihn verlangt
export async function verlangeEines(
  db: Lesbar,
  person: Person,
  rechte: readonly string[],
  objekt?: Objekt,
): Promise<void> {
  const erfuellt: string[] = [];
  for (const r of rechte)
    if (await darf(db, person, r, objekt)) erfuellt.push(r);
  if (erfuellt.length === 0) throw new HTTPException(403);
  if (person.zweiterFaktor) return;
  const satz = await ladeRechteSatz(db, person);
  if (erfuellt.every((r) => satz.braucht2Faktor(r, objekt))) {
    throw new ZweiterFaktorFehlt();
  }
}

// Die Räume, für die die Person mindestens eines der Rechte hat: je Team des Raums eine Frage im Speicher, dazu eine für Räume ohne Team. «alle» heisst: jede Gruppe und kein Team
export interface RaumSicht {
  alle: boolean;
  ohneTeam: boolean;
  teamIds: string[];
}

export async function raeumeMit(
  db: Lesbar,
  person: Person,
  rechte: readonly string[],
): Promise<RaumSicht> {
  const zeilen = await db
    .select({ id: raum.teamTagId })
    .from(raum)
    .where(
      and(eq(raum.abteilungId, person.abteilungId), isNotNull(raum.teamTagId)),
    )
    .groupBy(raum.teamTagId);
  const kandidaten = zeilen.flatMap((z) => (z.id ? [z.id] : []));
  const trifft = async (teamTagId: string | null) => {
    for (const r of rechte) {
      if (
        await darfMitFaktor(db, person, r, {
          abteilungId: person.abteilungId,
          raumTeamTagId: teamTagId,
        })
      ) {
        return true;
      }
    }
    return false;
  };
  const ohneTeam = await trifft(null);
  const teamIds: string[] = [];
  for (const id of kandidaten) if (await trifft(id)) teamIds.push(id);
  return {
    alle: ohneTeam && teamIds.length === kandidaten.length,
    ohneTeam,
    teamIds,
  };
}

export const hatRaeume = (s: RaumSicht) => s.ohneTeam || s.teamIds.length > 0;

// Die Bedingung auf raum.team_tag_id; undefined = keine Einschränkung
export function raumBedingung(s: RaumSicht): SQL | undefined {
  if (s.alle) return undefined;
  const teile: SQL[] = [];
  if (s.ohneTeam) teile.push(sql`${raum.teamTagId} is null`);
  if (s.teamIds.length > 0) teile.push(inArray(raum.teamTagId, s.teamIds));
  return teile.length > 0 ? or(...teile) : sql`false`;
}

// Die Anlässe, für die die Person mindestens eines der Rechte hat: «alle», wenn sie es abteilungsweit hat, sonst die Anlässe ihrer Gruppen vom Typ «anlass» (tag.anlass_id), für die das Recht gilt. Eine Gruppe ohne Rolle mit dem Recht trifft nichts
export async function anlaesseMit(
  db: Lesbar,
  person: Person,
  rechte: readonly string[],
): Promise<"alle" | string[]> {
  for (const r of rechte) {
    if (
      await darfMitFaktor(db, person, r, {
        abteilungId: person.abteilungId,
        abteilungsweit: true,
      })
    ) {
      return "alle";
    }
  }
  const zeilen = await db
    .select({ id: tag.anlassId })
    .from(personTag)
    .innerJoin(tag, eq(tag.id, personTag.tagId))
    .where(
      and(
        eq(personTag.userId, person.id),
        eq(tag.abteilungId, person.abteilungId),
        isNotNull(tag.anlassId),
      ),
    )
    .groupBy(tag.anlassId);
  const treffer: string[] = [];
  for (const z of zeilen) {
    if (!z.id) continue;
    for (const r of rechte) {
      if (
        await darfMitFaktor(db, person, r, {
          abteilungId: person.abteilungId,
          anlassId: z.id,
        })
      ) {
        treffer.push(z.id);
        break;
      }
    }
  }
  return treffer;
}

// Was die Person an einem Anlass darf, für die Oberfläche (Reiter und Knöpfe); nur Anzeige, jede Route prüft selbst. Im Speicher, ohne Abfrage (der RechteSatz liegt schon da)
export async function anlassRechte(
  db: Lesbar,
  person: Person,
  anlassId: string,
) {
  const objekt = { abteilungId: person.abteilungId, anlassId };
  const [verwalten, anmeldungenSehen, anmeldungenExportieren, loeschen] =
    await Promise.all([
      darfMitFaktor(db, person, "anlass.verwalten", objekt),
      darfMitFaktor(db, person, "anlass.anmeldungen_sehen", objekt),
      darfMitFaktor(db, person, "anlass.anmeldungen_exportieren", objekt),
      darfMitFaktor(db, person, "anlass.anlegen", objekt),
    ]);
  return { verwalten, anmeldungenSehen, anmeldungenExportieren, loeschen };
}

// Was die Verwaltung im Browser wissen muss, um Einträge einzublenden (GET /api/v1/redaktion/ich): nur Anzeige, jede Route prüft selbst. Je Recht höchstens die Fragen oben, keine je Zeile
export async function termineZugang(db: Lesbar, person: Person) {
  const [
    belegung,
    entscheiden,
    verwalten,
    zuweisen,
    raumAnlegen,
    anlassVerwalten,
    anmeldungen,
    export_,
    anlegen,
    vorschlaege,
    vorschlaegeEntscheiden,
    warnliste,
    kategorien,
  ] = await Promise.all([
    raeumeMit(db, person, ["raum.belegung"]),
    raeumeMit(db, person, ["raum.anfrage_entscheiden"]),
    raeumeMit(db, person, ["raum.verwalten"]),
    darfMitFaktor(db, person, "raum.team_zuweisen"),
    darfMitFaktor(db, person, "raum.verwalten", {
      abteilungId: person.abteilungId,
      abteilungsweit: true,
    }),
    anlaesseMit(db, person, ["anlass.verwalten"]),
    anlaesseMit(db, person, ["anlass.anmeldungen_sehen"]),
    anlaesseMit(db, person, ["anlass.anmeldungen_exportieren"]),
    darfMitFaktor(db, person, "anlass.anlegen"),
    darf(db, person, "vorschlag.einreichen"),
    darfMitFaktor(db, person, "vorschlag.entscheiden"),
    darfMitFaktor(db, person, "termine.warnliste"),
    darfMitFaktor(db, person, "termine.kategorien_zuordnen"),
  ]);
  const irgendeiner = (x: "alle" | string[]) => x === "alle" || x.length > 0;
  return {
    raumBelegung: hatRaeume(belegung),
    raumAnfragen: hatRaeume(entscheiden),
    raumVerwalten: hatRaeume(verwalten),
    raumZuweisen: zuweisen,
    // Die Räume lesen und pflegen: Räume verwalten oder Teams zuweisen
    raumListe: hatRaeume(verwalten) || zuweisen,
    raumAnlegen,
    // Der Bereich Anlässe öffnet sich mit einem der drei Rechte an mindestens einem Anlass
    anlaesse:
      irgendeiner(anlassVerwalten) ||
      irgendeiner(anmeldungen) ||
      irgendeiner(export_),
    anlassVerwalten: irgendeiner(anlassVerwalten),
    anlassAnlegen: anlegen,
    anmeldungenSehen: irgendeiner(anmeldungen),
    anmeldungenExportieren: irgendeiner(export_),
    vorschlagen: vorschlaege,
    vorschlaegeEntscheiden,
    warnliste,
    kategorien,
  };
}
