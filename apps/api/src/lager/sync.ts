import { and, eq, getTableName, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client.js";
import { lager, lagerAenderung } from "../db/schema.js";
import { holeLagerTabelle, type LagerSpaltenTabelle } from "./tabellen.js";

// Sync-Kern des Lager-Backends (#366). Jede Lager-Tabelle schreibt ausschliesslich über legeZeileAn, aendereZeile und loescheZeile; ein eigenes INSERT, UPDATE oder DELETE in einer Route umgeht Version, Folgenummer und Feed.
//
// Das Muster für ein neues Modul (alle Lager-Issues gleich):
//   1. Schema: pgTable("name", { ...lagerSpalten(), eigeneSpalten }) in db/schema-lager.ts und einen Index auf lager_id; Spalten in datenkategorien.ts mit LAGER_BASIS_SPALTEN
//   2. Anmelden: registriereLagerTabelle({ tabelle, recht, sichtbar? }) beim Laden der Routen (lager/tabellen.ts). Ohne Anmeldung schreibt dieser Kern nicht
//   3. Route: lagerZugriff(db, { recht }) vorhängen (Lager, Mitgliedschaft, Recht, Schreibschutz), Eingabe mit z.strictObject() prüfen, danach in EINER Transaktion schreiben:
//        const zeile = await db.transaction((tx) =>
//          aendereZeile(tx, meineTabelle, { lagerId: zugriff.lager.id, personId: person.id }, { id, version, werte, ansicht: meineAnsicht }),
//        );
//      Die Route prüft vorher selbst, ob die Rolle diese Zeile ändern darf (Rechte und Zeilenfilter); der Kern kennt die Rolle nicht. Er prüft nur, dass die Zeile zum Lager gehört
//   4. Antworten über eine feste Ansicht (nie die ganze Zeile), die die Rolle nur sehen lässt, was sie lesen darf. Dieselbe Ansicht liefert den Stand in der Konfliktantwort
//   5. Änderungen mehrerer Zeilen (zum Beispiel Aufgabe und ihre Checkliste) laufen in derselben Transaktion; jede Zeile bekommt ihre eigene Folgenummer
//
// Ablauf eines Schreibvorgangs: Das Lager wird gesperrt (UPDATE lager SET seq = seq + 1, die Zeilensperre hält bis zum Ende der Transaktion), die Zeile mit WHERE version = erwartet geschrieben, ein Eintrag in lager_aenderung angelegt. Weil die Sperre die Schreiber eines Lagers ordnet, steigen Folgenummer und Commit gleich, ein Rollback gibt die Nummer zurück (keine Lücken), und der Feed sieht nie eine spätere Nummer vor einer früheren. Preis: Schreibvorgänge eines Lagers laufen nacheinander. Darum halten Aufrufer die Transaktion kurz (kein Netzwerk, keine Dateien darin), und Massenläufe (Übernahme, Wiederherstellen) teilen sich in Stapel.
// shortcut: eine Sperre je Lager serialisiert alle Schreiber, genug für rund 100 Personen; bei Engpass die Folgenummer aus einer Sequenz je Lager ziehen und den Feed nur bis zur ersten Lücke ausliefern

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type SchreibKontext = { lagerId: string; personId: string };

// Spalten, die nur dieser Kern setzt
type Systemspalten =
  | "lagerId"
  | "version"
  | "erstelltAm"
  | "erstelltVon"
  | "geaendertAm"
  | "geaendertVon"
  | "geloeschtAm"
  | "geloeschtVon"
  | "lagerSeq";
export type AnlegeWerte<T extends LagerSpaltenTabelle> = Omit<
  T["$inferInsert"],
  Systemspalten
>;
export type AendereWerte<T extends LagerSpaltenTabelle> = Partial<
  Omit<T["$inferInsert"], Systemspalten | "id">
>;

// Was die Konfliktantwort von der Zeile zeigt: eine Funktion des Moduls, die nur liefert, was die Rolle lesen darf (dieselbe wie für GET). Die Schlüssel heissen wie die Schlüssel der Werte (camelCase der Spalten)
export type Ansicht<T extends LagerSpaltenTabelle> = (
  zeile: T["$inferSelect"],
) => Record<string, unknown>;

// Antwort mit festem Status und Body, die die Transaktion zurückrollt (409 VERSION_KONFLIKT); app.ts gibt sie unverändert aus
export class LagerAntwortFehler extends Error {
  constructor(
    readonly status: 409,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.code));
  }
}

