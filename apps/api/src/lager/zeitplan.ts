import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  aufgabe,
  lagertag,
  meilenstein,
  tagesabschnitt,
} from "../db/schema.js";
import { sperreLager } from "./ressorts.js";
import {
  aendereZeile,
  legeZeileAn,
  legeZeilenAn,
  loescheZeile,
  setzeZeilen,
  type Tx,
} from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Zeitplan des Lagers (#374): Meilensteine, Lagertage und Tagesabschnitte. Alle drei Tabellen schreiben über den Sync-Kern (Version, Feed) und sind für jeden lesbar, der zeitplan.lesen hat. Ändern darf nur, wer zeitplan.bearbeiten hat (Standard: Lagerleitung).
// Das Datum eines Meilensteins ändert nur die Verschiebung (lager/fristen.ts, mit Vorschau): Ein PATCH kann es nicht setzen, sonst bliebe die relative Frist der Aufgaben stehen. Tage, Abschnitte und Meilensteine sind je Lager in der Zahl begrenzt (kleine Listen, ein Abruf, keine Seiten).
registriereLagerTabelle({ tabelle: meilenstein, recht: "zeitplan.lesen" });
// Suche (#399): der Titel eines Meilensteins
registriereSuchquelle({
  typ: "meilenstein",
  recht: "zeitplan.lesen",
  tabelle: meilenstein,
  spalten: [meilenstein.titel],
  titel: sql`${meilenstein.titel}`,
});
registriereLagerTabelle({ tabelle: lagertag, recht: "zeitplan.lesen" });
registriereLagerTabelle({ tabelle: tagesabschnitt, recht: "zeitplan.lesen" });

export const MAX_MEILENSTEINE = 200;
export const MAX_LAGERTAGE = 100;
export const MAX_ABSCHNITTE = 12;

// Der Vorschlag für ein Lager ohne Abschnitte; die Lagerleitung bestätigt oder ändert ihn
export const STANDARD_ABSCHNITTE = [
  { name: "Vormittag", zeit: null, reihenfolge: 0 },
  { name: "Nachmittag", zeit: null, reihenfolge: 1 },
  { name: "Abend", zeit: null, reihenfolge: 2 },
  { name: "Nacht", zeit: null, reihenfolge: 3 },
] as const;

export const meilensteinAnsicht = (m: typeof meilenstein.$inferSelect) => ({
  id: m.id,
  version: m.version,
  titel: m.titel,
  datum: m.datum,
  art: m.art,
});
export const lagertagAnsicht = (t: typeof lagertag.$inferSelect) => ({
  id: t.id,
  version: t.version,
  datum: t.datum,
  label: t.label,
});
export const abschnittAnsicht = (a: typeof tagesabschnitt.$inferSelect) => ({
  id: a.id,
  version: a.version,
  name: a.name,
  zeit: a.zeit,
  reihenfolge: a.reihenfolge,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Ein Datum liegt zwischen 2000 und 2100, damit die Rechnung mit Tagen nie überläuft
export const datum = z.iso
  .date()
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31");
const version = z.number().int().min(1);
const titel = z.string().trim().min(1).max(200);
const art = z.string().trim().min(1).max(50).nullable();
const label = z.string().trim().min(1).max(100).nullable();
const name = z.string().trim().min(1).max(50);
const zeit = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
  .nullable();
const reihenfolge = z.number().int().min(0).max(1000);

export const meilensteinAnlegen = z.strictObject({
  titel,
  datum,
  art: art.optional(),
});
export const meilensteinAendern = z
  .strictObject({ version, titel: titel.optional(), art: art.optional() })
  .refine((b) => Object.keys(b).length > 1);
export const lagertagAnlegen = z.strictObject({
  datum,
  label: label.optional(),
});
export const lagertagAendern = z
  .strictObject({ version, datum: datum.optional(), label: label.optional() })
  .refine((b) => Object.keys(b).length > 1);
export const abschnittAnlegen = z.strictObject({
  name,
  zeit: zeit.optional(),
  reihenfolge: reihenfolge.optional(),
});
export const abschnittAendern = z
  .strictObject({
    version,
    name: name.optional(),
    zeit: zeit.optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const uebernehmenSchema = z
  .strictObject({
    lagertage: z
      .array(z.strictObject({ datum, label: label.optional() }))
      .max(MAX_LAGERTAGE)
      .refine((l) => new Set(l.map((t) => t.datum)).size === l.length)
      .optional(),
    tagesabschnitte: z
      .array(
        z.strictObject({
          name,
          zeit: zeit.optional(),
          reihenfolge: reihenfolge.optional(),
        }),
      )
      .max(MAX_ABSCHNITTE)
      .refine(
        (l) => new Set(l.map((a) => a.name.toLowerCase())).size === l.length,
      )
      .optional(),
  })
  .refine((b) => Boolean(b.lagertage?.length || b.tagesabschnitte?.length));

type Leser = Pick<Db, "execute">;

// Der ganze Zeitplan in einer Abfrage: drei kleine, begrenzte Listen als JSON aus einer Anweisung. Die Daten kommen als Text («2027-07-10»), die Reihenfolge ist Datum und ID beziehungsweise Reihenfolge und ID
export async function ladeZeitplan(db: Leser, lagerId: string) {
  const zeilen = await db.execute<{
    meilensteine: ReturnType<typeof meilensteinAnsicht>[];
    lagertage: ReturnType<typeof lagertagAnsicht>[];
    tagesabschnitte: ReturnType<typeof abschnittAnsicht>[];
  }>(sql`
    select
      coalesce((select json_agg(json_build_object('id', m.id, 'version', m.version, 'titel', m.titel, 'datum', m.datum::text, 'art', m.art) order by m.datum, m.id)
        from meilenstein m where m.lager_id = ${lagerId} and m.geloescht_am is null), '[]'::json) as meilensteine,
      coalesce((select json_agg(json_build_object('id', t.id, 'version', t.version, 'datum', t.datum::text, 'label', t.label) order by t.datum, t.id)
        from lagertag t where t.lager_id = ${lagerId} and t.geloescht_am is null), '[]'::json) as lagertage,
      coalesce((select json_agg(json_build_object('id', a.id, 'version', a.version, 'name', a.name, 'zeit', a.zeit, 'reihenfolge', a.reihenfolge) order by a.reihenfolge, a.id)
        from tagesabschnitt a where a.lager_id = ${lagerId} and a.geloescht_am is null), '[]'::json) as tagesabschnitte`);
  return zeilen[0]!;
}

type Akteur = { lagerId: string; personId: string };
type Leseschreiber = Pick<Db, "select">;

export type ZeitplanFehler =
  | "LIMIT_ERREICHT"
  | "TAG_VORHANDEN"
  | "ABSCHNITT_VORHANDEN"
  | "AUSSERHALB_LAGER";
type Fehler = { fehler: ZeitplanFehler };

const zaehle = async (
  tx: Leseschreiber,
  t: typeof meilenstein | typeof lagertag | typeof tagesabschnitt,
  lagerId: string,
) => {
  const [z] = await tx
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.lagerId, lagerId), isNull(t.geloeschtAm)));
  return z!.n;
};

// Liegt das Datum im Lager (von bis bis)? Die Tage des Lagers sind die Tage zwischen Beginn und Ende
export const imLager = (l: { von: string; bis: string }, d: string) =>
  d >= l.von && d <= l.bis;

async function ladeZeile<
  T extends typeof meilenstein | typeof lagertag | typeof tagesabschnitt,
>(tx: Leseschreiber, t: T, lagerId: string, id: string) {
  const [zeile] = await tx
    .select()
    .from(t as typeof meilenstein)
    .where(and(eq(t.id, id), eq(t.lagerId, lagerId), isNull(t.geloeschtAm)));
  if (!zeile) throw new HTTPException(404);
  return zeile as T["$inferSelect"];
}
export const ladeMeilenstein = (
  tx: Leseschreiber,
  lagerId: string,
  id: string,
) => ladeZeile(tx, meilenstein, lagerId, id);

// Meilensteine ----------------------------------------------------------------

export async function legeMeilensteinAn(
  tx: Tx,
  k: Akteur,
  e: z.output<typeof meilensteinAnlegen>,
): Promise<Fehler | { meilenstein: ReturnType<typeof meilensteinAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  if ((await zaehle(tx, meilenstein, k.lagerId)) >= MAX_MEILENSTEINE) {
    return { fehler: "LIMIT_ERREICHT" };
  }
  return {
    meilenstein: meilensteinAnsicht(await legeZeileAn(tx, meilenstein, k, e)),
  };
}

export async function aendereMeilenstein(
  tx: Tx,
  k: Akteur,
  id: string,
  { version: v, ...werte }: z.output<typeof meilensteinAendern>,
) {
  await sperreLager(tx, k.lagerId);
  await ladeZeile(tx, meilenstein, k.lagerId, id);
  return meilensteinAnsicht(
    await aendereZeile(tx, meilenstein, k, {
      id,
      version: v,
      werte,
      ansicht: meilensteinAnsicht,
    }),
  );
}

// Aufgaben, die an diesem Meilenstein hängen, behalten ihre Frist als festes Datum: Der Bezug fällt weg (eine Anweisung für alle, mit Feed-Eintrag je Aufgabe). Erst dann geht der Meilenstein; der Fremdschlüssel liesse ihn sonst nicht los
export async function loescheMeilenstein(
  tx: Tx,
  k: Akteur,
  id: string,
  v: number,
) {
  await sperreLager(tx, k.lagerId);
  await ladeZeile(tx, meilenstein, k.lagerId, id);
  const haengen = await tx
    .select({ id: aufgabe.id })
    .from(aufgabe)
    .where(
      and(
        eq(aufgabe.lagerId, k.lagerId),
        eq(aufgabe.fristMeilensteinId, id),
        isNull(aufgabe.geloeschtAm),
      ),
    );
  await setzeZeilen(tx, aufgabe, k, {
    ids: haengen.map((a) => a.id),
    werte: { fristMeilensteinId: null, fristVersatzTage: null },
  });
  await loescheZeile(tx, meilenstein, k, {
    id,
    version: v,
    ansicht: meilensteinAnsicht,
  });
}

// Lagertage ---------------------------------------------------------------------

async function tagVorhanden(
  tx: Leseschreiber,
  lagerId: string,
  d: string,
  ausser?: string,
) {
  const [z] = await tx
    .select({ id: lagertag.id })
    .from(lagertag)
    .where(
      and(
        eq(lagertag.lagerId, lagerId),
        eq(lagertag.datum, d),
        isNull(lagertag.geloeschtAm),
      ),
    );
  return z !== undefined && z.id !== ausser;
}

export async function legeLagertagAn(
  tx: Tx,
  k: Akteur,
  lager: { von: string; bis: string },
  e: z.output<typeof lagertagAnlegen>,
): Promise<Fehler | { lagertag: ReturnType<typeof lagertagAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  if (!imLager(lager, e.datum)) return { fehler: "AUSSERHALB_LAGER" };
  if (await tagVorhanden(tx, k.lagerId, e.datum)) {
    return { fehler: "TAG_VORHANDEN" };
  }
  if ((await zaehle(tx, lagertag, k.lagerId)) >= MAX_LAGERTAGE) {
    return { fehler: "LIMIT_ERREICHT" };
  }
  return { lagertag: lagertagAnsicht(await legeZeileAn(tx, lagertag, k, e)) };
}

export async function aendereLagertag(
  tx: Tx,
  k: Akteur,
  lager: { von: string; bis: string },
  id: string,
  { version: v, ...werte }: z.output<typeof lagertagAendern>,
): Promise<Fehler | { lagertag: ReturnType<typeof lagertagAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  await ladeZeile(tx, lagertag, k.lagerId, id);
  if (werte.datum !== undefined) {
    if (!imLager(lager, werte.datum)) return { fehler: "AUSSERHALB_LAGER" };
    if (await tagVorhanden(tx, k.lagerId, werte.datum, id)) {
      return { fehler: "TAG_VORHANDEN" };
    }
  }
  return {
    lagertag: lagertagAnsicht(
      await aendereZeile(tx, lagertag, k, {
        id,
        version: v,
        werte,
        ansicht: lagertagAnsicht,
      }),
    ),
  };
}

export async function loescheLagertag(
  tx: Tx,
  k: Akteur,
  id: string,
  v: number,
) {
  await sperreLager(tx, k.lagerId);
  await ladeZeile(tx, lagertag, k.lagerId, id);
  await loescheZeile(tx, lagertag, k, {
    id,
    version: v,
    ansicht: lagertagAnsicht,
  });
}

// Tagesabschnitte -----------------------------------------------------------------

async function abschnittVorhanden(
  tx: Leseschreiber,
  lagerId: string,
  n: string,
  ausser?: string,
) {
  const [z] = await tx
    .select({ id: tagesabschnitt.id })
    .from(tagesabschnitt)
    .where(
      and(
        eq(tagesabschnitt.lagerId, lagerId),
        sql`lower(${tagesabschnitt.name}) = lower(${n})`,
        isNull(tagesabschnitt.geloeschtAm),
      ),
    );
  return z !== undefined && z.id !== ausser;
}

export async function legeAbschnittAn(
  tx: Tx,
  k: Akteur,
  e: z.output<typeof abschnittAnlegen>,
): Promise<Fehler | { abschnitt: ReturnType<typeof abschnittAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  if (await abschnittVorhanden(tx, k.lagerId, e.name)) {
    return { fehler: "ABSCHNITT_VORHANDEN" };
  }
  const n = await zaehle(tx, tagesabschnitt, k.lagerId);
  if (n >= MAX_ABSCHNITTE) return { fehler: "LIMIT_ERREICHT" };
  return {
    abschnitt: abschnittAnsicht(
      // Ohne Angabe ans Ende
      await legeZeileAn(tx, tagesabschnitt, k, {
        ...e,
        reihenfolge: e.reihenfolge ?? n,
      }),
    ),
  };
}

export async function aendereAbschnitt(
  tx: Tx,
  k: Akteur,
  id: string,
  { version: v, ...werte }: z.output<typeof abschnittAendern>,
): Promise<Fehler | { abschnitt: ReturnType<typeof abschnittAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  await ladeZeile(tx, tagesabschnitt, k.lagerId, id);
  if (
    werte.name !== undefined &&
    (await abschnittVorhanden(tx, k.lagerId, werte.name, id))
  ) {
    return { fehler: "ABSCHNITT_VORHANDEN" };
  }
  return {
    abschnitt: abschnittAnsicht(
      await aendereZeile(tx, tagesabschnitt, k, {
        id,
        version: v,
        werte,
        ansicht: abschnittAnsicht,
      }),
    ),
  };
}

export async function loescheAbschnitt(
  tx: Tx,
  k: Akteur,
  id: string,
  v: number,
) {
  await sperreLager(tx, k.lagerId);
  await ladeZeile(tx, tagesabschnitt, k.lagerId, id);
  await loescheZeile(tx, tagesabschnitt, k, {
    id,
    version: v,
    ansicht: abschnittAnsicht,
  });
}

// Vorschlag und Übernahme --------------------------------------------------------------

// Alle Tage von bis bis als «JJJJ-MM-TT». Rechnet mit UTC-Mitternacht und ganzen Tagen: Eine Sommerzeitumstellung verschiebt kein Datum
export function tageZwischen(von: string, bis: string) {
  const tage: string[] = [];
  const ende = Date.parse(`${bis}T00:00:00Z`);
  for (let t = Date.parse(`${von}T00:00:00Z`); t <= ende; t += 86_400_000) {
    tage.push(new Date(t).toISOString().slice(0, 10));
  }
  return tage;
}

// Was das Lager noch braucht: die Tage von Beginn bis Ende, die es noch nicht gibt, und die Standard-Abschnitte, wenn es keine gibt. Ändert nichts; die Lagerleitung bestätigt mit POST .../uebernehmen
export async function ladeVorschlag(
  tx: Leseschreiber,
  lager: { id: string; von: string; bis: string },
) {
  const tage = await tx
    .select({ datum: lagertag.datum })
    .from(lagertag)
    .where(and(eq(lagertag.lagerId, lager.id), isNull(lagertag.geloeschtAm)));
  const da = new Set(tage.map((t) => t.datum));
  const [abschnitte] = await tx
    .select({ n: count() })
    .from(tagesabschnitt)
    .where(
      and(
        eq(tagesabschnitt.lagerId, lager.id),
        isNull(tagesabschnitt.geloeschtAm),
      ),
    );
  return {
    lagertage: tageZwischen(lager.von, lager.bis)
      .filter((d) => !da.has(d))
      .map((d) => ({ datum: d, label: null })),
    tagesabschnitte: abschnitte!.n === 0 ? [...STANDARD_ABSCHNITTE] : [],
  };
}

// Legt die bestätigten Tage und Abschnitte an (je ein Insert). Was es schon gibt, wird übersprungen; Tage ausserhalb des Lagers sind ein Fehler, und die Grenzen je Lager gelten wie bei den einzelnen Routen
export async function uebernehme(
  tx: Tx,
  k: Akteur,
  lager: { von: string; bis: string },
  e: z.output<typeof uebernehmenSchema>,
): Promise<
  | Fehler
  | {
      lagertage: ReturnType<typeof lagertagAnsicht>[];
      tagesabschnitte: ReturnType<typeof abschnittAnsicht>[];
    }
> {
  await sperreLager(tx, k.lagerId);
  if (e.lagertage?.some((t) => !imLager(lager, t.datum))) {
    return { fehler: "AUSSERHALB_LAGER" };
  }
  const vorhandeneTage = new Set(
    (
      await tx
        .select({ datum: lagertag.datum })
        .from(lagertag)
        .where(
          and(eq(lagertag.lagerId, k.lagerId), isNull(lagertag.geloeschtAm)),
        )
    ).map((t) => t.datum),
  );
  const neueTage = (e.lagertage ?? []).filter(
    (t) => !vorhandeneTage.has(t.datum),
  );
  const vorhandeneAbschnitte = await tx
    .select({ name: tagesabschnitt.name })
    .from(tagesabschnitt)
    .where(
      and(
        eq(tagesabschnitt.lagerId, k.lagerId),
        isNull(tagesabschnitt.geloeschtAm),
      ),
    );
  const bekannt = new Set(
    vorhandeneAbschnitte.map((a) => a.name.toLowerCase()),
  );
  const neueAbschnitte = (e.tagesabschnitte ?? []).filter(
    (a) => !bekannt.has(a.name.toLowerCase()),
  );
  if (
    vorhandeneTage.size + neueTage.length > MAX_LAGERTAGE ||
    vorhandeneAbschnitte.length + neueAbschnitte.length > MAX_ABSCHNITTE
  ) {
    return { fehler: "LIMIT_ERREICHT" };
  }
  const tage = await legeZeilenAn(
    tx,
    lagertag,
    k,
    neueTage.map((t) => ({ datum: t.datum, label: t.label })),
  );
  const abschnitte = await legeZeilenAn(
    tx,
    tagesabschnitt,
    k,
    neueAbschnitte.map((a, i) => ({
      name: a.name,
      zeit: a.zeit,
      reihenfolge: a.reihenfolge ?? vorhandeneAbschnitte.length + i,
    })),
  );
  return {
    lagertage: tage.map(lagertagAnsicht),
    tagesabschnitte: abschnitte.map(abschnittAnsicht),
  };
}

// Sind alle diese Tage und Abschnitte Zeilen dieses Lagers (nicht gelöscht)? Für die Module, die auf sie zeigen (Anwesenheit; später Schichten und Tagesseiten): Zwei Abfragen, unabhängig von der Zahl der IDs
export async function pruefeTageUndAbschnitte(
  tx: Leseschreiber,
  lagerId: string,
  tageIds: string[],
  abschnittIds: string[],
) {
  const tage = [...new Set(tageIds)];
  const abschnitte = [...new Set(abschnittIds)];
  const [t] = tage.length
    ? await tx
        .select({ n: count() })
        .from(lagertag)
        .where(
          and(
            eq(lagertag.lagerId, lagerId),
            isNull(lagertag.geloeschtAm),
            inArray(lagertag.id, tage),
          ),
        )
    : [{ n: 0 }];
  const [a] = abschnitte.length
    ? await tx
        .select({ n: count() })
        .from(tagesabschnitt)
        .where(
          and(
            eq(tagesabschnitt.lagerId, lagerId),
            isNull(tagesabschnitt.geloeschtAm),
            inArray(tagesabschnitt.id, abschnitte),
          ),
        )
    : [{ n: 0 }];
  return t!.n === tage.length && a!.n === abschnitte.length;
}
