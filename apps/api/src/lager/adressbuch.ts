import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { adressbuchKontakt } from "../db/schema.js";
import type { Fcm } from "../push.js";
import { telefonSchema } from "../telefon.js";
import { benachrichtige } from "./benachrichtigung.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Adressbuch des Lagers (#397): externe Kontakte, nur für die Lagerleitung. Lesen braucht adressbuch.lesen, jede Änderung adressbuch.bearbeiten; im Standard hat beides nur die Lagerleitung (rechte-katalog.ts), die Rechte lassen sich je Lager einstellen. Es sind Personendaten Dritter: Der Zugriff steht im Audit-Log (nur Anzahl und Ziel, nie die Inhalte).
//
// Aufräumfrist (Entscheid vom 22.11.2026): Kontakte ohne die Markierung «behalten» löscht der tägliche Lauf (loescheAlteKontakte) 180 Tage nach dem Lagerende; gelöscht ist endgültig. Die Frist folgt dem Lagerende (lager.bis) und steht darum in keiner Spalte: Verschiebt die Lagerleitung das Ende, verschiebt sich die Frist mit. Vierzehn Tage vorher bekommt die Lagerleitung eine Erinnerung (erinnereAnAufraeumen).

export const AUFRAEUMEN_TAGE = 180;
// Wie viele Tage vor dem Löschen die Lagerleitung erinnert wird
export const ERINNERUNG_TAGE = 14;
// Eine Zeile im «Papierkorb» (weiches Löschen über den Sync-Kern) hält Personendaten; der Lauf entfernt sie nach der Frist des Papierkorbs (A11, 30 Tage)
export const GELOESCHT_AUFBEWAHRUNG_TAGE = 30;

// Anmeldung beim ersten Import dieser Datei: Der Feed nennt die Zeilen nur mit dem Leserecht, nie mit Inhalt
registriereLagerTabelle({
  tabelle: adressbuchKontakt,
  recht: "adressbuch.lesen",
});

const TAG_MS = 24 * 60 * 60 * 1000;
const tagVon = (d: Date) => d.toISOString().slice(0, 10);
const plusTage = (datum: string, tage: number) =>
  tagVon(new Date(Date.parse(`${datum}T00:00:00Z`) + tage * TAG_MS));

// Ab diesem Tag (einschliesslich) löscht der Lauf einen Kontakt ohne «behalten»: Lagerende plus 180 Tage. `bis` ist das Datum als Text «JJJJ-MM-TT»
export const aufraeumenAb = (bis: string) => plusTage(bis, AUFRAEUMEN_TAGE);

export type KontaktAnsicht = {
  id: string;
  version: number;
  name: string;
  funktion: string | null;
  gruppe: string | null;
  telefon: string | null;
  email: string | null;
  notiz: string | null;
  behalten: boolean;
  // Tag, ab dem der Lauf den Kontakt löscht; null bei «behalten»
  aufraeumenAb: string | null;
  erstelltAm: Date;
};

// Ansicht der Antworten und der Konfliktantwort des Sync-Kerns. `bis` ist das Lagerende
export const kontaktAnsicht = (
  r: typeof adressbuchKontakt.$inferSelect,
  bis: string,
): KontaktAnsicht => ({
  id: r.id,
  version: r.version,
  name: r.name,
  funktion: r.funktion,
  gruppe: r.gruppe,
  telefon: r.telefon,
  email: r.email,
  notiz: r.notiz,
  behalten: r.behalten,
  aufraeumenAb: r.behalten ? null : aufraeumenAb(bis),
  erstelltAm: r.erstelltAm,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Leerer Text oder null entfernt eine optionale Angabe
const einzeilig = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\p{C}]*$/u);
const optional = (max: number) =>
  einzeilig(max)
    .transform((w) => w || null)
    .nullable();
const name = einzeilig(100).min(1);
const email = z
  .string()
  .trim()
  .max(254)
  .transform((w) => w || null)
  .pipe(z.email().nullable())
  .nullable();
