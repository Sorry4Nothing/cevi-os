import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  anwesenheit,
  dienst,
  lagerMitglied,
  lagertag,
  schicht,
  teilnehmer,
  user,
} from "../db/schema.js";
import { sperreLager } from "./ressorts.js";
import { schlageVor } from "./schichtvorschlag.js";
import { SEED_MAX } from "./mischen.js";
import {
  aendereZeile,
  legeZeileAn,
  legeZeilenAn,
  loescheZeile,
  loescheZeilen,
  type Tx,
} from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";
import { pruefeTageUndAbschnitte } from "./zeitplan.js";

// Dienste und Schichtplan des Lagers (#388). Beide Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit einteilung.lesen, kein Zeilenfilter; der Feed nennt nur IDs). Lesen braucht einteilung.lesen, jede Änderung einteilung.bearbeiten.
// Eingeteilt werden Mitglieder des Lagers und Teilnehmende, die nicht «nicht dabei» sind (#387). Ein Dienst gehört zu einem Tagesabschnitt und gilt an jedem Lagertag; eine Schicht ist eine Person in einem Dienst an einem Lagertag.
for (const tabelle of [dienst, schicht]) {
  registriereLagerTabelle({ tabelle, recht: "einteilung.lesen" });
}
// Suche (#399): Name und Beschreibung des Dienstes (kein Zeilenfilter, wie in der Liste)
registriereSuchquelle({
  typ: "dienst",
  recht: "einteilung.lesen",
  tabelle: dienst,
  spalten: [dienst.name, dienst.beschreibung],
  titel: sql`${dienst.name}`,
});

// Höchstens so viele Dienste je Lager und Personen je Dienst und Tag (SR-71)
export const MAX_DIENSTE = 100;
export const MAX_BESETZUNG = 50;

export const dienstAnsicht = (r: typeof dienst.$inferSelect) => ({
  id: r.id,
  version: r.version,
  name: r.name,
  beschreibung: r.beschreibung,
  mindestbesetzung: r.mindestbesetzung,
  nacht: r.nacht,
  tagesabschnittId: r.tagesabschnittId,
  reihenfolge: r.reihenfolge,
});

// Eingaben: strikt, nur die genannten Felder (SR-72); Leerzeichen am Rand fallen weg, Umlaute werden zusammengesetzt (NFC), Steuerzeichen sind verboten
const name = z
  .string()
  .transform((w) => w.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(100)
      .refine((w) => !/\p{Cc}/u.test(w)),
  );
const beschreibung = z
  .string()
  .transform((w) => w.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(500)
      // Zeilenumbruch und Tabulator sind in der Beschreibung erlaubt
      .refine((w) => !/[\p{Cc}]/u.test(w.replace(/[\n\t]/g, ""))),
  );
const mindestbesetzung = z.number().int().min(1).max(20);
const reihenfolge = z.number().int().min(0).max(1000);
const eindeutig = (liste: string[]) => new Set(liste).size === liste.length;

