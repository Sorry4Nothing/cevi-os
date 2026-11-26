import { and, eq, ne, sql } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { istAbteilungsleitungSql } from "../admins.js";
import type { Db } from "../db/client.js";
import { personTag, user } from "../db/schema.js";
import { log } from "../log.js";
import { sendePush, type Fcm } from "../push.js";
import { aktivesKonto, type Person } from "../rechte.js";
import { TERMINE_PUSH_ARTEN } from "./push-arten.js";
import { EINZEILIG, MEHRZEILIG } from "./vorschlag.js";

// Raumanfragen (#447, Epic #430): Eingabe, wer entscheiden darf, Push und Löschlauf. Die Räume selbst stehen in raum.ts.

// Grenzen (Annahmen, vom Nutzer zu bestätigen); die Länge und die Dauer stehen auch als CHECK in der Tabelle
export const MAX_OFFENE_JE_PERSON = 10;
export const MAX_TAGE = 14;
// Wie lange eine Anfrage nach dem Ende der Zeit bleibt (wie die Anmeldungen, Annahme A13)
export const AUFBEWAHRUNG_TAGE = 180;

const zeit = z.iso.datetime({ offset: true });
export const anfrageSchema = z
  .strictObject({
    beginn: zeit,
    ende: zeit,
    zweck: z.string().trim().min(1).max(200).regex(EINZEILIG),
  })
  .refine((v) => Date.parse(v.ende) > Date.parse(v.beginn));

export const entscheidSchema = z
  .strictObject({
    entscheid: z.enum(["annehmen", "ablehnen"]),
    begruendung: z.string().trim().min(1).max(500).regex(MEHRZEILIG).optional(),
  })
  .refine(
    (v) => (v.entscheid === "ablehnen") === (v.begruendung !== undefined),
  );

export const listeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  nach: z.uuid().optional(),
});

export const dauerOk = (beginn: string, ende: string) =>
  Date.parse(ende) - Date.parse(beginn) <= MAX_TAGE * 864e5;

// Wer über eine Anfrage entscheidet (Annahme, vom Nutzer zu bestätigen): Hat der Raum ein Team, wer den Tag des Teams trägt (eine Person genügt); hat er keines, die Abteilungsleitung (Abteilungsleitung mit zweitem Faktor: Die Route liegt nicht unter /admin und erbt ihn nicht). Die eigene Anfrage entscheidet nie dieselbe Person (die Route prüft es)
export async function darfEntscheiden(
  db: Db,
  person: Pick<Person, "id" | "abteilungsleitung" | "zweiterFaktor">,
  teamTagId: string | null,
): Promise<boolean> {
  if (teamTagId === null)
    return person.abteilungsleitung && person.zweiterFaktor;
  const [treffer] = await db
    .select({ eins: sql`1` })
    .from(personTag)
    .where(and(eq(personTag.userId, person.id), eq(personTag.tagId, teamTagId)))
    .limit(1);
  return !!treffer;
}

// SQL-Bedingung «diese Person entscheidet über Anfragen dieses Raums» für die Liste; raum ist die Tabelle des Raums in der Abfrage
export function entscheidetUeberRaum(
  person: Pick<Person, "id" | "abteilungsleitung" | "zweiterFaktor">,
) {
  const team = sql`raum.team_tag_id in (select tag_id from person_tag where user_id = ${person.id})`;
  return person.abteilungsleitung && person.zweiterFaktor
    ? sql`(${team} or raum.team_tag_id is null)`
    : team;
}

// Fester Text: Der Push steht je nach Handy auf dem gesperrten Bildschirm, darum nie ein Name, ein Raum oder der Zweck
const ANFRAGE_TEXT = "Eine Raumanfrage wartet auf deinen Entscheid.";
const ENTSCHEID_TEXT = {
  bestaetigt: "Deine Raumanfrage ist angenommen.",
  abgelehnt: "Deine Raumanfrage ist abgelehnt.",
} as const;

