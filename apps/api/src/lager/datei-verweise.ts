import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { lagerDatei } from "../db/schema.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { LagerRecht } from "./rechte-katalog.js";
import type { LagerSpaltenTabelle } from "./tabellen.js";

// Register der Verweise auf lager_datei (#370). Ein Modul, das eine Datei einbindet (Pinnwand, Dokumente, Protokolle, Infos), meldet beim Laden seiner Routen einmal an, in welcher Spalte welcher Tabelle die ID eines Eintrags steht. Das Register entscheidet zweierlei:
//   1. Wer einen Eintrag sieht: wer den verweisenden Datensatz lesen darf (Recht des Moduls, optional ein Zeilenfilter). Ein Eintrag ohne lesbaren Verweis ist unsichtbar (404), ausser für die Person, die ihn in den letzten 24 Stunden hinzugefügt hat
//   2. Was der Aufräumlauf entfernt: Einträge, auf die keine Tabelle mehr zeigt und die älter sind als 24 Stunden
// Das Modul legt die Spalte mit einem Fremdschlüssel auf lager_datei.id an (ON DELETE RESTRICT): Dann kann der Lauf nie einen Eintrag entfernen, den ein Datensatz eben eingebunden hat. Es prüft beim Einbinden mit pruefeDateiImLager (lager/datei.ts), dass der Eintrag zum selben Lager gehört
export type DateiVerweis = {
  tabelle: LagerSpaltenTabelle;
  // Die Spalte mit der ID aus lager_datei
  spalte: AnyPgColumn;
  // Das Leserecht des Moduls: Wer es nicht hat, sieht die Einträge dieser Tabelle nicht
  recht: LagerRecht;
  // Zeilenfilter der Rolle (zum Beispiel «Team sieht nur Beiträge für das Team»): bekommt die Einträge und liefert die, auf die ein lesbarer Datensatz zeigt. Fehlt er, gilt jeder nicht gelöschte Datensatz des Lagers als lesbar, sobald das Recht da ist
  sichtbar?: (
    db: Db,
    zugriff: LagerZugriff,
    dateiIds: string[],
  ) => Promise<Set<string>>;
};

const verweise: DateiVerweis[] = [];

export function registriereDateiVerweis(verweis: DateiVerweis) {
  if (verweise.some((v) => v.spalte === verweis.spalte)) {
    throw new Error("Dieser Datei-Verweis ist schon angemeldet");
  }
  verweise.push(verweis);
}

// Nur für Tests, die ihren eigenen Verweis anmelden
export function entferneDateiVerweis(spalte: AnyPgColumn) {
  const i = verweise.findIndex((v) => v.spalte === spalte);
  if (i >= 0) verweise.splice(i, 1);
}

// Welche der Einträge zeigen auf einen Datensatz, den die Person lesen darf? Eine Abfrage je angemeldetem Verweis, dessen Recht die Person hat, nie je Eintrag
export async function sichtbareDateien(
  db: Db,
  zugriff: LagerZugriff,
  dateiIds: string[],
): Promise<Set<string>> {
  const sichtbar = new Set<string>();
  if (dateiIds.length === 0) return sichtbar;
  for (const v of verweise) {
    if (!darf(zugriff, v.recht)) continue;
    for (const id of await sichtbarJeVerweis(db, zugriff, v, dateiIds)) {
      sichtbar.add(id);
    }
  }
  return sichtbar;
}

// Die Einträge, die ein einzelner Verweis freigibt (das Recht des Verweises ist schon geprüft)
export async function sichtbarJeVerweis(
  db: Db,
  zugriff: LagerZugriff,
  v: DateiVerweis,
  dateiIds: string[],
): Promise<Set<string>> {
  if (v.sichtbar) return v.sichtbar(db, zugriff, dateiIds);
  const zeilen = await db
    .select({ id: v.spalte })
    .from(v.tabelle)
    .where(
      and(inArray(v.spalte, dateiIds), eq(v.tabelle.lagerId, zugriff.lager.id)),
    );
  return new Set(zeilen.map((z) => String(z.id)));
}

// Die Verweise anderer Module, deren Leserecht die Person hat: für die Sammelabfrage der Dokumente (#396), die auch Dateien aus Infos, Ressorts, Pinnwand und Protokollen auflistet
export const verweiseAnderer = (zugriff: LagerZugriff, ausser: AnyPgColumn) =>
  verweise.filter((v) => v.spalte !== ausser && darf(zugriff, v.recht));

// Die Tabellen, die auf lager_datei zeigen (ON DELETE RESTRICT): Beim Löschen eines Lagers gehen sie vor den Dateien weg (lager/loeschen.ts)
export const dateiVerweisTabellen = () => verweise.map((v) => v.tabelle);

export const tabellenName = (v: DateiVerweis) => {
  const { name, schema } = getTableConfig(v.tabelle);
  return schema
    ? sql`${sql.identifier(schema)}.${sql.identifier(name)}`
    : sql.identifier(name);
};

// Frist, nach der ein Eintrag ohne Verweis entfällt
export const DATEI_OHNE_VERWEIS_STUNDEN = 24;

// Entfernt Einträge ohne Verweis, die älter sind als die Frist: eine einzige Abfrage mit einem NOT EXISTS je angemeldetem Verweis. Ein Eintrag, den die Route gelöscht hat, ist endgültig weg (#427) und kommt hier nicht mehr vor. Liefert die Zahl entfernter Einträge. Die Zeilen verschwinden ohne Feed-Eintrag: Sie waren nur für die Person sichtbar, die sie hinzugefügt hat
// shortcut: Läuft täglich, ein Eintrag lebt also 24 bis 48 Stunden; für eine genauere Frist den Lauf öfter starten (eine Abfrage, kein Lock auf dem Lager)
export async function raeumeDateienOhneVerweisAuf(
  db: Db,
  stunden = DATEI_OHNE_VERWEIS_STUNDEN,
  // Nur für Tests: auf ein Lager begrenzen, damit ein Lauf nicht Dateien anderer Testdateien trifft, deren Verweise er nicht kennt
  lagerId?: string,
) {
  const geloescht = await db
    .delete(lagerDatei)
    .where(
      and(
        lagerId ? eq(lagerDatei.lagerId, lagerId) : undefined,
        lt(
          lagerDatei.erstelltAm,
          sql`now() - make_interval(hours => ${stunden})`,
        ),
        ...verweise.map(
          (v) =>
            // Namen statt Spaltenobjekte: Im DELETE schreibt drizzle Spalten ohne Tabelle, und «id» träfe dann die Tabelle des Verweises
            sql`not exists (select 1 from ${tabellenName(v)} v where v.${sql.identifier(v.spalte.name)} = "lager_datei"."id")`,
        ),
      ),
    )
    .returning({ id: lagerDatei.id });
  return geloescht.length;
}
