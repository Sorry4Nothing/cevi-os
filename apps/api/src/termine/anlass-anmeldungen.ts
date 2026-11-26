import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Anmeldungen zu Anlässen (#443): was die Verwaltung der Anlässe (#442) über sie wissen muss, und die Löschfrist. Sicht und Frist stehen in anlass-sicht.ts. Alle Abfragen sind gebündelt, keine läuft je Zeile.

// Wie lange die Anmeldungen nach dem Ende des Anlasses bleiben (Annahme A13, vom Nutzer zu bestätigen)
export const AUFBEWAHRUNG_TAGE = 180;

// Wie viele Anmeldungen der Anlass hat, auch abgemeldete (Löschen ist nur ohne Anmeldungen erlaubt). Läuft in der Transaktion der Route, die den Anlass schon gesperrt hat (FOR UPDATE)
export async function zaehleAnmeldungen(
  tx: Db | Tx,
  anlassId: string,
): Promise<number> {
  const zeilen = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from anlass_anmeldung where anlass_id = ${anlassId}`,
  );
  return zeilen[0]?.n ?? 0;
}

// Die Schlüssel der Felder des Anlasses, zu denen es Antworten gibt (Schlüssel und Typ dieser Felder sind fest)
export async function schluesselMitAntworten(
  tx: Db | Tx,
  anlassId: string,
): Promise<Set<string>> {
  const zeilen = await tx.execute<{ schluessel: string }>(
    sql`select distinct k as schluessel from anlass_anmeldung a, jsonb_object_keys(a.antworten) as k where a.anlass_id = ${anlassId}`,
  );
  return new Set(zeilen.map((z) => z.schluessel));
}

// Löscht die Anmeldungen aller Anlässe, die vor mehr als 180 Tagen endeten (Anlässe der Art «lager» nicht: Ihre Teilnehmenden löscht das Lager-Modul). Eine gebündelte Abfrage für alle Anlässe, ein Eintrag im Audit-Log je Anlass mit nur der Anzahl, nie mit Antworten oder Namen. Liefert die Zahl gelöschter Anmeldungen
export async function loescheAlteAnmeldungen(
  db: Db,
  jetzt = new Date(),
  // Nur für Tests, die ihre eigenen Anlässe prüfen
  nurAnlaesse?: string[],
) {
  const eingeschraenkt = nurAnlaesse
    ? sql`and a.id in (${sql.join(
        nurAnlaesse.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const zeilen = await db.execute<{ n: number }>(sql`
    with betroffen as (
      select a.id, a.abteilung_id from anlass a
      join programm p on p.id = a.programm_id
      where a.art <> 'lager'
        and coalesce(p.ende, (p.tag_bis + 1)::timestamp at time zone 'Europe/Zurich') < ${jetzt.toISOString()}::timestamptz - make_interval(days => ${AUFBEWAHRUNG_TAGE})
        and exists (select 1 from anlass_anmeldung m where m.anlass_id = a.id)
        ${eingeschraenkt}
    ),
    weg as (
      delete from anlass_anmeldung where anlass_id in (select id from betroffen)
      returning anlass_id
    ),
    je_anlass as (
      select anlass_id, count(*)::int as n from weg group by anlass_id
    ),
    protokoll as (
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
      select b.abteilung_id, 'system', 'anlass_anmeldungen_geloescht', 'anlass', b.id, jsonb_build_object('anzahl', j.n)
      from je_anlass j join betroffen b on b.id = j.anlass_id
      returning 1
    )
    select coalesce(sum(n), 0)::int as n from je_anlass`);
  return zeilen[0]?.n ?? 0;
}
