import { sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { log } from "./log.js";

// Leert die Textkopien, die älter als 30 Tage sind (Funktion aus Migration 0008); gibt die Anzahl zurück
export async function raeumeTextkopienAuf(db: Pick<Db, "execute">) {
  const [zeile] = await db.execute<{ anzahl: string }>(
    sql`select meldung_textkopien_aufraeumen() as anzahl`,
  );
  return Number(zeile.anzahl);
}

// Startet den Lauf sofort und dann stündlich; die Frist ist 30 Tage, eine Stunde Verzug genügt. Ohne Personendaten im Log: nur die Anzahl
export function starteMeldungenAufraeumen(db: Pick<Db, "execute">) {
  const starte = () =>
    raeumeTextkopienAuf(db).then(
      (anzahl) => {
        if (anzahl > 0) log(undefined, { ereignis: "meldungen", anzahl });
      },
      (fehler) =>
        log(undefined, {
          ereignis: "meldungen",
          fehler: "AUFRAEUMEN_FEHLGESCHLAGEN",
          code: (fehler as { code?: unknown }).code,
        }),
    );
  void starte();
  return setInterval(starte, 60 * 60 * 1000);
}
