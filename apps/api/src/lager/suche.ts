import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { LagerRecht } from "./rechte-katalog.js";

// Volltextsuche im Lager (#399). Jedes Modul meldet seine durchsuchbaren Texte einmal beim Laden an (registriereSuchquelle), neben seiner Anmeldung im Feed. Die Suche zeigt nie mehr als die Liste des Moduls: Eine Quelle nennt dasselbe Leserecht und denselben Zeilenfilter (SQL, auf der Tabelle des Treffers) wie die Listenroute und benutzt dafür dieselben Bausteine. Eine Quelle ohne Anmeldung wird nicht durchsucht; eine Rolle ohne das Recht bekommt von der Quelle nichts.
//
// Durchsucht werden nur Titel, Namen und Texte, die in Cevi OS liegen. Der Inhalt von Dateien im SharePoint ist nie durchsuchbar (nur Titel, Name, Stichworte des Verweises). Nie durchsuchbar sind Gesundheits- und Kontaktdaten (Telefon, E-Mail, Adressen).
//
// Index: Der Suchtext einer Quelle (suchtext) steht wörtlich als Ausdruck in den GIN-Indizes der Migration 0097 (to_tsvector('german', …) und gin_trgm_ops). Wer die Spalten einer Quelle ändert, ändert die Indizes mit; der Test «Suche benutzt den Index» fängt jede Abweichung ab.

export const SUCHE_TREFFER_MAX = 50;
export const SUCHE_TEXT_MAX = 100;
const WOERTER_MAX = 8;
// Wie ähnlich ein Wort einem Wort im Text sein muss (pg_trgm), damit ein Tippfehler trifft; Standard wäre 0,6
const AEHNLICH = "0.45";

type Teil = AnyPgColumn | SQL;

export type Suchquelle = {
  // Name des Objekts im Ergebnis («aufgabe»); mehrere Quellen dürfen denselben Typ haben (die Aufgabe trifft über Titel, Checkliste und Stichworte)
  typ: string;
  // Eines der Rechte genügt; dasselbe wie die Listenroute
  recht: LagerRecht | readonly LagerRecht[];
  // Die Tabelle mit dem Suchtext (die des Index)
  tabelle: PgTable & { lagerId: AnyPgColumn };
  // Die Texte; zusammen der Ausdruck des Index (suchtext)
  spalten: Teil[];
  // Anzeigetext des Treffers
  titel: SQL;
  // FROM-Teil mit den Verbunden, wenn der Treffer eine andere Zeile ist als die der Tabelle (Standard: die Tabelle)
  von?: SQL;
  // ID des Treffers (Standard: tabelle.id)
  id?: SQL;
  // «Nicht gelöscht» für die Zeile und was daran hängt (Standard: tabelle.geloescht_am ist leer)
  aktiv?: SQL;
  // Zeilenfilter der Rolle wie in der Listenroute («Team sieht nur eigene Aufgaben»); db für Teilabfragen
  filter?: (zugriff: LagerZugriff, db: Db) => SQL | undefined;
};

const quellen: Suchquelle[] = [];

export function registriereSuchquelle(quelle: Suchquelle) {
  quellen.push(quelle);
}

export const suchTypen = () => [...new Set(quellen.map((q) => q.typ))];
// Für den Index-Test
export const listeSuchquellen = () => [...quellen];

// Der Ausdruck, den die Indizes tragen: jede Spalte mit coalesce, durch ein Leerzeichen getrennt
export const suchtext = (spalten: Teil[]) =>
  sql.join(
    spalten.map((s) => sql`coalesce(${s}, '')`),
    sql` || ' ' || `,
  );

// Nur Buchstaben und Ziffern: Was in die tsquery geht, kann keine Syntax einschleusen
export function suchWoerter(q: string) {
  return (q.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? []).slice(
    0,
    WOERTER_MAX,
  );
}

const tabellenName = (t: Suchquelle["tabelle"]) => sql`${t}`;

