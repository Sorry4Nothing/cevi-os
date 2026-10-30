import {
  and,
  eq,
  inArray,
  isNotNull,
  notInArray,
  sql as roh,
} from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb, type Db } from "../db/client.js";
import type { Fcm } from "../push.js";
import { abteilung, programm } from "../db/schema.js";
import { log } from "../log.js";
import { programmBeginn } from "../rechte.js";
import { gleicheAb } from "./abgleich.js";
import { fehlerCode, fehlerText, UNERWARTET } from "./fehler.js";
import { holeSeiten, holeToken } from "./google.js";
import { findeNachfolger } from "./nachfolger.js";
import {
  abgesagt,
  pushProgrammaenderungen,
  vergleiche,
  type Aenderung,
} from "./programm-push.js";

// Beliebige feste Zahl: pg_try_advisory_lock braucht einen Schlüssel, der in der ganzen Datenbank nur diesem Job gehört
const SPERRE_KALENDER = 740_027;

// Ein Lauf über alle Abteilungen mit Kalender; «gesperrt» heisst: ein anderer Lauf arbeitet gerade
export async function synchronisiere({
  datenbankUrl,
  fcm,
  schluesselDatei,
  jetzt = new Date(),
}: {
  datenbankUrl: string;
  fcm?: Fcm;
  schluesselDatei: string | undefined;
  jetzt?: Date;
}): Promise<"fertig" | "gesperrt"> {
  // Eigene Verbindung mit max 1: Sperre und Freigabe müssen auf derselben Sitzung laufen
  const sql = verbindeDatenbank(datenbankUrl, { max: 1 });
  try {
    const [sperre] =
      await sql`select pg_try_advisory_lock(${SPERRE_KALENDER}) as erhalten`;
    if (!sperre.erhalten) return "gesperrt";
    try {
      await lauf(erstelleDb(sql), fcm, schluesselDatei, jetzt);
      return "fertig";
    } finally {
      // Scheitert nur mit der Verbindung, und dann fällt die Sperre mit ihr
      await sql`select pg_advisory_unlock(${SPERRE_KALENDER})`.catch(() => {});
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function lauf(
  db: Db,
  fcm: Fcm | undefined,
  schluesselDatei: string | undefined,
  jetzt: Date,
) {
  const abteilungen = await db
    .select({ id: abteilung.id, kalenderId: abteilung.googleKalenderId })
    .from(abteilung)
    .where(isNotNull(abteilung.googleKalenderId));
  if (abteilungen.length === 0) return;

  // Ein Token pro Lauf; ohne Token scheitern alle Abteilungen gleich, damit /health (#33) nach 30 Minuten Alarm schlägt
  let token: string;
  try {
    token = await holeToken(schluesselDatei, jetzt);
  } catch (fehler) {
    for (const eine of abteilungen) await merkeFehler(db, eine.id, fehler);
    return;
  }

  // Jede Abteilung scheitert für sich; die nächste läuft trotzdem
  for (const eine of abteilungen) {
    if (eine.kalenderId === null) continue;
    try {
      const seiten = await holeSeiten(token, eine.kalenderId, jetzt);
      const { programme, absagen } = gleicheAb(seiten);
      // Doppelte IDs: Der letzte Eintrag gewinnt, denn ein Upsert, der dieselbe Zeile zweimal trifft, scheitert
      const proId = new Map(programme.map((p) => [p.googleEventId, p]));
      const zeilen = [...proId.values()].map((p) => ({
        ...p,
        abteilungId: eine.id,
      }));
      const aenderungen: Aenderung[] = [];
      await db.transaction(async (tx) => {
        // Kommende Programme, die der Abruf weder behält noch absagt, fehlen (etwa nach «ab diesem Termin» oder weil sie privat wurden)
        const fehlende = await tx
          .select()
          .from(programm)
          .where(
            and(
              eq(programm.abteilungId, eine.id),
              inArray(programm.status, ["aktiv", "pruefen"]),
              roh`${programmBeginn} > ${jetzt.toISOString()}`,
              notInArray(programm.googleEventId, [...proId.keys(), ...absagen]),
            ),
          );
        const vorhandene = await tx
          .select()
          .from(programm)
          .where(
            and(
              eq(programm.abteilungId, eine.id),
              inArray(programm.googleEventId, [...proId.keys(), ...absagen]),
            ),
          );
        const bekannt = new Set(
          vorhandene
            .filter((v) => proId.has(v.googleEventId))
            .map((v) => v.googleEventId),
        );
        const { uebernahmen, pruefen } = findeNachfolger(
          fehlende,
          zeilen,
          bekannt,
        );
        // Push-Auslöser vor dem Upsert: Zeit, Ort oder Titel geändert, oder neu abgesagt. Neue Termine und «Prüfen» (fehlende ohne Nachfolger) lösen nichts aus
        const alt = new Map(
          vorhandene
            .filter((v) => proId.has(v.googleEventId))
            .map((v) => [v.googleEventId, v]),
        );
        for (const u of uebernahmen) {
          const vorher = fehlende.find((f) => f.id === u.programmId);
          if (vorher) alt.set(u.googleEventId, vorher);
        }
        for (const [eventId, vorher] of alt) {
          // Ein abgesagtes Programm, das zurückkehrt, ist keine Änderung
          if (vorher.status === "abgesagt") continue;
          const a = vergleiche(vorher.id, vorher, proId.get(eventId)!);
          if (a) aenderungen.push(a);
        }
        for (const v of vorhandene) {
          if (absagen.includes(v.googleEventId) && v.status !== "abgesagt")
            aenderungen.push(abgesagt(v.id, v));
        }
        // Übernehmen heisst umschlüsseln: Die Zeile behält id, Zuordnung, Ergänzungen und Teilnahmen, der Upsert unten trifft sie über die neue Event-ID
        for (const u of uebernahmen) {
          await tx
            .update(programm)
            .set({ googleEventId: u.googleEventId })
            .where(eq(programm.id, u.programmId));
        }
        // shortcut: ein INSERT trägt höchstens 65535 Parameter (rund 5000 Termine); bei grösseren Kalendern in Blöcke teilen
        if (zeilen.length > 0) {
          await tx
            .insert(programm)
            .values(zeilen)
            .onConflictDoUpdate({
              target: [programm.abteilungId, programm.googleEventId],
              // Jede Google-Spalte aus excluded, auch NULL: Der Wechsel ganztägig ↔ mit Zeit leert das andere Paar.
              // Zuordnung, Sichtbarkeit, Ergänzungen und geaendert_* bleiben unberührt
              set: {
                googleSerie: roh`excluded.google_serie`,
                titel: roh`excluded.titel`,
                ganztaegig: roh`excluded.ganztaegig`,
                beginn: roh`excluded.beginn`,
                ende: roh`excluded.ende`,
                tagVon: roh`excluded.tag_von`,
                tagBis: roh`excluded.tag_bis`,
                googleOrt: roh`excluded.google_ort`,
                googleBeschreibung: roh`excluded.google_beschreibung`,
                // Wieder im Kalender heisst wieder aktiv, auch nach einer Absage
                status: "aktiv",
              },
            });
        }
        // Nach den Übernahmen, damit eine Absage im selben Lauf gewinnt; unbekannte IDs treffen nichts
        if (absagen.length > 0) {
          await tx
            .update(programm)
            .set({ status: "abgesagt" })
            .where(
              and(
                eq(programm.abteilungId, eine.id),
                inArray(programm.googleEventId, absagen),
              ),
            );
        }
        if (pruefen.length > 0) {
          await tx
            .update(programm)
            .set({ status: "pruefen" })
            .where(inArray(programm.id, pruefen));
        }
        await tx
          .update(abteilung)
          // Datenbankuhr statt jetzt: /health (#33) misst das Alter an now()
          .set({ syncOkAm: roh`now()`, syncFehler: null })
          .where(eq(abteilung.id, eine.id));
      });
      // Erst nach dem Commit; wirft nie, ein Push-Fehler lässt den Lauf der Abteilung nicht scheitern
      await pushProgrammaenderungen({ db, fcm }, eine.id, aenderungen);
    } catch (fehler) {
      await merkeFehler(db, eine.id, fehler);
    }
  }
}

async function merkeFehler(db: Db, abteilungId: string, fehler: unknown) {
  const text = fehlerText(fehler);
  // sync_ok_am bleibt stehen: /health (#33) misst daran das Alter des letzten Erfolgs
  await db
    .update(abteilung)
    .set({ syncFehler: text })
    .where(eq(abteilung.id, abteilungId));
  log(undefined, {
    ereignis: "kalender",
    abteilungId,
    fehler: text,
    code: fehlerCode(fehler),
  });
}

// Startet den Lauf sofort und dann alle 5 Minuten; Erfolg und «gesperrt» bleiben still
export function starteKalenderSync(lauf: () => Promise<unknown>) {
  const starte = () =>
    lauf().catch((fehler) =>
      log(undefined, {
        ereignis: "kalender",
        fehler: UNERWARTET,
        code: fehlerCode(fehler),
      }),
    );
  void starte();
  return setInterval(starte, 5 * 60 * 1000);
}