// Push «raum_anfrage» an die Entscheidenden: die aktiven Konten mit dem Team-Tag des Raums, ohne die anfragende Person; ohne Team die aktiven Konten der Abteilungsleitung mit zweitem Faktor. Nach dem Commit aufrufen. Wirft nie; ohne Fcm entfällt alles. Eine Abfrage für die Empfänger, dann die von sendePush
export async function pushNeueAnfrage(
  { db, fcm, c }: { db: Db; fcm?: Fcm; c?: Context },
  opt: {
    abteilungId: string;
    anfrageId: string;
    vonId: string;
    teamTagId: string | null;
  },
): Promise<void> {
  if (!fcm) return;
  try {
    const empfaenger =
      opt.teamTagId === null
        ? await db
            .select({ id: user.id })
            .from(user)
            .where(
              and(
                aktivesKonto(opt.abteilungId),
                istAbteilungsleitungSql(user.id),
                eq(user.twoFactorEnabled, true),
                ne(user.id, opt.vonId),
              ),
            )
        : await db
            .select({ id: user.id })
            .from(personTag)
            .innerJoin(user, eq(user.id, personTag.userId))
            .where(
              and(
                eq(personTag.tagId, opt.teamTagId),
                aktivesKonto(opt.abteilungId),
                ne(user.id, opt.vonId),
              ),
            );
    if (empfaenger.length === 0) return;
    await sendePush(
      { db, fcm, c },
      empfaenger.map((e) => e.id),
      {
        typ: "raum_anfrage",
        id: opt.anfrageId,
        titel: TERMINE_PUSH_ARTEN.raum_anfrage.titel,
        text: ANFRAGE_TEXT,
      },
    );
  } catch {
    // Nur die Tatsache, nie die Meldung: Drizzles message trägt die SQL-Parameter
    log(c, { ereignis: "push" });
  }
}

// Push «raum_entscheid» an die anfragende Person, wenn ihr Konto aktiv ist und sie den Schalter pushRaumEntscheid nicht ausgeschaltet hat (#847). Nach dem Commit aufrufen. Wirft nie; ohne Fcm entfällt alles. Eine Abfrage für das Konto, dann die von sendePush
export async function pushEntscheid(
  { db, fcm, c }: { db: Db; fcm?: Fcm; c?: Context },
  opt: {
    abteilungId: string;
    anfrageId: string;
    vonId: string;
    status: keyof typeof ENTSCHEID_TEXT;
  },
): Promise<void> {
  if (!fcm) return;
  try {
    const [konto] = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          aktivesKonto(opt.abteilungId),
          eq(user.id, opt.vonId),
          eq(user.pushRaumEntscheid, true),
        ),
      );
    if (!konto) return;
    await sendePush({ db, fcm, c }, [konto.id], {
      typ: "raum_entscheid",
      id: opt.anfrageId,
      titel: TERMINE_PUSH_ARTEN.raum_entscheid.titel,
      text: ENTSCHEID_TEXT[opt.status],
    });
  } catch {
    log(c, { ereignis: "push" });
  }
}

// Löscht alle Anfragen und Buchungen, die vor mehr als 180 Tagen endeten, in jedem Status. Eine Abfrage (Index raum_buchung_ende_idx); das Audit-Log führt nie Zweck oder Namen, also bleibt nichts zurück. Liefert die Zahl gelöschter Zeilen
export async function loescheAlteBuchungen(
  db: Db,
  jetzt = new Date(),
): Promise<number> {
  const zeilen = await db.execute<{ n: number }>(sql`
    with weg as (
      delete from raum_buchung
      where ende < ${jetzt.toISOString()}::timestamptz - make_interval(days => ${AUFBEWAHRUNG_TAGE})
      returning 1
    )
    select count(*)::int as n from weg
  `);
  return zeilen[0]?.n ?? 0;
}
