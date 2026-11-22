import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  AUFGABE_STATUS,
  aufgabe,
  aufgabeUnterstuetzung,
  lagerMitglied,
  ressort,
  user,
} from "../db/schema.js";
import { benachrichtige, type Zustellung } from "./benachrichtigung.js";
import { darf, type LagerZugriff } from "./policy.js";
import type { Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Aufgaben des Lagers (#372): Ansichten, Eingabeschemas, Abfragen und die Prüfungen, die in der Schreib-Transaktion laufen. Die Tabelle ist beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet. Der Feed zeigt sie jedem, der Aufgaben lesen darf; der Zeilenfilter lässt dem Team nur die eigenen (aufgabeSichtbar).
//
// Rechte (lager/rechte-katalog.ts):
//   aufgaben.lesen_alle  alle Aufgaben lesen
//   aufgaben.bearbeiten  alle Aufgaben anlegen, ändern, löschen (wer das darf, sieht auch alle)
//   aufgaben.eigene      eigene Aufgaben lesen und deren Status setzen
// «Eigen» ist eine Aufgabe, bei der die Person die Verantwortliche ist (ohne Angabe die Leitung des Ressorts) oder die Aufgabe unterstützt. Eine fremde Aufgabe ist für die Rolle mit nur «eigene» unbekannt (404, wie eine Aufgabe eines fremden Lagers): Die Antwort verrät nicht, dass es sie gibt.
//
// Schnittstelle für die Folge-Issues (#373 bis #377): ladeAufgabe, ladeAufgaben (gebündelt: eine Abfrage für die Seite, eine für die Unterstützung), ladeAufgabeZeile (die Rohzeile in einer Transaktion), aufgabeAnsicht (für aendereZeile und die Konfliktantwort), pruefeAufgabenWerte, benachrichtigeAufgabe.
registriereLagerTabelle({
  tabelle: aufgabe,
  recht: ["aufgaben.lesen_alle", "aufgaben.bearbeiten", "aufgaben.eigene"],
  sichtbar: aufgabeSichtbar,
});

// Eine Aufgabe zählt nur, solange sie nicht gelöscht ist. Eine einzige Stelle, damit die endgültige Löschung (#427) die Bedingung hier entfernt statt in jeder Abfrage
export const aufgabeAktiv = isNull(aufgabe.geloeschtAm);
// Das Ressort einer Aufgabe: dasselbe Lager, nicht gelöscht (gleiches Ziel wie aufgabeAktiv)
const ressortJoin = and(
  eq(ressort.id, aufgabe.ressortId),
  eq(ressort.lagerId, aufgabe.lagerId),
  isNull(ressort.geloeschtAm),
);

export type AufgabeZeile = typeof aufgabe.$inferSelect;

// Ansicht für die Antwort und die Konfliktantwort des Sync-Kerns: nur die Spalten der Route, nie die ganze Zeile. Personen nur als ID
export const aufgabeAnsicht = (a: AufgabeZeile) => ({
  id: a.id,
  version: a.version,
  titel: a.titel,
  ressortId: a.ressortId,
  teil: a.teil,
  verantwortlichPersonId: a.verantwortlichPersonId,
  status: a.status,
  notiz: a.notiz,
  frist: a.frist,
  stern: a.stern,
  laufend: a.laufend,
  spaeterAb: a.spaeterAb,
  wiederholung: a.wiederholung,
  reihenfolge: a.reihenfolge,
  quelle: a.quelle,
  erledigtAm: a.erledigtAm,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). erledigtAm, quelle und fristErinnertAm setzt nur der Server oder ein späteres Modul, nie der Client
const titel = z.string().trim().min(1).max(200);
const teil = z.string().trim().min(1).max(100).nullable();
const notiz = z.string().trim().max(5000).nullable();
const person = z.uuid().nullable();
const datum = z.iso.date().refine((wert) => !wert.startsWith("0000"));
const status = z.enum(AUFGABE_STATUS);
const version = z.number().int().min(1);
const reihenfolge = z.number().int().min(0).max(100000);
const personen = z
  .array(z.uuid())
  .max(50)
  .refine((l) => new Set(l).size === l.length);

export const aufgabeAnlegen = z.strictObject({
  titel,
  ressortId: z.uuid().nullable().optional(),
  teil: teil.optional(),
  verantwortlichPersonId: person.optional(),
  unterstuetzungPersonIds: personen.optional(),
  status: status.optional(),
  notiz: notiz.optional(),
  frist: datum.nullable().optional(),
  stern: z.boolean().optional(),
  laufend: z.boolean().optional(),
  spaeterAb: datum.nullable().optional(),
  wiederholung: z.enum(["w1", "w2", "m1"]).nullable().optional(),
  reihenfolge: reihenfolge.optional(),
});
export const aufgabeAendern = z
  .strictObject({
    version,
    titel: titel.optional(),
    ressortId: z.uuid().nullable().optional(),
    teil: teil.optional(),
    verantwortlichPersonId: person.optional(),
    unterstuetzungPersonIds: personen.optional(),
    status: status.optional(),
    notiz: notiz.optional(),
    frist: datum.nullable().optional(),
    stern: z.boolean().optional(),
    laufend: z.boolean().optional(),
    spaeterAb: datum.nullable().optional(),
    wiederholung: z.enum(["w1", "w2", "m1"]).nullable().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const statusSetzen = z.strictObject({ version, status });
export const aufgabeReihenfolge = z.strictObject({
  eintraege: z
    .array(z.strictObject({ id: z.uuid(), version }))
    .min(1)
    .max(200)
    .refine((l) => new Set(l.map((e) => e.id)).size === l.length),
});
export const aufgabeVersion = z.strictObject({
  version: z.coerce.number().int().min(1),
});

const flag = z.enum(["true", "false"]).transform((w) => w === "true");
export const aufgabenAbfrage = z.strictObject({
  // Cursor: die ID der letzten Aufgabe der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  ressortId: z.uuid().optional(),
  // Aufgaben einer Person: sie ist Verantwortliche (ohne Angabe die Leitung des Ressorts) oder unterstützt
  personId: z.uuid().optional(),
  status: status.optional(),
  ueberfaellig: flag.optional(),
  stern: flag.optional(),
  fristVon: datum.optional(),
  fristBis: datum.optional(),
});
export type AufgabenFilter = Omit<
  z.infer<typeof aufgabenAbfrage>,
  "nach" | "limit"
>;

// Wirksame Verantwortliche: die gesetzte Person, sonst die Leitung des Ressorts
const wirksam = sql`coalesce(${aufgabe.verantwortlichPersonId}, ${ressort.leitungPersonId})`;
// Die Person ist Verantwortliche oder unterstützt die Aufgabe. Je eine Abfrage mit dem Index über (Lager, Person) auf der Unterstützung
const beteiligt = (personId: string) =>
  sql`(${wirksam} = ${personId} or exists (select 1 from ${aufgabeUnterstuetzung} u where u.aufgabe_id = ${aufgabe.id} and u.person_id = ${personId}))`;
// Heute in der Schweiz: die Frist ist ein Datum ohne Uhrzeit
const heute = sql`(now() at time zone 'Europe/Zurich')::date`;

// Wie viel die Rolle lesen darf: alle Aufgaben oder nur die eigenen (undefined: gar keine)
export function leseUmfang(
  zugriff: Pick<LagerZugriff, "rolle"> & Partial<Pick<LagerZugriff, "rechte">>,
) {
  if (
    darf(zugriff, "aufgaben.lesen_alle") ||
    darf(zugriff, "aufgaben.bearbeiten")
  ) {
    return "alle" as const;
  }
  return darf(zugriff, "aufgaben.eigene") ? ("eigene" as const) : undefined;
}

// Zeilenfilter des Feeds: Wer nicht alle Aufgaben lesen darf, sieht nur die eigenen. Beurteilt auch gelöschte Zeilen (der Feed meldet «geloescht»)
async function aufgabeSichtbar(db: Db, zugriff: LagerZugriff, ids: string[]) {
  if (leseUmfang(zugriff) === "alle") return new Set(ids);
  const personId = zugriff.personId;
  if (ids.length === 0) return new Set<string>();
  const zeilen = await db
    .select({ id: aufgabe.id })
    .from(aufgabe)
    .leftJoin(ressort, ressortJoin)
    .where(
      and(
        eq(aufgabe.lagerId, zugriff.lager.id),
        inArray(aufgabe.id, ids),
        beteiligt(personId),
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}

type PersonKurz = { id: string; name: string | null; ceviName: string | null };

export type AufgabeAntwort = ReturnType<typeof aufgabeAnsicht> & {
  // Die wirksame Verantwortliche; «automatisch» heisst: gesetzt ist niemand, es ist die Leitung des Ressorts
  verantwortlich: (PersonKurz & { automatisch: boolean }) | null;
  ressort: { id: string; kuerzel: string; name: string } | null;
  unterstuetzung: PersonKurz[];
};

// Eine Seite Aufgaben in zwei Abfragen: die Aufgaben mit Ressort und Verantwortlicher (Join), dann die Unterstützung aller Aufgaben der Seite (eine Abfrage mit IN). eigeneVon: nur Aufgaben, bei denen diese Person beteiligt ist
export async function ladeAufgaben(
  db: Pick<Db, "select">,
  lagerId: string,
  p: AufgabenFilter & {
    id?: string;
    nach?: string;
    limit?: number;
    eigeneVon?: string;
  },
): Promise<{ aufgaben: AufgabeAntwort[]; naechster: string | null }> {
  const limit = p.limit ?? 100;
  const verantwortliche = alias(user, "verantwortliche");
  const ueberfaellig = and(
    sql`${aufgabe.frist} < ${heute}`,
    sql`${aufgabe.status} <> 'erledigt'`,
  );
  const zeilen = await db
    .select({
      zeile: aufgabe,
      ressortId: ressort.id,
      ressortKuerzel: ressort.kuerzel,
      ressortName: ressort.name,
      vName: verantwortliche.name,
      vCevi: verantwortliche.ceviName,
      vId: sql<string | null>`${wirksam}`,
    })
    .from(aufgabe)
    .leftJoin(ressort, ressortJoin)
    .leftJoin(verantwortliche, sql`${verantwortliche.id} = ${wirksam}`)
    .where(
      and(
        eq(aufgabe.lagerId, lagerId),
        aufgabeAktiv,
        p.id ? eq(aufgabe.id, p.id) : undefined,
        p.eigeneVon ? beteiligt(p.eigeneVon) : undefined,
        p.personId ? beteiligt(p.personId) : undefined,
        p.ressortId ? eq(aufgabe.ressortId, p.ressortId) : undefined,
        p.status ? eq(aufgabe.status, p.status) : undefined,
        p.stern === undefined ? undefined : eq(aufgabe.stern, p.stern),
        p.ueberfaellig === undefined
          ? undefined
          : p.ueberfaellig
            ? ueberfaellig
            : sql`not coalesce(${ueberfaellig}, false)`,
        p.fristVon ? sql`${aufgabe.frist} >= ${p.fristVon}` : undefined,
        p.fristBis ? sql`${aufgabe.frist} <= ${p.fristBis}` : undefined,
        // Nach (Reihenfolge, ID) der letzten bekannten Aufgabe; ist sie unbekannt, bleibt die Seite leer
        p.nach
          ? sql`(${aufgabe.reihenfolge}, ${aufgabe.id}) > (select a.reihenfolge, a.id from aufgabe a where a.id = ${p.nach} and a.lager_id = ${lagerId})`
          : undefined,
      ),
    )
    .orderBy(asc(aufgabe.reihenfolge), asc(aufgabe.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);

  const unterstuetzung = new Map<string, PersonKurz[]>();
  if (seite.length > 0) {
    const liste = await db
      .select({
        aufgabeId: aufgabeUnterstuetzung.aufgabeId,
        id: user.id,
        name: user.name,
        ceviName: user.ceviName,
      })
      .from(aufgabeUnterstuetzung)
      .innerJoin(user, eq(user.id, aufgabeUnterstuetzung.personId))
      .where(
        inArray(
          aufgabeUnterstuetzung.aufgabeId,
          seite.map((z) => z.zeile.id),
        ),
      )
      .orderBy(asc(user.name), asc(user.id));
    for (const { aufgabeId, ...kurz } of liste) {
      unterstuetzung.set(aufgabeId, [
        ...(unterstuetzung.get(aufgabeId) ?? []),
        kurz,
      ]);
    }
  }
  return {
    aufgaben: seite.map((z) => ({
      ...aufgabeAnsicht(z.zeile),
      verantwortlich: z.vId
        ? {
            id: z.vId,
            name: z.vName,
            ceviName: z.vCevi,
            automatisch: z.zeile.verantwortlichPersonId === null,
          }
        : null,
      ressort: z.ressortId
        ? { id: z.ressortId, kuerzel: z.ressortKuerzel!, name: z.ressortName! }
        : null,
      unterstuetzung: unterstuetzung.get(z.zeile.id) ?? [],
    })),
    naechster: zeilen.length > limit ? seite[limit - 1]!.zeile.id : null,
  };
}

export async function ladeAufgabe(
  db: Pick<Db, "select">,
  lagerId: string,
  id: string,
  eigeneVon?: string,
) {
  const { aufgaben } = await ladeAufgaben(db, lagerId, { id, eigeneVon });
  return aufgaben[0];
}

// Die Rohzeile für Schreibwege; undefined: gibt es im Lager nicht (mehr), auch für eine Aufgabe eines fremden Lagers
export async function ladeAufgabeZeile(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  const [zeile] = await tx
    .select()
    .from(aufgabe)
    .where(and(eq(aufgabe.id, id), eq(aufgabe.lagerId, lagerId), aufgabeAktiv));
  return zeile;
}

// Ist die Person bei dieser Aufgabe beteiligt (Verantwortliche oder Unterstützung)? Für die Rolle mit nur «eigene»
export async function istBeteiligt(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
  personId: string,
) {
  const [zeile] = await tx
    .select({ id: aufgabe.id })
    .from(aufgabe)
    .leftJoin(ressort, ressortJoin)
    .where(
      and(
        eq(aufgabe.id, id),
        eq(aufgabe.lagerId, lagerId),
        aufgabeAktiv,
        beteiligt(personId),
      ),
    );
  return zeile !== undefined;
}

export type Pruefung =
  { fehler: "KEIN_MITGLIED" | "RESSORT_UNBEKANNT" } | undefined;

// Verantwortliche und Unterstützung sind Mitglieder dieses Lagers, das Ressort gibt es in diesem Lager (Ziele aus der Anfrage sind nie ein Nachweis, SR-11). Die Fremdschlüssel halten dasselbe noch einmal fest
export async function pruefeAufgabenWerte(
  tx: Pick<Db, "select">,
  lagerId: string,
  werte: {
    ressortId?: string | null;
    verantwortlichPersonId?: string | null;
    unterstuetzungPersonIds?: string[];
  },
): Promise<Pruefung> {
  const gesucht = [
    ...new Set([
      werte.verantwortlichPersonId,
      ...(werte.unterstuetzungPersonIds ?? []),
    ]),
  ].filter((p): p is string => typeof p === "string");
  if (gesucht.length > 0) {
    const gefunden = await tx
      .select({ id: lagerMitglied.personId })
      .from(lagerMitglied)
      .where(
        and(
          eq(lagerMitglied.lagerId, lagerId),
          inArray(lagerMitglied.personId, gesucht),
        ),
      );
    if (gefunden.length !== gesucht.length) return { fehler: "KEIN_MITGLIED" };
  }
  if (typeof werte.ressortId === "string") {
    const [r] = await tx
      .select({ id: ressort.id })
      .from(ressort)
      .where(
        and(
          eq(ressort.id, werte.ressortId),
          eq(ressort.lagerId, lagerId),
          isNull(ressort.geloeschtAm),
        ),
      );
    if (!r) return { fehler: "RESSORT_UNBEKANNT" };
  }
  return undefined;
}

// Erledigt-Zeitpunkt und Status gehören zusammen (CHECK in der Datenbank): Wechselt der Status, setzt der Server den Zeitpunkt oder leert ihn. Bleibt der Status, bleibt auch der Zeitpunkt
export const statusWerte = (
  alt: AufgabeZeile["status"],
  neu: AufgabeZeile["status"],
) =>
  alt === neu
    ? {}
    : { status: neu, erledigtAm: neu === "erledigt" ? new Date() : null };

type Wirksame = { wirksam: string | null; unterstuetzung: string[] };

// Die Verantwortliche und die Unterstützung, wie sie jetzt gelten (in der Transaktion, nach dem Schreiben)
export async function ladeBeteiligte(
  tx: Pick<Db, "select">,
  lagerId: string,
  id: string,
): Promise<Wirksame> {
  const [zeile] = await tx
    .select({ wirksam: sql<string | null>`${wirksam}` })
    .from(aufgabe)
    .leftJoin(ressort, ressortJoin)
    .where(and(eq(aufgabe.id, id), eq(aufgabe.lagerId, lagerId)));
  const liste = await tx
    .select({ id: aufgabeUnterstuetzung.personId })
    .from(aufgabeUnterstuetzung)
    .where(eq(aufgabeUnterstuetzung.aufgabeId, id));
  return {
    wirksam: zeile?.wirksam ?? null,
    unterstuetzung: liste.map((z) => z.id),
  };
}

// Setzt die Unterstützung auf genau diese Personen (nur die Unterschiede werden geschrieben)
export async function setzeUnterstuetzung(
  tx: Tx,
  lagerId: string,
  aufgabeId: string,
  personIds: string[],
) {
  const soll = new Set(personIds);
  const ist = await tx
    .select({ id: aufgabeUnterstuetzung.personId })
    .from(aufgabeUnterstuetzung)
    .where(eq(aufgabeUnterstuetzung.aufgabeId, aufgabeId));
  const weg = ist.map((z) => z.id).filter((id) => !soll.has(id));
  const da = new Set(ist.map((z) => z.id));
  const dazu = [...soll].filter((id) => !da.has(id));
  if (weg.length > 0) {
    await tx
      .delete(aufgabeUnterstuetzung)
      .where(
        and(
          eq(aufgabeUnterstuetzung.aufgabeId, aufgabeId),
          inArray(aufgabeUnterstuetzung.personId, weg),
        ),
      );
  }
  if (dazu.length > 0) {
    await tx
      .insert(aufgabeUnterstuetzung)
      .values(dazu.map((personId) => ({ lagerId, aufgabeId, personId })));
  }
}

// Benachrichtigungen einer Änderung (in der Schreib-Transaktion; nach dem Commit zustellung.senden). Neu verantwortlich oder neu in der Unterstützung: «aufgabe_zugeteilt». Alle anderen Beteiligten, auch die bisherige Verantwortliche: «aufgabe_geaendert», wenn sich etwas geändert hat. Der Auslöser bekommt nie etwas (benachrichtige filtert ihn); der Push nennt nie den Aufgabentitel
export async function benachrichtigeAufgabe(
  tx: Tx,
  p: {
    lagerId: string;
    aufgabeId: string;
    ausgeloestVon: string;
    vorher?: Wirksame;
    nachher: Wirksame;
    geaendert: boolean;
  },
): Promise<Zustellung> {
  const { vorher, nachher } = p;
  const zugeteilt = new Set<string>();
  if (nachher.wirksam && nachher.wirksam !== vorher?.wirksam) {
    zugeteilt.add(nachher.wirksam);
  }
  for (const id of nachher.unterstuetzung) {
    if (!vorher?.unterstuetzung.includes(id)) zugeteilt.add(id);
  }
  const geaendert = new Set<string>();
  if (p.geaendert && vorher) {
    for (const id of [
      vorher.wirksam,
      nachher.wirksam,
      ...vorher.unterstuetzung,
      ...nachher.unterstuetzung,
    ]) {
      if (id && !zugeteilt.has(id)) geaendert.add(id);
    }
  }
  const gemeinsam = {
    lagerId: p.lagerId,
    objekt: { typ: "aufgabe", id: p.aufgabeId },
    ausgeloestVon: p.ausgeloestVon,
  };
  const liste = [
    await benachrichtige(tx, {
      ...gemeinsam,
      empfaengerIds: [...zugeteilt],
      art: "aufgabe_zugeteilt",
    }),
    await benachrichtige(tx, {
      ...gemeinsam,
      empfaengerIds: [...geaendert],
      art: "aufgabe_geaendert",
    }),
  ];
  return {
    empfaengerIds: liste.flatMap((z) => z.empfaengerIds),
    senden: async (ctx) => {
      for (const z of liste) await z.senden(ctx);
    },
  };
}
