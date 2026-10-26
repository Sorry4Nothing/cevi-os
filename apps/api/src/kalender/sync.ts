import { and, eq, inArray, isNotNull, sql as roh } from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb, type Db } from "../db/client.js";
import { abteilung, programm } from "../db/schema.js";
import { log } from "../log.js";
import { gleicheAb } from "./abgleich.js";
import { fehlerCode, fehlerText, UNERWARTET } from "./fehler.js";
import { holeSeiten, holeToken } from "./google.js";

// Beliebige feste Zahl: pg_try_advisory_lock braucht einen Schlüssel, der in der ganzen Datenbank nur diesem Job gehört
const SPERRE_KALENDER = 740_027;

// Ein Lauf über alle Abteilungen mit Kalender; «gesperrt» heisst: ein anderer Lauf arbeitet gerade
export async function synchronisiere({
  datenbankUrl,
  schluesselDatei,
  jetzt = new Date(),
}: {
  datenbankUrl: string;
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
      await lauf(erstelleDb(sql), schluesselDatei, jetzt);
      return "fertig";
    } finally {
      // Scheitert nur mit der Verbindung, und dann fällt die Sperre mit ihr
      await sql`select pg_advisory_unlock(${SPERRE_KALENDER})`.catch(() => {});
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function lauf(db: Db, schluesselDatei: string | undefined, jetzt: Date) {
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
      await db.transaction(async (tx) => {
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
        await tx
          .update(abteilung)
          .set({ syncOkAm: jetzt, syncFehler: null })
          .where(eq(abteilung.id, eine.id));
      });
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
