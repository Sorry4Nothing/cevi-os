import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import * as schema from "./schema.js";

// Aufgaben, die erst nach dem Commit der äussersten Transaktion laufen (Lager: Ereignisse für offene Ansichten, #367); eine zurückgerollte Transaktion verwirft sie
const nachDemCommit = new WeakMap<object, (() => void)[]>();

// Führt fn aus, sobald die äusserste Transaktion von tx festgeschrieben ist. Gehört tx nicht zu einer solchen (eine Savepoint-Transaktion), läuft fn kurz danach statt nie
// shortcut: die Frist für diesen Ausnahmefall ist geschätzt; genau wird es, wenn ein Savepoint seine Aufgaben an die äussere Transaktion weiterreicht
export function nachCommit(tx: object, fn: () => void) {
  const liste = nachDemCommit.get(tx);
  if (liste) liste.push(fn);
  else setTimeout(fn, 300);
}

// Ohne node:* und process: Routen importieren diese Datei, und die App prüft deren Importe über AppType
export const erstelleDb = (sql: Sql) => {
  const db = drizzle(sql, { schema });
  const transaktion = db.transaction.bind(db);
  db.transaction = (async (
    fn: Parameters<typeof transaktion>[0],
    konfiguration?: Parameters<typeof transaktion>[1],
  ) => {
    let aeusserste: object | undefined;
    const ergebnis = await transaktion((tx) => {
      aeusserste = tx;
      nachDemCommit.set(tx, []);
      return fn(tx);
    }, konfiguration);
    // Nur nach erfolgreichem Commit; bei einem Fehler wirft transaktion oben, und die Liste verfällt mit tx
    for (const aufgabe of nachDemCommit.get(aeusserste!) ?? []) {
      try {
        aufgabe();
      } catch {
        // Eine fehlgeschlagene Meldung darf das Ergebnis eines festgeschriebenen Schreibvorgangs nicht kippen
      }
    }
    return ergebnis;
  }) as typeof db.transaction;
  return db;
};

export type Db = ReturnType<typeof erstelleDb>;