export type SchreibArt = "neu" | "geaendert" | "geloescht";

export type SchreibEreignis = {
  lagerId: string;
  personId: string;
  // Name der Tabelle, auch Objekttyp im Feed
  tabelle: string;
  zeileId: string;
  art: SchreibArt;
  version: number;
  seq: number;
  // Zeile vor dem Schreiben (nur bei «geaendert» und «geloescht») und danach
  vorher?: Record<string, unknown>;
  nachher: Record<string, unknown>;
};
export type SchreibHaken = (tx: Tx, ereignis: SchreibEreignis) => Promise<void>;
const haken: SchreibHaken[] = [];

// Haken für L0e (#368): Papierkorb, Revisionen und Verlauf hängen sich hier ein. Er läuft in der Transaktion des Schreibvorgangs, nach dem Eintrag im Feed; wirft er, wird nichts geschrieben
export function registriereSchreibHaken(h: SchreibHaken) {
  haken.push(h);
}

async function naechsteFolgenummer(tx: Tx, lagerId: string) {
  const [zeile] = await tx
    .update(lager)
    .set({ seq: sql`${lager.seq} + 1` })
    .where(eq(lager.id, lagerId))
    .returning({ seq: lager.seq });
  // Das Lager wurde zwischen Prüfung und Schreiben gelöscht
  if (!zeile) throw new HTTPException(404);
  return zeile.seq;
}

function pruefeAnmeldung(tabelle: LagerSpaltenTabelle) {
  const name = getTableName(tabelle);
  if (!holeLagerTabelle(name)) {
    throw new Error(
      `Lager-Tabelle ${name} ist nicht angemeldet (registriereLagerTabelle)`,
    );
  }
  return name;
}

type Zeile = Record<string, unknown> & { id: string; version: number };

async function melde(
  tx: Tx,
  name: string,
  k: SchreibKontext,
  seq: number,
  art: SchreibArt,
  nachher: Zeile,
  vorher?: Zeile,
) {
  await tx.insert(lagerAenderung).values({
    lagerId: k.lagerId,
    seq,
    tabelle: name,
    zeileId: nachher.id,
    art,
    version: nachher.version,
  });
  for (const h of haken) {
    await h(tx, {
      lagerId: k.lagerId,
      personId: k.personId,
      tabelle: name,
      zeileId: nachher.id,
      art,
      version: nachher.version,
      seq,
      vorher,
      nachher,
    });
  }
}

async function ladeZeile(
  tx: Tx,
  t: LagerSpaltenTabelle,
  k: SchreibKontext,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(t)
    .where(and(eq(t.id, id), eq(t.lagerId, k.lagerId), isNull(t.geloeschtAm)));
  return zeile as Zeile | undefined;
}

// Keine Zeile getroffen: Gibt es die Zeile in diesem Lager nicht (mehr), 404 (auch für eine Zeile eines fremden Lagers); sonst stimmt die Version nicht, 409 mit dem aktuellen Stand und den Feldern, die der Aufrufer ändern wollte und die jetzt anders stehen. Nur Felder, die die Ansicht zeigt, kommen in die Liste
async function werfeKeineZeile<T extends LagerSpaltenTabelle>(
  tx: Tx,
  t: T,
  k: SchreibKontext,
  id: string,
  werte: Record<string, unknown>,
  ansicht: Ansicht<T>,
): Promise<never> {
  const aktuell = await ladeZeile(tx, t, k, id);
  if (!aktuell) throw new HTTPException(404);
  const stand = ansicht(aktuell as T["$inferSelect"]);
  throw new LagerAntwortFehler(409, {
    code: "VERSION_KONFLIKT",
    message: "Der Eintrag wurde inzwischen geändert.",
    aktuell: stand,
    abweichend: Object.keys(werte).filter(
      (feld) =>
        feld in stand &&
        JSON.stringify(stand[feld]) !== JSON.stringify(werte[feld]),
    ),
  });
}