// Zeilenumbrüche sind erlaubt, sonst keine Steuerzeichen
const notiz = z
  .string()
  .trim()
  .max(2000)
  .regex(/^(?:[^\p{C}]|\n)*$/u)
  .transform((w) => w || null)
  .nullable();
const version = z.number().int().min(1);

export const kontaktAnlegen = z.strictObject({
  name,
  funktion: optional(100).optional(),
  gruppe: optional(100).optional(),
  telefon: telefonSchema.optional(),
  email: email.optional(),
  notiz: notiz.optional(),
  behalten: z.boolean().optional(),
});
export const kontaktAendern = z
  .strictObject({
    version,
    name: name.optional(),
    funktion: optional(100).optional(),
    gruppe: optional(100).optional(),
    telefon: telefonSchema.optional(),
    email: email.optional(),
    notiz: notiz.optional(),
    behalten: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

export const SEITE = 100;
export const kontakteAbfrage = z.strictObject({
  // Suche in Name, Funktion und Gruppe, ohne Beachtung der Gross- und Kleinschreibung
  q: z.string().trim().min(1).max(100).optional(),
  // Cursor: die ID des letzten Eintrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});

// LIKE-Muster mit maskierten Sonderzeichen
const muster = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// Eine Seite Kontakte, alphabetisch nach Name (dann ID), mit Cursor: genau eine Abfrage je Seite, getragen vom Index (lager_id, lower(name), id). Ein unbekannter Cursor liefert eine leere Seite
export async function ladeKontakte(
  db: Db,
  lager: { id: string; bis: string },
  p: {
    id?: string;
    q?: string;
    nach?: string;
    limit?: number;
  } = {},
): Promise<{ kontakte: KontaktAnsicht[]; naechster: string | null }> {
  const limit = p.limit ?? SEITE;
  const k = adressbuchKontakt;
  const zeilen = await db
    .select()
    .from(k)
    .where(
      and(
        eq(k.lagerId, lager.id),
        isNull(k.geloeschtAm),
        p.id ? eq(k.id, p.id) : undefined,
        p.q
          ? or(
              ilike(k.name, muster(p.q)),
              ilike(k.funktion, muster(p.q)),
              ilike(k.gruppe, muster(p.q)),
            )
          : undefined,
        p.nach
          ? sql`(lower(${k.name}), ${k.id}) > (select lower(c.name), c.id from adressbuch_kontakt c where c.id = ${p.nach} and c.lager_id = ${lager.id})`
          : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${k.name})`), asc(k.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  return {
    kontakte: seite.map((z) => kontaktAnsicht(z, lager.bis)),
    naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
  };
}

// Der tägliche Aufräumlauf: eine einzige Löschanweisung für alle Lager. Sie entfernt endgültig
//  - Kontakte ohne «behalten», sobald heute der Tag aufraeumenAb(lager.bis) erreicht ist (Grenze: am Tag 180 nach dem Lagerende weg, am Tag 179 noch da), auch in abgeschlossenen Lagern,
//  - Kontakte im Papierkorb nach 30 Tagen (auch mit «behalten»), damit ein gelöschter Kontakt nicht 180 Tage nachwirkt.
// Je betroffenes Lager zählt dieselbe Anweisung die Folgenummer hoch und schreibt je Kontakt einen Feed-Eintrag «geloescht» (nur IDs), damit Geräte mit einer Offline-Kopie den Kontakt verlieren, und einen Audit-Eintrag mit der Anzahl, ohne Inhalte. Liefert die Zahl gelöschter Kontakte
export async function loescheAlteKontakte(
  db: Db,
  jetzt = new Date(),
  // Nur für Tests, die ihre eigenen Lager prüfen
  nurLager?: string[],
) {
  const heute = tagVon(jetzt);
  const eingeschraenkt = nurLager
    ? sql`and k.lager_id in (${sql.join(
        nurLager.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const zeilen = await db.execute<{ n: number }>(sql`
    with faellig as (
      select k.id, k.lager_id, k.version, l.abteilung_id,
        row_number() over (partition by k.lager_id order by k.id) as rn
      from adressbuch_kontakt k join lager l on l.id = k.lager_id
      where (
        (not k.behalten and (l.bis + make_interval(days => ${AUFRAEUMEN_TAGE}))::date <= ${heute}::date)
        or k.geloescht_am < ${jetzt.toISOString()}::timestamptz - make_interval(days => ${GELOESCHT_AUFBEWAHRUNG_TAGE})
      ) ${eingeschraenkt}
    ),
    weg as (
      delete from adressbuch_kontakt where id in (select id from faellig) returning id
    ),
    je_lager as (
      select lager_id, abteilung_id, count(*)::int as n from faellig group by lager_id, abteilung_id
    ),
    angehoben as (
      update lager set seq = lager.seq + je.n
      from je_lager je where lager.id = je.lager_id
      returning lager.id, lager.seq
    ),
    feed as (
      insert into lager_aenderung (lager_id, seq, tabelle, zeile_id, art, version)
      select f.lager_id, a.seq - je.n + f.rn, 'adressbuch_kontakt', f.id, 'geloescht', f.version + 1
      from faellig f
      join je_lager je on je.lager_id = f.lager_id
      join angehoben a on a.id = f.lager_id
      returning 1
    ),
    protokoll as (
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
      select je.abteilung_id, 'system', 'lager_adressbuch_aufgeraeumt', 'lager', je.lager_id, jsonb_build_object('anzahl', je.n)
      from je_lager je
      returning 1
    )
    select coalesce((select count(*) from weg), 0)::int as n`);
  return zeilen[0]?.n ?? 0;
}

// Die Erinnerung an die Lagerleitung, einmal je Lager: ab 14 Tage vor dem Tag, an dem der Lauf löscht, solange es Kontakte ohne «behalten» gibt und noch keine Erinnerung für dieses Lager besteht. Zwei Abfragen für alle Lager, dazu je erinnertes Lager die des Benachrichtigungskerns. Der Push nennt nur den Lagertitel. Liefert die Zahl erinnerter Lager
export async function erinnereAnAufraeumen(
  db: Db,
  fcm?: Fcm,
  jetzt = new Date(),
) {
  const heute = tagVon(jetzt);
  const lager = await db.execute<{ id: string }>(sql`
    select l.id from lager l
    where (l.bis + make_interval(days => ${AUFRAEUMEN_TAGE - ERINNERUNG_TAGE}))::date <= ${heute}::date
      and (l.bis + make_interval(days => ${AUFRAEUMEN_TAGE}))::date > ${heute}::date
      and exists (
        select 1 from adressbuch_kontakt k
        where k.lager_id = l.id and not k.behalten and k.geloescht_am is null
      )
      and not exists (
        select 1 from lager_benachrichtigung b
        where b.lager_id = l.id and b.art = 'adressbuch_aufraeumen'
      )`);
  if (lager.length === 0) return 0;
  const leitung = await db.execute<{ lager_id: string; person_id: string }>(sql`
    select lager_id, person_id from lager_mitglied
    where rolle = 'lagerleitung' and lager_id in (${sql.join(
      lager.map((l) => sql`${l.id}::uuid`),
      sql`, `,
    )})`);
  let erinnert = 0;
  for (const { id: lagerId } of lager) {
    const zustellung = await benachrichtige(db, {
      lagerId,
      empfaengerIds: leitung
        .filter((z) => z.lager_id === lagerId)
        .map((z) => z.person_id),
      art: "adressbuch_aufraeumen",
      objekt: { typ: "adressbuch", id: lagerId },
    });
    await zustellung.senden({ db, fcm });
    if (zustellung.empfaengerIds.length > 0) erinnert++;
  }
  return erinnert;
}