export const dienstAnlegen = z.strictObject({
  name,
  beschreibung: beschreibung.optional(),
  mindestbesetzung: mindestbesetzung.optional(),
  nacht: z.boolean().optional(),
  tagesabschnittId: z.uuid(),
  reihenfolge: reihenfolge.optional(),
});
// Der Abschnitt lässt sich nicht ändern: Die Schichten führen ihn mit
export const dienstAendern = z
  .strictObject({
    version: z.number().int().min(1),
    name: name.optional(),
    beschreibung: beschreibung.nullable().optional(),
    mindestbesetzung: mindestbesetzung.optional(),
    nacht: z.boolean().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// Die ganze Besetzung eines Dienstes an einem Tag: Wer nicht genannt ist, wird ausgeteilt, wer fehlt, eingeteilt. Leere Listen leeren den Dienst für den Tag
export const besetzen = z
  .strictObject({
    lagertagId: z.uuid(),
    dienstId: z.uuid(),
    personIds: z.array(z.uuid()).max(MAX_BESETZUNG).default([]),
    teilnehmerIds: z.array(z.uuid()).max(MAX_BESETZUNG).default([]),
  })
  .refine(
    (b) =>
      b.personIds.length + b.teilnehmerIds.length <= MAX_BESETZUNG &&
      eindeutig(b.personIds) &&
      eindeutig(b.teilnehmerIds),
  );

// uebernehmen false: nur Vorschlag, es wird nichts geschrieben. seed (optional) macht den Vorschlag wiederholbar; ohne ihn zieht der Server einen und nennt ihn in der Antwort. lagertagIds: nur diese Tage füllen (ohne Angabe alle). nurAnwesende (Standard): nur wer im Abschnitt als anwesend (A) eingetragen ist; false: auch wer offen (O) ist, nur abwesende (F) nie. mitTeilnehmenden: auch Teilnehmende einteilen (Standard: nur Mitglieder des Lagers)
export const vorschlagen = z.strictObject({
  uebernehmen: z.boolean(),
  seed: z.number().int().min(0).max(SEED_MAX).optional(),
  lagertagIds: z.array(z.uuid()).min(1).max(100).refine(eindeutig).optional(),
  nurAnwesende: z.boolean().default(true),
  mitTeilnehmenden: z.boolean().default(false),
});

export type SchichtplanFehler =
  | "LIMIT_ERREICHT"
  | "DIENST_VORHANDEN"
  | "ABGEWAEHLT"
  | "ABWESEND"
  | "DOPPELBELEGT";
type Fehler = { fehler: SchichtplanFehler };

type Leser = Pick<Db, "execute">;
type Akteur = { lagerId: string; personId: string };

export type SchichtplanDienst = ReturnType<typeof dienstAnsicht>;
export type SchichtplanSchicht = {
  id: string;
  version: number;
  dienstId: string;
  lagertagId: string;
  datum: string;
  tagesabschnittId: string;
  personId: string | null;
  teilnehmerId: string | null;
  name: string;
  ceviName: string | null;
  stufe: string | null;
};

// Der Schichtplan in einer Abfrage (zwei Teilabfragen in einer Anweisung): die Dienste und die Schichten, beide in der Reihenfolge des Plans (Tag, Abschnitt, Dienst, Name). Schichten von Abgewählten, gelöschten Teilnehmenden, deaktivierten oder ausgetretenen Konten und von gelöschten Tagen, Abschnitten und Diensten erscheinen nicht. Die Abfrage ist für jeden Aufrufer gleich (Ausdruck #405, Vorschlag, Route) und kennt keine Rolle. Das Datum kommt als Text («2027-07-10»)
export async function ladeSchichtplan(db: Leser, lagerId: string) {
  const [zeile] = await db.execute<{
    dienste: SchichtplanDienst[];
    schichten: SchichtplanSchicht[];
  }>(sql`
    select
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'version', d.version, 'name', d.name, 'beschreibung', d.beschreibung,
          'mindestbesetzung', d.mindestbesetzung, 'nacht', d.nacht,
          'tagesabschnittId', d.tagesabschnitt_id, 'reihenfolge', d.reihenfolge)
          order by a.reihenfolge, a.id, d.reihenfolge, d.name, d.id)
        from dienst d
        join tagesabschnitt a on a.lager_id = d.lager_id and a.id = d.tagesabschnitt_id and a.geloescht_am is null
        where d.lager_id = ${lagerId} and d.geloescht_am is null), '[]'::jsonb) as dienste,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'version', s.version, 'dienstId', s.dienst_id, 'lagertagId', s.lagertag_id,
          'datum', t.datum::text, 'tagesabschnittId', s.tagesabschnitt_id,
          'personId', u.id, 'teilnehmerId', k.id,
          'name', coalesce(u.name, k.vorname || ' ' || k.nachname),
          'ceviName', u.cevi_name, 'stufe', k.stufe)
          order by t.datum, a.reihenfolge, a.id, d.reihenfolge, d.name, d.id, coalesce(u.name, k.nachname), s.id)
        from schicht s
        join lager l on l.id = s.lager_id
        join dienst d on d.lager_id = s.lager_id and d.id = s.dienst_id and d.geloescht_am is null
        join lagertag t on t.lager_id = s.lager_id and t.id = s.lagertag_id and t.geloescht_am is null
        join tagesabschnitt a on a.lager_id = s.lager_id and a.id = s.tagesabschnitt_id and a.geloescht_am is null
        left join "user" u on u.id = s.person_id and u.abteilung_id = l.abteilung_id and u.deaktiviert_am is null and coalesce(u.banned, false) = false
        left join teilnehmer k on k.lager_id = s.lager_id and k.id = s.teilnehmer_id and k.geloescht_am is null and not k.abgewaehlt
        where s.lager_id = ${lagerId} and s.geloescht_am is null and (u.id is not null or k.id is not null)), '[]'::jsonb) as schichten`);
  return zeile!;
}

// Wie viele Schichten und Nachtwachen jede Person im Plan hat; aus den schon geladenen Zeilen, ohne weitere Abfrage
export function statistikVon(plan: {
  dienste: SchichtplanDienst[];
  schichten: SchichtplanSchicht[];
}) {
  const nacht = new Set(plan.dienste.filter((d) => d.nacht).map((d) => d.id));
  const je = new Map<
    string,
    {
      personId: string | null;
      teilnehmerId: string | null;
      name: string;
      anzahl: number;
      nachtwachen: number;
    }
  >();
  for (const s of plan.schichten) {
    const k = s.personId ?? s.teilnehmerId!;
    const z = je.get(k) ?? {
      personId: s.personId,
      teilnehmerId: s.teilnehmerId,
      name: s.name,
      anzahl: 0,
      nachtwachen: 0,
    };
    z.anzahl++;
    if (nacht.has(s.dienstId)) z.nachtwachen++;
    je.set(k, z);
  }
  return [...je.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "de") || a.anzahl - b.anzahl,
  );
}

// Dienste -------------------------------------------------------------------------

async function ladeDienst(tx: Pick<Db, "select">, lagerId: string, id: string) {
  const [zeile] = await tx
    .select()
    .from(dienst)
    .where(
      and(
        eq(dienst.lagerId, lagerId),
        eq(dienst.id, id),
        isNull(dienst.geloeschtAm),
      ),
    );
  if (!zeile) throw new HTTPException(404);
  return zeile;
}

async function dienstVorhanden(
  tx: Pick<Db, "select">,
  lagerId: string,
  abschnittId: string,
  n: string,
  ausser?: string,
) {
  const [z] = await tx
    .select({ id: dienst.id })
    .from(dienst)
    .where(
      and(
        eq(dienst.lagerId, lagerId),
        eq(dienst.tagesabschnittId, abschnittId),
        sql`lower(${dienst.name}) = lower(${n})`,
        isNull(dienst.geloeschtAm),
        ausser ? ne(dienst.id, ausser) : undefined,
      ),
    );
  return z !== undefined;
}

export async function legeDienstAn(
  tx: Tx,
  k: Akteur,
  e: z.output<typeof dienstAnlegen>,
): Promise<Fehler | { dienst: SchichtplanDienst }> {
  await sperreLager(tx, k.lagerId);
  if (
    !(await pruefeTageUndAbschnitte(tx, k.lagerId, [], [e.tagesabschnittId]))
  ) {
    throw new HTTPException(404);
  }
  if (await dienstVorhanden(tx, k.lagerId, e.tagesabschnittId, e.name)) {
    return { fehler: "DIENST_VORHANDEN" };
  }
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(dienst)
    .where(and(eq(dienst.lagerId, k.lagerId), isNull(dienst.geloeschtAm)));
  if (n! >= MAX_DIENSTE) return { fehler: "LIMIT_ERREICHT" };
  return {
    dienst: dienstAnsicht(
      await legeZeileAn(tx, dienst, k, {
        name: e.name,
        beschreibung: e.beschreibung ?? null,
        mindestbesetzung: e.mindestbesetzung ?? 1,
        nacht: e.nacht ?? false,
        tagesabschnittId: e.tagesabschnittId,
        // Ohne Angabe ans Ende
        reihenfolge: e.reihenfolge ?? n!,
      }),
    ),
  };
}

export async function aendereDienst(
  tx: Tx,
  k: Akteur,
  id: string,
  { version, ...werte }: z.output<typeof dienstAendern>,
): Promise<Fehler | { dienst: SchichtplanDienst }> {
  await sperreLager(tx, k.lagerId);
  const alt = await ladeDienst(tx, k.lagerId, id);
  if (
    werte.name !== undefined &&
    (await dienstVorhanden(tx, k.lagerId, alt.tagesabschnittId, werte.name, id))
  ) {
    return { fehler: "DIENST_VORHANDEN" };
  }
  return {
    dienst: dienstAnsicht(
      await aendereZeile(tx, dienst, k, {
        id,
        version,
        werte,
        ansicht: dienstAnsicht,
      }),
    ),
  };
}

// Mit dem Dienst gehen seine Schichten (Soft-Delete wie der Dienst; endgültig mit #427)
export async function loescheDienst(
  tx: Tx,
  k: Akteur,
  id: string,
  version: number,
) {
  await sperreLager(tx, k.lagerId);
  await loescheZeile(tx, dienst, k, { id, version, ansicht: dienstAnsicht });
  const schichten = await tx
    .select({ id: schicht.id })
    .from(schicht)
    .where(
      and(
        eq(schicht.lagerId, k.lagerId),
        eq(schicht.dienstId, id),
        isNull(schicht.geloeschtAm),
      ),
    );
  await loescheZeilen(tx, schicht, k, { ids: schichten.map((s) => s.id) });
}

// Schichten ----------------------------------------------------------------------

// Mitglieder des Lagers in der Abteilung, aktiv: nur sie lassen sich einteilen
const aktiveMitglieder = (
  tx: Pick<Db, "select">,
  lagerId: string,
  abteilungId: string,
  ids?: string[],
) =>
  tx
    .select({
      id: lagerMitglied.personId,
      name: user.name,
      ceviName: user.ceviName,
    })
    .from(lagerMitglied)
    .innerJoin(user, eq(user.id, lagerMitglied.personId))
    .where(
      and(
        eq(lagerMitglied.lagerId, lagerId),
        eq(user.abteilungId, abteilungId),
        isNull(user.deaktiviertAm),
        sql`coalesce(${user.banned}, false) = false`,
        ids ? inArray(lagerMitglied.personId, ids) : undefined,
      ),
    );

// Setzt die Besetzung eines Dienstes an einem Tag auf genau die genannten Leute (idempotent, darum für die Warteschlange der App geeignet). Abgewählte Teilnehmende (409 ABGEWAEHLT), Leute, die im Abschnitt als abwesend (F) eingetragen sind (409 ABWESEND), und wer im selben Abschnitt desselben Tages schon in einem anderen Dienst steht (409 DOPPELBELEGT), werden abgelehnt; unbekannte Tage, Dienste, Teilnehmende und Konten ausserhalb des Lagers sind 404. Offene Anwesenheit (O) hindert nicht: Die Leitung teilt auch vor der Anwesenheitsliste ein. Die Regel «keine Nachtwachen hintereinander» gilt für den Vorschlag, nicht für die Hand der Leitung.
export async function besetze(
  tx: Tx,
  k: Akteur,
  abteilungId: string,
  e: z.output<typeof besetzen>,
): Promise<Fehler | { geaendert: number }> {
  await sperreLager(tx, k.lagerId);
  const d = await ladeDienst(tx, k.lagerId, e.dienstId);
  if (!(await pruefeTageUndAbschnitte(tx, k.lagerId, [e.lagertagId], []))) {
    throw new HTTPException(404);
  }
  const [mitglieder, kinder, vorhanden] = await Promise.all([
    e.personIds.length === 0
      ? []
      : aktiveMitglieder(tx, k.lagerId, abteilungId, e.personIds),
    e.teilnehmerIds.length === 0
      ? []
      : tx
          .select({ id: teilnehmer.id, abgewaehlt: teilnehmer.abgewaehlt })
          .from(teilnehmer)
          .where(
            and(
              eq(teilnehmer.lagerId, k.lagerId),
              isNull(teilnehmer.geloeschtAm),
              inArray(teilnehmer.id, e.teilnehmerIds),
            ),
          ),
    tx
      .select()
      .from(schicht)
      .where(
        and(
          eq(schicht.lagerId, k.lagerId),
          eq(schicht.dienstId, d.id),
          eq(schicht.lagertagId, e.lagertagId),
          isNull(schicht.geloeschtAm),
        ),
      ),
  ]);
  if (
    mitglieder.length !== e.personIds.length ||
    kinder.length !== e.teilnehmerIds.length
  ) {
    throw new HTTPException(404);
  }
  if (kinder.some((x) => x.abgewaehlt)) return { fehler: "ABGEWAEHLT" };
  const schonDa = new Set(vorhanden.map((s) => s.personId ?? s.teilnehmerId));
  const neu = [
    ...e.personIds.filter((id) => !schonDa.has(id)),
    ...e.teilnehmerIds.filter((id) => !schonDa.has(id)),
  ];
  // Nur wer neu dazukommt, wird auf Abwesenheit und Doppelbelegung geprüft (Bestehendes bleibt, wie es ist)
  if (neu.length > 0) {
    const personen = e.personIds.filter((id) => neu.includes(id));
    const teilnehmende = e.teilnehmerIds.filter((id) => neu.includes(id));
    const werA = or(
      personen.length > 0 ? inArray(anwesenheit.personId, personen) : undefined,
      teilnehmende.length > 0
        ? inArray(anwesenheit.teilnehmerId, teilnehmende)
        : undefined,
    );
    const werS = or(
      personen.length > 0 ? inArray(schicht.personId, personen) : undefined,
      teilnehmende.length > 0
        ? inArray(schicht.teilnehmerId, teilnehmende)
        : undefined,
    );
    const [abwesend, doppelt] = await Promise.all([
      tx
        .select({ id: anwesenheit.id })
        .from(anwesenheit)
        .where(
          and(
            eq(anwesenheit.lagerId, k.lagerId),
            eq(anwesenheit.lagertagId, e.lagertagId),
            eq(anwesenheit.tagesabschnittId, d.tagesabschnittId),
            eq(anwesenheit.wert, "F"),
            isNull(anwesenheit.geloeschtAm),
            werA,
          ),
        )
        .limit(1),
      tx
        .select({ id: schicht.id })
        .from(schicht)
        .where(
          and(
            eq(schicht.lagerId, k.lagerId),
            eq(schicht.lagertagId, e.lagertagId),
            eq(schicht.tagesabschnittId, d.tagesabschnittId),
            ne(schicht.dienstId, d.id),
            isNull(schicht.geloeschtAm),
            werS,
          ),
        )
        .limit(1),
    ]);
    if (abwesend.length > 0) return { fehler: "ABWESEND" };
    if (doppelt.length > 0) return { fehler: "DOPPELBELEGT" };
  }
  const soll = new Set([...e.personIds, ...e.teilnehmerIds]);
  const weg = await loescheZeilen(tx, schicht, k, {
    ids: vorhanden
      .filter((s) => !soll.has((s.personId ?? s.teilnehmerId)!))
      .map((s) => s.id),
  });
  const dazu = await legeZeilenAn(
    tx,
    schicht,
    k,
    neu.map((id) => ({
      lagertagId: e.lagertagId,
      tagesabschnittId: d.tagesabschnittId,
      dienstId: d.id,
      ...(e.personIds.includes(id) ? { personId: id } : { teilnehmerId: id }),
    })),
  );
  return { geaendert: weg.length + dazu.length };
}

// Vorschlag ------------------------------------------------------------------------

// Wer an welchem Tag in welchem Abschnitt anwesend (A) oder abwesend (F) ist, für mehrere Tage in einer Abfrage. Dasselbe wie anwesenheitFuerTag (lager/anwesenheit.ts, #390), nur ohne eine Abfrage je Tag; offene Felder (O) und fehlende Zeilen kommen nicht zurück
export function anwesenheitFuerTage(
  db: Pick<Db, "select">,
  lagerId: string,
  lagertagIds?: string[],
) {
  return db
    .select({
      personId: anwesenheit.personId,
      teilnehmerId: anwesenheit.teilnehmerId,
      lagertagId: anwesenheit.lagertagId,
      tagesabschnittId: anwesenheit.tagesabschnittId,
      wert: anwesenheit.wert,
    })
    .from(anwesenheit)
    .where(
      and(
        eq(anwesenheit.lagerId, lagerId),
        isNull(anwesenheit.geloeschtAm),
        sql`${anwesenheit.wert} <> 'O'`,
        lagertagIds ? inArray(anwesenheit.lagertagId, lagertagIds) : undefined,
      ),
    );
}

export type VorschlagOptionen = {
  seed: number;
  lagertagIds?: string[];
  nurAnwesende: boolean;
  mitTeilnehmenden: boolean;
};

// Der Vorschlag für die leeren Plätze der Dienste: Der Stand kommt aus vier bis fünf Abfragen gleichzeitig (Plan, Mitglieder, Teilnehmende, Lagertage, Anwesenheit), die Verteilung ist eine reine Funktion (schichtvorschlag.ts). Lässt sich mit einer Transaktion unter der Lagersperre wiederholen, damit das Übernehmen den Stand sieht, der gleich geschrieben wird. «neu» sind die Zeilen für das Einfügen
export async function planeVorschlag(
  q: Pick<Db, "select" | "execute">,
  lagerId: string,
  abteilungId: string,
  p: VorschlagOptionen,
) {
  const [plan, mitglieder, kinder, tage, anw] = await Promise.all([
    ladeSchichtplan(q, lagerId),
    aktiveMitglieder(q, lagerId, abteilungId),
    p.mitTeilnehmenden
      ? q
          .select({
            id: teilnehmer.id,
            vorname: teilnehmer.vorname,
            nachname: teilnehmer.nachname,
          })
          .from(teilnehmer)
          .where(
            and(
              eq(teilnehmer.lagerId, lagerId),
              isNull(teilnehmer.geloeschtAm),
              eq(teilnehmer.abgewaehlt, false),
            ),
          )
      : [],
    q
      .select({ id: lagertag.id, datum: lagertag.datum })
      .from(lagertag)
      .where(and(eq(lagertag.lagerId, lagerId), isNull(lagertag.geloeschtAm)))
      .orderBy(asc(lagertag.datum), asc(lagertag.id)),
    anwesenheitFuerTage(q, lagerId, p.lagertagIds),
  ]);
  const tagIds = new Set(tage.map((t) => t.id));
  if (p.lagertagIds?.some((id) => !tagIds.has(id))) {
    throw new HTTPException(404);
  }

  const wer = new Map<
    string,
    { name: string; personId?: string; teilnehmerId?: string }
  >();
  for (const m of mitglieder) {
    wer.set(`p:${m.id}`, { name: m.name, personId: m.id });
  }
  for (const c of kinder) {
    wer.set(`t:${c.id}`, {
      name: `${c.vorname} ${c.nachname}`,
      teilnehmerId: c.id,
    });
  }
  const schluessel = (s: {
    personId: string | null;
    teilnehmerId: string | null;
  }) => (s.personId ? `p:${s.personId}` : `t:${s.teilnehmerId}`);
  const felder = new Map<string, string>();
  for (const a of anw) {
    felder.set(
      `${schluessel(a)}|${a.lagertagId}|${a.tagesabschnittId}`,
      a.wert,
    );
  }
  const ergebnis = schlageVor({
    tage: tage.map((t) => t.id),
    planTage: p.lagertagIds
      ? tage.map((t) => t.id).filter((id) => p.lagertagIds!.includes(id))
      : tage.map((t) => t.id),
    dienste: plan.dienste,
    kandidaten: [...wer.keys()],
    vorhanden: plan.schichten.map((s) => ({
      lagertagId: s.lagertagId,
      dienstId: s.dienstId,
      schluessel: schluessel(s),
    })),
    verfuegbar: (k, tag, abschnitt) => {
      const wert = felder.get(`${k}|${tag}|${abschnitt}`);
      return p.nurAnwesende ? wert === "A" : wert !== "F";
    },
    seed: p.seed,
  });

  const dienstVon = new Map(plan.dienste.map((d) => [d.id, d]));
  const datumVon = new Map(tage.map((t) => [t.id, t.datum]));
  const zeilen = ergebnis.neu.map((n) => {
    const w = wer.get(n.schluessel)!;
    return {
      lagertagId: n.lagertagId,
      dienstId: n.dienstId,
      tagesabschnittId: dienstVon.get(n.dienstId)!.tagesabschnittId,
      personId: w.personId ?? null,
      teilnehmerId: w.teilnehmerId ?? null,
    };
  });
  return {
    antwort: {
      seed: p.seed,
      gekuerzt: ergebnis.gekuerzt,
      schichten: ergebnis.neu.map((n, i) => ({
        ...zeilen[i]!,
        datum: datumVon.get(n.lagertagId)!,
        name: wer.get(n.schluessel)!.name,
      })),
      unbesetzt: ergebnis.unbesetzt,
      // Nur wer nach dem Vorschlag mindestens eine Schicht hat: wer nirgends anwesend ist, würde die Liste nur füllen
      statistik: [...ergebnis.statistik]
        .filter(([, s]) => s.vorher + s.neu > 0)
        .map(([k, s]) => {
          const w = wer.get(k)!;
          return {
            personId: w.personId ?? null,
            teilnehmerId: w.teilnehmerId ?? null,
            name: w.name,
            vorher: s.vorher,
            neu: s.neu,
            gesamt: s.vorher + s.neu,
            nachtwachen: s.nachtwachen,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "de")),
    },
    zeilen,
  };
}

// Schreibt den Vorschlag in einem Insert (eine Folgenummer-Reservierung, ein Feed-Insert)
export const uebernehmeVorschlag = (
  tx: Tx,
  k: Akteur,
  zeilen: Awaited<ReturnType<typeof planeVorschlag>>["zeilen"],
) => legeZeilenAn(tx, schicht, k, zeilen);
