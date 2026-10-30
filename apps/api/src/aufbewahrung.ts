import { lt, sql, type SQL } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { kind, meldung, nachricht, session, teilnahme } from "./db/schema.js";
import { log } from "./log.js";

type Datenbank = Pick<Db, "delete" | "execute">;

// Rohes sql kennt die Spalte nicht und serialisiert kein Date, darum als ISO-Text
// Kalendermonate rechnet Postgres, wie in audit_log_aufraeumen(); die Monatszahl steht im Code, nie in einer Eingabe
const vor = (jetzt: Date, monate: number) =>
  sql`${jetzt.toISOString()}::timestamptz - ${sql.raw(`interval '${monate} months'`)}`;

const zaehle = async (db: Pick<Db, "execute">, abfrage: SQL) =>
  Number((await db.execute<{ anzahl: string }>(abfrage))[0].anzahl);

// Die Teile laufen in dieser Reihenfolge: Eltern werden deaktiviert, bevor das Löschen der Kinder sie von ihnen löst
const TEILE: {
  name: string;
  lauf: (db: Datenbank, jetzt: Date) => Promise<number>;
}[] = [
  {
    // Die Push-Tokens gehen per CASCADE mit
    name: "sitzungen",
    lauf: async (db, jetzt) =>
      (
        await db
          .delete(session)
          .where(lt(session.expiresAt, jetzt))
          .returning({ id: session.id })
      ).length,
  },
  {
    // Meldungen darauf behalten ihren Zeitpunkt; ihr Verweis leert per SET NULL
    name: "nachrichten",
    lauf: async (db, jetzt) =>
      (
        await db
          .delete(nachricht)
          .where(lt(nachricht.erstelltAm, vor(jetzt, 12)))
          .returning({ id: nachricht.id })
      ).length,
  },
  {
    // Die Textkopie räumt der stündliche Job in meldungen.ts nach 30 Tagen ab
    name: "meldungen",
    lauf: async (db, jetzt) =>
      (
        await db
          .delete(meldung)
          .where(lt(meldung.erstelltAm, vor(jetzt, 12)))
          .returning({ id: meldung.id })
      ).length,
  },
  {
    // Ab der letzten Änderung der Anmeldung, nicht ab dem Programm: Die Tabelle kennt nur diesen Zeitpunkt
    name: "teilnahmen",
    lauf: async (db, jetzt) =>
      (
        await db
          .delete(teilnahme)
          .where(lt(teilnahme.geaendertAm, vor(jetzt, 12)))
          .returning({ kindId: teilnahme.kindId })
      ).length,
  },
  {
    // Nur Konten mit Kindern, alle inaktiv: Ein frisch angelegtes Konto ohne Kind bleibt. Banned wie bei banUser; die Sitzungen und mit ihnen die Push-Tokens enden sofort
    name: "eltern_deaktivieren",
    lauf: (db, jetzt) =>
      zaehle(
        db,
        sql`
          WITH betroffen AS (
            UPDATE "user" SET deaktiviert_am = ${jetzt.toISOString()}::timestamptz, banned = true
            WHERE deaktiviert_am IS NULL
              AND role IS DISTINCT FROM 'admin'
              AND NOT EXISTS (SELECT 1 FROM rolle WHERE rolle.user_id = "user".id)
              AND EXISTS (SELECT 1 FROM kind_eltern WHERE kind_eltern.user_id = "user".id)
              AND NOT EXISTS (
                SELECT 1 FROM kind_eltern JOIN kind ON kind.id = kind_eltern.kind_id
                WHERE kind_eltern.user_id = "user".id AND kind.inaktiv_seit IS NULL
              )
            RETURNING id, abteilung_id
          ), sitzungen AS (
            DELETE FROM session WHERE user_id IN (SELECT id FROM betroffen)
          ), protokoll AS (
            INSERT INTO audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
            SELECT abteilung_id, 'job', 'person_deaktiviert', 'person', id, '{"grund":"kein_aktives_kind"}'::jsonb
            FROM betroffen
          )
          SELECT count(*) AS anzahl FROM betroffen`,
      ),
  },
  {
    // Teilnahmen und Verknüpfungen mit den Eltern gehen per CASCADE mit
    name: "kinder",
    lauf: async (db, jetzt) =>
      (
        await db
          .delete(kind)
          .where(lt(kind.inaktivSeit, vor(jetzt, 6)))
          .returning({ id: kind.id })
      ).length,
  },
  {
    // Nachrichten, Einzelchat, Rollen und Verknüpfungen gehen per CASCADE mit; die Verifikation trägt die Person-ID ohne Fremdschlüssel (wie beim Löschen des eigenen Kontos)
    name: "konten",
    lauf: (db, jetzt) =>
      zaehle(
        db,
        sql`
          WITH weg AS (
            DELETE FROM "user"
            WHERE deaktiviert_am < ${vor(jetzt, 6)}
            RETURNING id, abteilung_id
          ), verifikationen AS (
            DELETE FROM verification WHERE value IN (SELECT id::text FROM weg)
          ), protokoll AS (
            INSERT INTO audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
            SELECT abteilung_id, 'job', 'person_geloescht', 'person', id, '{"grund":"deaktiviert"}'::jsonb
            FROM weg
          )
          SELECT count(*) AS anzahl FROM weg`,
      ),
  },
  {
    // Die API-Rolle darf audit_log nicht löschen; die Funktion läuft mit den Rechten des Tabellenbesitzers (Migration 0005) und rechnet mit now()
    name: "audit_log",
    lauf: (db) => zaehle(db, sql`SELECT audit_log_aufraeumen() AS anzahl`),
  },
];

// Gibt je Teil die Anzahl gelöschter Zeilen zurück, null bei einem Fehler; ein Fehler stoppt die übrigen Teile nicht. Das Log nennt nur Teil, Anzahl und Fehlercode
export async function raeumeAuf(db: Datenbank, jetzt = new Date()) {
  const ergebnis: Record<string, number | null> = {};
  for (const { name, lauf } of TEILE) {
    try {
      const anzahl = await lauf(db, jetzt);
      ergebnis[name] = anzahl;
      if (anzahl > 0)
        log(undefined, { ereignis: "aufbewahrung", teil: name, anzahl });
    } catch (fehler) {
      ergebnis[name] = null;
      log(undefined, {
        ereignis: "aufbewahrung",
        teil: name,
        fehler: "AUFRAEUMEN_FEHLGESCHLAGEN",
        code: (fehler as { code?: unknown }).code,
      });
    }
  }
  return ergebnis;
}

// Startet den Lauf sofort und dann täglich; ein Neustart wiederholt ihn, das schadet nicht
export function starteAufbewahrung(db: Datenbank) {
  const starte = () => void raeumeAuf(db);
  starte();
  return setInterval(starte, 24 * 60 * 60 * 1000);
}
