import { and, eq, ne, sql as roh } from "drizzle-orm";
import { verbindeDatenbank } from "../datenbank.js";
import { erstelleDb, type Db } from "../db/client.js";
import { programmEckdaten, stufe } from "../db/schema.js";
import { log } from "../log.js";
import { fehlerCode } from "./fehler.js";
import { parseEckdaten, stufenSlug } from "./eckdaten.js";
import {
  eckdatenLauf,
  sicherenFehlercode,
  type StufenLauf,
} from "./laufstand.js";

// Eigener Schlüssel neben dem des Kalender-Syncs (740027)
const SPERRE_ECKDATEN = 740_028;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

type HoleSeite = (url: string) => Promise<string | null>;

// Nur eine Seite mit Status 200 zählt; Weiterleitungen (etwa zu einer Anmeldung) und Fehler gelten als «keine Seite».
// Der Pfad entsteht nur aus [a-z0-9] (stufenSlug) hinter der festen Basis
export const holeSeite: HoleSeite = async (url) => {
  const antwort = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "text/html" },
  });
  if (antwort.status !== 200) return null;
  const text = await antwort.text();
  return text.length > MAX_BYTES ? null : text;
};

// Ein Lauf über alle Stufen aller Abteilungen; «gesperrt» heisst: ein anderer Lauf arbeitet gerade
export async function synchronisiereEckdaten({
  datenbankUrl,
  basisUrl,
  abrufen = holeSeite,
}: {
  datenbankUrl: string;
  basisUrl: string;
  abrufen?: HoleSeite;
}): Promise<"fertig" | "gesperrt"> {
  // Eigene Verbindung mit max 1: Sperre und Freigabe müssen auf derselben Sitzung laufen
  const sql = verbindeDatenbank(datenbankUrl, { max: 1 });
  try {
    const [sperre] =
      await sql`select pg_try_advisory_lock(${SPERRE_ECKDATEN}) as erhalten`;
    if (!sperre.erhalten) return "gesperrt";
    try {
      const stufen = await lauf(
        erstelleDb(sql),
        basisUrl.replace(/\/+$/, ""),
        abrufen,
      );
      // Erst am Ende ersetzen: Die Verwaltung sieht nie einen halben Lauf
      eckdatenLauf.stufen = stufen;
      eckdatenLauf.am = new Date();
      return "fertig";
    } finally {
      await sql`select pg_advisory_unlock(${SPERRE_ECKDATEN})`.catch(() => {});
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function lauf(db: Db, basisUrl: string, abrufen: HoleSeite) {
  const ergebnisse = new Map<string, StufenLauf>();
  const stufen = await db
    .select({ id: stufe.id, name: stufe.name })
    .from(stufe);
  for (const eine of stufen) {
    const slug = stufenSlug(eine.name);
    if (slug === "") continue;
    const adresse = `${basisUrl}/cevistufe-${slug}`;
    try {
      const html = await abrufen(adresse);
      // Keine Seite, geschützt oder ohne Datum: Der alte Stand bleibt, die Programme zeigen einfach nichts Neues
      const e = html === null ? null : parseEckdaten(html);
      if (!e) {
        ergebnisse.set(eine.id, {
          ausgang: html === null ? "keine_seite" : "ohne_datum",
          fehlercode: null,
          adresse,
        });
        continue;
      }
      await db.transaction(async (tx) => {
        const werte = {
          treffpunkt: e.treffpunkt,
          schlussOrt: e.schlussOrt,
          schlussZeit: e.schlussZeit,
          mitnehmen: e.mitnehmen,
          abgerufenAm: roh`now()`,
        };
        await tx
          .insert(programmEckdaten)
          .values({ stufeId: eine.id, tag: e.tag, ...werte })
          .onConflictDoUpdate({
            target: [programmEckdaten.stufeId, programmEckdaten.tag],
            set: werte,
          });
        // Die Seite zeigt nur den nächsten Anlass; was für andere Tage dieser Stufe noch steht, ist überholt
        await tx
          .delete(programmEckdaten)
          .where(
            and(
              eq(programmEckdaten.stufeId, eine.id),
              ne(programmEckdaten.tag, e.tag),
            ),
          );
      });
      ergebnisse.set(eine.id, {
        ausgang: "gelesen",
        fehlercode: null,
        adresse,
      });
    } catch (fehler) {
      // Nur der Code, nie URL oder Text der Seite; die nächste Stufe läuft trotzdem
      log(undefined, {
        ereignis: "eckdaten",
        stufeId: eine.id,
        code: fehlerCode(fehler) ?? "abruf",
      });
      ergebnisse.set(eine.id, {
        ausgang: "fehler",
        fehlercode: sicherenFehlercode(fehlerCode(fehler)),
        adresse,
      });
    }
  }
  return ergebnisse;
}

// Startet den Lauf sofort und dann alle 30 Minuten; Erfolg und «gesperrt» bleiben still
export function starteEckdatenSync(lauf: () => Promise<unknown>) {
  const starte = () =>
    lauf().catch((fehler) =>
      log(undefined, {
        ereignis: "eckdaten",
        code: fehlerCode(fehler) ?? "unerwartet",
      }),
    );
  void starte();
  return setInterval(starte, 30 * 60 * 1000);
}
