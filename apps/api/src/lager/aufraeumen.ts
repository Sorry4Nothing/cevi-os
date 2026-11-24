import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { fehlerCode } from "../kalender/fehler.js";
import { log } from "../log.js";

// Frist, nach der ein Eintrag des Änderungsfeeds entfällt (Annahme A11): Danach bekommt ein Client mit altem Stand 410 und lädt neu, statt dass der Feed unbegrenzt wächst
export const AENDERUNGEN_TAGE = 30;

// Entfernt alte Einträge und hebt lager.seq_min je Lager über die höchste entfernte Folgenummer. Weil der Zeitpunkt mit der Folgenummer wächst, ist das ein Anfang des Feeds; ein Schreiber legt nur neuere Einträge an und stört den Lauf nicht. Liefert die Zahl entfernter Einträge
export async function raeumeAenderungenAuf(db: Db, tage = AENDERUNGEN_TAGE) {
  const zeilen = await db.execute<{ n: number }>(sql`
    with weg as (
      delete from lager_aenderung
      where zeitpunkt < now() - make_interval(days => ${tage})
      returning lager_id, seq
    ),
    hoechste as (
      select lager_id, max(seq) as seq from weg group by lager_id
    ),
    angehoben as (
      update lager set seq_min = greatest(lager.seq_min, hoechste.seq + 1)
      from hoechste
      where lager.id = hoechste.lager_id
      returning lager.id
    )
    select count(*)::int as n from weg`);
  // Die Ergebnisse der Warteschlange (#367) entfallen mit derselben Frist: Eine Wiederholung nach so langer Zeit gibt es nicht, ihr Feed wäre ohnehin zu alt
  await db.execute(
    sql`delete from lager_client_op where erstellt_am < now() - make_interval(days => ${tage})`,
  );
  return zeilen[0]?.n ?? 0;
}

// Startet den Lauf sofort und dann alle 24 Stunden; ins Log kommt nur die Anzahl, bei einem Fehler nur sein Code
export function starteAenderungenAufraeumen(lauf: () => Promise<number>) {
  const starte = () =>
    lauf()
      .then((anzahl) =>
        log(undefined, { ereignis: "lager_aenderungen", geloescht: anzahl }),
      )
      .catch((fehler) =>
        log(undefined, {
          ereignis: "lager_aenderungen",
          code: fehlerCode(fehler) ?? "unerwartet",
        }),
      );
  void starte();
  return setInterval(starte, 24 * 60 * 60 * 1000);
}