export async function legeZeileAn<T extends LagerSpaltenTabelle>(
  tx: Tx,
  tabelle: T,
  k: SchreibKontext,
  werte: AnlegeWerte<T>,
): Promise<T["$inferSelect"]> {
  const name = pruefeAnmeldung(tabelle);
  const seq = await naechsteFolgenummer(tx, k.lagerId);
  const [neu] = await tx
    .insert(tabelle)
    .values({
      ...werte,
      lagerId: k.lagerId,
      version: 1,
      erstelltVon: k.personId,
      geaendertVon: k.personId,
      lagerSeq: seq,
    } as never)
    .returning();
  await melde(tx, name, k, seq, "neu", neu as Zeile);
  return neu as T["$inferSelect"];
}

export async function aendereZeile<T extends LagerSpaltenTabelle>(
  tx: Tx,
  tabelle: T,
  k: SchreibKontext,
  p: {
    id: string;
    // Die Version, die der Client zuletzt gesehen hat
    version: number;
    werte: AendereWerte<T>;
    ansicht: Ansicht<T>;
  },
): Promise<T["$inferSelect"]> {
  const name = pruefeAnmeldung(tabelle);
  const seq = await naechsteFolgenummer(tx, k.lagerId);
  const vorher =
    haken.length > 0 ? await ladeZeile(tx, tabelle, k, p.id) : undefined;
  const [neu] = await tx
    .update(tabelle)
    .set({
      ...p.werte,
      version: sql`${tabelle.version} + 1`,
      geaendertAm: sql`now()`,
      geaendertVon: k.personId,
      lagerSeq: seq,
    } as never)
    .where(
      and(
        eq(tabelle.id, p.id),
        eq(tabelle.lagerId, k.lagerId),
        eq(tabelle.version, p.version),
        isNull(tabelle.geloeschtAm),
      ),
    )
    .returning();
  if (!neu) {
    return werfeKeineZeile(tx, tabelle, k, p.id, p.werte, p.ansicht);
  }
  await melde(tx, name, k, seq, "geaendert", neu as Zeile, vorher);
  return neu as T["$inferSelect"];
}

// Soft-Delete: Die Zeile bleibt mit geloescht_am (Papierkorb, #368), die Version steigt, der Feed meldet «geloescht»
export async function loescheZeile<T extends LagerSpaltenTabelle>(
  tx: Tx,
  tabelle: T,
  k: SchreibKontext,
  p: { id: string; version: number; ansicht: Ansicht<T> },
): Promise<T["$inferSelect"]> {
  const name = pruefeAnmeldung(tabelle);
  const seq = await naechsteFolgenummer(tx, k.lagerId);
  const vorher =
    haken.length > 0 ? await ladeZeile(tx, tabelle, k, p.id) : undefined;
  const [neu] = await tx
    .update(tabelle)
    .set({
      version: sql`${tabelle.version} + 1`,
      geaendertAm: sql`now()`,
      geaendertVon: k.personId,
      geloeschtAm: sql`now()`,
      geloeschtVon: k.personId,
      lagerSeq: seq,
    } as never)
    .where(
      and(
        eq(tabelle.id, p.id),
        eq(tabelle.lagerId, k.lagerId),
        eq(tabelle.version, p.version),
        isNull(tabelle.geloeschtAm),
      ),
    )
    .returning();
  if (!neu) return werfeKeineZeile(tx, tabelle, k, p.id, {}, p.ansicht);
  await melde(tx, name, k, seq, "geloescht", neu as Zeile, vorher);
  return neu as T["$inferSelect"];
}
