import { getTableName } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import type { LagerZugriff } from "./policy.js";
import type { LagerRecht } from "./rechte-katalog.js";

// Register der Lager-Tabellen mit Feed (#366). Jedes Modul meldet seine Tabelle einmal beim Laden seiner Routen an (registriereLagerTabelle). Ohne Eintrag schreibt lager/sync.ts nicht in die Tabelle, und der Feed lieferte ihre Zeilen nie: Wer die Anmeldung vergisst, bekommt einen Fehler beim ersten Schreiben statt einer Lücke im Rechtefilter.

// Die Spalten aus lagerSpalten() (db/schema-lager.ts), die lager/sync.ts anfasst
export type LagerSpaltenTabelle = PgTable & {
  id: AnyPgColumn;
  lagerId: AnyPgColumn;
  version: AnyPgColumn;
  erstelltVon: AnyPgColumn;
  geaendertAm: AnyPgColumn;
  geaendertVon: AnyPgColumn;
  geloeschtAm: AnyPgColumn;
  geloeschtVon: AnyPgColumn;
  lagerSeq: AnyPgColumn;
};

// Zeilenfilter der Rolle (zum Beispiel «Team sieht nur eigene Aufgaben»): bekommt die IDs eines Feed-Abschnitts und liefert die, die die Person lesen darf. Er muss auch gelöschte Zeilen beurteilen (der Feed meldet «geloescht»)
type Sichtbar = (
  db: Db,
  zugriff: LagerZugriff,
  ids: string[],
) => Promise<Set<string>>;

export type LagerTabellenEintrag = {
  tabelle: LagerSpaltenTabelle;
} & (
  | {
      // Das Leserecht des Katalogs (rechte-katalog.ts): Wer es nicht hat, bekommt von dieser Tabelle nichts im Feed, auch nicht die Zeilen-IDs. Eine Liste genügt mit einem der Rechte (Aufgaben: alle oder eigene). Ohne «sichtbar» gilt jede Zeile der Tabelle als lesbar, sobald das Recht da ist
      recht: LagerRecht | readonly LagerRecht[];
      sichtbar?: Sichtbar;
    }
  | {
      // Für Tabellen, die kein eigenes Leserecht haben, weil sie über die Datensätze anderer Module gelesen werden (lager_datei): «sichtbar» entscheidet allein und ist Pflicht
      recht: null;
      sichtbar: Sichtbar;
    }
);

const register = new Map<string, LagerTabellenEintrag>();

// Der Name der Tabelle ist der Objekttyp im Feed
export function registriereLagerTabelle(eintrag: LagerTabellenEintrag) {
  const name = getTableName(eintrag.tabelle);
  if (register.has(name)) {
    throw new Error(`Lager-Tabelle ${name} ist schon angemeldet`);
  }
  register.set(name, eintrag);
}

export const holeLagerTabelle = (name: string) => register.get(name);

// Nur für Tests, die ihre eigene Tabelle anmelden
export const entferneLagerTabelle = (name: string) => register.delete(name);

export const listeLagerTabellen = () => [...register.entries()];