// Eine Teilabfrage je Quelle, die der Person offen steht: höchstens SUCHE_TREFFER_MAX Zeilen, schon im Datenbankschritt nach dem Zeilenfilter der Rolle
export function zweig(
  quelle: Suchquelle,
  db: Db,
  zugriff: LagerZugriff,
  woerter: string[],
) {
  // In Klammern: «<%» und «||» binden gleich stark
  const e = sql`(${suchtext(quelle.spalten)})`;
  const phrase = sql`${woerter.join(" ")}::text`;
  const tsq = sql`to_tsquery('german', ${woerter.map((w) => `'${w}':*`).join(" & ")})`;
  const t = quelle.tabelle as typeof quelle.tabelle & {
    id: AnyPgColumn;
    geloeschtAm?: AnyPgColumn;
  };
  const aktiv =
    quelle.aktiv ?? (t.geloeschtAm ? sql`${t.geloeschtAm} is null` : sql`true`);
  const filter = quelle.filter?.(zugriff, db);
  return sql`(select ${quelle.typ}::text as typ, (${quelle.id ?? sql`${t.id}`})::text as id, ${quelle.titel}::text as titel, left(${e}, 600) as text, (word_similarity(${phrase}, ${e}) + ts_rank(to_tsvector('german', ${e}), ${tsq}))::float8 as score from ${quelle.von ?? tabellenName(quelle.tabelle)} where ${t.lagerId} = ${zugriff.lager.id} and ${aktiv} and ${filter ?? sql`true`} and (to_tsvector('german', ${e}) @@ ${tsq} or ${phrase} <% ${e}) order by score desc limit ${SUCHE_TREFFER_MAX})`;
}

export type Treffer = {
  typ: string;
  id: string;
  titel: string;
  auszug: string | null;
};

// Ein kurzer Ausschnitt um das erste Wort der Suche; ohne Wortfund (Tippfehler, Stamm) der Anfang. Ist er nur der Titel selbst, entfällt er
function auszug(text: string, titel: string, woerter: string[]) {
  const klein = text.toLowerCase();
  const pos = woerter
    .map((w) => klein.indexOf(w.toLowerCase()))
    .filter((p) => p >= 0)
    .sort((a, b) => a - b)[0];
  const von = Math.max(0, (pos ?? 0) - 40);
  const stueck = text.slice(von, von + 140).replace(/\s+/g, " ").trim();
  if (stueck === "" || stueck === titel.trim()) return null;
  return `${von > 0 ? "…" : ""}${stueck}${von + 140 < text.length ? "…" : ""}`;
}

// Eine Abfrage für alle Quellen (UNION ALL), nie eine je Zeile. Quellen ohne das Recht der Rolle fehlen; eine Zeile, die über mehrere Quellen trifft (Aufgabe: Titel und Checkliste), steht einmal mit der besten Bewertung. Ohne Wörter oder Quelle: leer
export async function sucheImLager(
  db: Db,
  zugriff: LagerZugriff,
  q: string,
  typ?: string,
): Promise<Treffer[]> {
  const woerter = suchWoerter(q);
  const offen = quellen.filter(
    (quelle) =>
      (typ === undefined || quelle.typ === typ) &&
      [quelle.recht].flat().some((r) => darf(zugriff, r)),
  );
  if (woerter.length === 0 || offen.length === 0) return [];
  const abfrage = sql`select typ, id, titel, text from (select distinct on (typ, id) * from (${sql.join(
    offen.map((quelle) => zweig(quelle, db, zugriff, woerter)),
    sql` union all `,
  )} ) u order by typ, id, score desc) d order by score desc, typ, id limit ${SUCHE_TREFFER_MAX}`;
  const zeilen = await db.transaction(
    async (tx) => {
      // gilt nur bis zum Ende dieser Transaktion
      await tx.execute(
        sql`select set_config('pg_trgm.word_similarity_threshold', ${AEHNLICH}, true)`,
      );
      return tx.execute<{
        typ: string;
        id: string;
        titel: string;
        text: string;
      }>(abfrage);
    },
    { accessMode: "read only" },
  );
  return [...zeilen].map((z) => ({
    typ: z.typ,
    id: z.id,
    titel: z.titel,
    auszug: auszug(z.text, z.titel, woerter),
  }));
}
