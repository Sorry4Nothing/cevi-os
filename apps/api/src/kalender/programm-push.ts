import { and, eq, exists, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { programm, programmStufe, rolle, stufe, user } from "../db/schema.js";
import { log } from "../log.js";
import { type Fcm, sendePush } from "../push.js";
import { aktivesKonto, programmSichtbar, type Person } from "../rechte.js";
import { programmTag } from "./nachfolger.js";

type Stand = {
  titel: string;
  ganztaegig: boolean;
  beginn: Date | null;
  ende: Date | null;
  tagVon: string | null;
  tagBis: string | null;
  googleOrt: string | null;
};

export type Aenderung = {
  programmId: string;
  art: "verschoben" | "geaendert" | "abgesagt";
  titel: string;
  tag: string;
};

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// «Sa 31.10.»: Der Tag kommt als Schweizer Datum (yyyy-mm-dd) aus programmTag, nie über die Zone des Servers
function kurzDatum(tag: string) {
  const [, monat, tagNr] = tag.split("-").map(Number);
  const wochentag = new Date(`${tag}T12:00:00Z`).getUTCDay();
  return `${WOCHENTAG[wochentag]} ${tagNr}.${monat}.`;
}

// Nur Titel und Datum des Programms, nie Namen: Der Text läuft über Apple und Google
export function pushTitel({ art, titel, tag }: Aenderung) {
  const was = {
    verschoben: "verschoben",
    geaendert: "geändert",
    abgesagt: "abgesagt",
  }[art];
  return `${titel} am ${kurzDatum(tag)} wurde ${was}`;
}

const gleicheZeit = (a: Date | null, b: Date | null) =>
  a?.getTime() === b?.getTime();

// null heisst: nichts, das einen Push verdient. Beschreibung und Status zählen nicht (die Absage kommt aus dem Abruf)
export function vergleiche(
  programmId: string,
  alt: Stand,
  neu: Stand,
): Aenderung | null {
  const verschoben =
    alt.ganztaegig !== neu.ganztaegig ||
    !gleicheZeit(alt.beginn, neu.beginn) ||
    !gleicheZeit(alt.ende, neu.ende) ||
    alt.tagVon !== neu.tagVon ||
    alt.tagBis !== neu.tagBis;
  if (!verschoben && alt.titel === neu.titel && alt.googleOrt === neu.googleOrt)
    return null;
  return {
    programmId,
    art: verschoben ? "verschoben" : "geaendert",
    titel: neu.titel,
    tag: programmTag(neu),
  };
}

export const abgesagt = (programmId: string, alt: Stand): Aenderung => ({
  programmId,
  art: "abgesagt",
  titel: alt.titel,
  tag: programmTag(alt),
});

// Nach dem Commit des Abgleichs; wirft nie: Ein Fehler hier darf den Sync nicht scheitern lassen, die Änderung ist schon gespeichert
export async function pushProgrammaenderungen(
  { db, fcm }: { db: Db; fcm?: Fcm },
  abteilungId: string,
  aenderungen: Aenderung[],
): Promise<void> {
  if (aenderungen.length === 0) return;
  try {
    // Nicht zugeordnet heisst intern oder ohne Stufe: Das sehen nur Admins und SL, und die Zuordnung wartet noch
    const zugeordnet = new Set(
      (
        await db
          .select({ id: programm.id })
          .from(programm)
          .where(
            and(
              inArray(
                programm.id,
                aenderungen.map((a) => a.programmId),
              ),
              ne(programm.sichtbarkeit, "intern"),
              exists(
                db
                  .select({ eins: sql`1` })
                  .from(programmStufe)
                  .where(eq(programmStufe.programmId, programm.id)),
              ),
            ),
          )
      ).map((z) => z.id),
    );
    const ids = aenderungen
      .filter((a) => zugeordnet.has(a.programmId))
      .map((a) => a.programmId);
    if (ids.length === 0) return;

    const konten = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(and(aktivesKonto(abteilungId), eq(user.pushProgramme, true)));
    const rollen = await db
      .select({ userId: rolle.userId, stufeId: rolle.stufeId, typ: rolle.typ })
      .from(rolle)
      .innerJoin(
        stufe,
        and(eq(rolle.stufeId, stufe.id), eq(stufe.abteilungId, abteilungId)),
      )
      .where(
        inArray(
          rolle.userId,
          konten.map((k) => k.id),
        ),
      );

    // Wie personAusSitzung: Wer das Programm sieht, entscheidet allein programmSichtbar
    const empfaenger = new Map<string, string[]>();
    for (const konto of konten) {
      const person: Person = {
        id: konto.id,
        abteilungId,
        admin: konto.role === "admin",
        zweiterFaktor: false,
        rollen: rollen
          .filter((r) => r.userId === konto.id)
          .map(({ stufeId, typ }) => ({ stufeId, typ })),
      };
      const sichtbar = await db
        .select({ id: programm.id })
        .from(programm)
        .where(and(inArray(programm.id, ids), programmSichtbar(person)));
      for (const { id } of sichtbar) {
        empfaenger.set(id, [...(empfaenger.get(id) ?? []), konto.id]);
      }
    }
    for (const a of aenderungen) {
      const an = empfaenger.get(a.programmId);
      if (!an) continue;
      await sendePush({ db, fcm }, an, {
        typ: "programm",
        id: a.programmId,
        titel: pushTitel(a),
      });
    }
  } catch (fehler) {
    // Nur der Code: message enthielte die SQL-Parameter
    log(undefined, {
      ereignis: "push",
      code: (fehler as { code?: unknown }).code,
    });
  }
}
