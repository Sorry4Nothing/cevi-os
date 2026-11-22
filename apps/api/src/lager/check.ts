import { and, asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { adressbuchKontakt, lagerCheckPunkt } from "../db/schema.js";
import { ERINNERUNG_TAGE, aufraeumenAb } from "./adressbuch.js";
import { addiereTage, datumInZuerich } from "./aggregate.js";
import { leseUmfang } from "./aufgaben.js";
import { pruefeNotfall, pruefePackliste } from "./lagerinfos.js";
import { darf, type LagerZugriff } from "./policy.js";
import { sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile, type Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Lager-Check «Sind wir bereit?» (#377): Der Server rechnet bei jeder Anfrage aus den Daten der Module, ob das Lager bereit ist. Nichts davon wird gespeichert (nur die eigenen Check-Punkte sind Daten). Lesen braucht check.lesen (Standard: Lagerleitung, Leitung, Lesen; das Team nur, wenn die Lagerleitung es einstellt); die eigenen Punkte ändert, wer zeitplan.bearbeiten hat.
// Ein Prüfer ist eine Funktion, die aus einer Quelle Hinweise rechnet. Das Register kennt ihn mit dem Leserecht seiner Quelle: Wer die Quelle nicht lesen darf, sieht den Prüfer nicht, und der Gesamtstand rechnet ihn nicht mit (das Ergebnis verrät nichts, was die Rolle nicht lesen darf). Weitere Quellen tragen sich mit registrierePruefer ein.
// Datenbanklast: Die sichtbaren Prüfer laufen mit Promise.all; je Prüfer ist die Zahl der Abfragen fest und nie von der Zahl der Zeilen abhängig (Aufgaben 1, Meilensteine 1, Packliste 1, Notfall 2, Adressbuch 0 oder 1, eigene Punkte 1). Die Zeit kommt von aussen, damit Tests deterministisch sind.

// Anmeldung beim ersten Import dieser Datei: Der Feed nennt die eigenen Punkte nur mit dem Leserecht des Checks
registriereLagerTabelle({ tabelle: lagerCheckPunkt, recht: "check.lesen" });

export const MAX_PUNKTE = 100;
// Wie viele Beispiele ein Hinweis höchstens nennt; die Zahl steht immer vollständig in «anzahl»
export const MAX_BEISPIELE = 5;
// Wie viele Tage im Voraus ein Meilenstein «nah» ist
export const NAH_TAGE = 7;

// offen: Das Lager ist nicht bereit, solange der Hinweis steht. hinweis: gut zu wissen, ändert den Stand nicht auf «offen»
export type Schwere = "offen" | "hinweis";
export type Beispiel = {
  id: string;
  titel: string;
  // Frist der Aufgabe beziehungsweise Datum des Meilensteins («JJJJ-MM-TT»)
  datum: string | null;
  offeneAufgaben?: number;
};
export type Hinweis = {
  code: string;
  schwere: Schwere;
  text: string;
  anzahl?: number;
  beispiele?: Beispiel[];
};
export type Stand = "bereit" | "hinweise" | "offen";

export type Pruefer = {
  id: string;
  titel: string;
  // Darf die Rolle die Quelle dieses Prüfers lesen?
  sichtbar: (zugriff: LagerZugriff) => boolean;
  pruefe: (ctx: {
    db: Db;
    zugriff: LagerZugriff;
    jetzt: Date;
  }) => Promise<Hinweis[]>;
};

const register: Pruefer[] = [];
export function registrierePruefer(p: Pruefer) {
  if (register.some((r) => r.id === p.id)) {
    throw new Error(`Prüfer ${p.id} ist schon angemeldet`);
  }
  register.push(p);
}
export const listePruefer = () => [...register];

const zahl = (n: number, einzahl: string, mehrzahl: string) =>
  `${n} ${n === 1 ? einzahl : mehrzahl}`;
const schweizer = (d: string) => d.split("-").reverse().join(".");

// Aufgaben ------------------------------------------------------------------------

type AufgabeZeile = {
  art: "ueber" | "ohne";
  id: string;
  titel: string;
  frist: string | null;
  n: number;
};

// Überfällig: offen und die Frist liegt vor heute (Zürcher Datum). Ohne Verantwortliche: offen, ohne gesetzte Person und ohne Leitung im Ressort (wie die Liste die Verantwortliche rechnet). Eine Abfrage für beide Hinweise mit je höchstens fünf Beispielen; die Gesamtzahl kommt aus dem Fenster vor dem Limit
async function pruefeAufgaben({
  db,
  zugriff,
  jetzt,
}: {
  db: Db;
  zugriff: LagerZugriff;
  jetzt: Date;
}): Promise<Hinweis[]> {
  const heute = datumInZuerich(jetzt);
  const zeilen = await db.execute<AufgabeZeile>(sql`
    with offen as (
      select a.id, a.titel, a.frist,
        coalesce(a.verantwortlich_person_id, r.leitung_person_id) as wer
      from aufgabe a
      left join ressort r on r.lager_id = a.lager_id and r.id = a.ressort_id
      where a.lager_id = ${zugriff.lager.id} and a.status <> 'erledigt'
    ),
    ueber as (
      select 'ueber' as art, id, titel, frist::text as frist, (count(*) over ())::int as n
      from offen where frist < ${heute}::date
      order by frist, id limit ${MAX_BEISPIELE}
    ),
    ohne as (
      select 'ohne' as art, id, titel, frist::text as frist, (count(*) over ())::int as n
      from offen where wer is null
      order by frist nulls last, id limit ${MAX_BEISPIELE}
    )
    select * from ueber union all select * from ohne`);
  const hinweise: Hinweis[] = [];
  const je = (art: AufgabeZeile["art"]) => zeilen.filter((z) => z.art === art);
  const ueber = je("ueber");
  if (ueber.length > 0) {
    const n = ueber[0]!.n;
    hinweise.push({
      code: "AUFGABEN_UEBERFAELLIG",
      schwere: "offen",
      text: `${zahl(n, "Aufgabe ist", "Aufgaben sind")} überfällig.`,
      anzahl: n,
      beispiele: ueber.map((z) => ({
        id: z.id,
        titel: z.titel,
        datum: z.frist,
      })),
    });
  }
  const ohne = je("ohne");
  if (ohne.length > 0) {
    const n = ohne[0]!.n;
    hinweise.push({
      code: "AUFGABEN_OHNE_VERANTWORTLICHE",
      schwere: "offen",
      text: `${zahl(n, "offene Aufgabe hat", "offene Aufgaben haben")} keine Verantwortliche.`,
      anzahl: n,
      beispiele: ohne.map((z) => ({
        id: z.id,
        titel: z.titel,
        datum: z.frist,
      })),
    });
  }
  return hinweise;
}

// Meilensteine --------------------------------------------------------------------

type MeilensteinZeile = {
  id: string;
  titel: string;
  datum: string;
  offen: number;
};

// Nah: das Datum liegt in den nächsten sieben Tagen (nur ein Hinweis). Überfällig: das Datum ist vorbei und es hängen noch offene Aufgaben an ihm (Aufgaben mit einer Frist relativ zum Meilenstein); die Zahl der Aufgaben sieht nur, wer alle Aufgaben lesen darf, sonst gibt es diesen Hinweis nicht. Eine Abfrage mit Gruppierung; die Meilensteine sind je Lager auf 200 begrenzt (zeitplan.ts)
async function pruefeMeilensteine({
  db,
  zugriff,
  jetzt,
}: {
  db: Db;
  zugriff: LagerZugriff;
  jetzt: Date;
}): Promise<Hinweis[]> {
  const heute = datumInZuerich(jetzt);
  const bis = addiereTage(heute, NAH_TAGE);
  const mitAufgaben = leseUmfang(zugriff) === "alle";
  const zeilen = await db.execute<MeilensteinZeile>(sql`
    select m.id, m.titel, m.datum::text as datum, count(a.id)::int as offen
    from meilenstein m
    left join aufgabe a
      on a.lager_id = m.lager_id and a.frist_meilenstein_id = m.id and a.status <> 'erledigt'
    where m.lager_id = ${zugriff.lager.id} and m.datum <= ${bis}::date
    group by m.id
    having m.datum >= ${heute}::date or count(a.id) > 0
    order by m.datum, m.id`);
  const hinweise: Hinweis[] = [];
  const beispiel = (z: MeilensteinZeile): Beispiel => ({
    id: z.id,
    titel: z.titel,
    datum: z.datum,
    ...(mitAufgaben ? { offeneAufgaben: z.offen } : {}),
  });
  const nah = zeilen.filter((z) => z.datum >= heute);
  if (nah.length > 0) {
    hinweise.push({
      code: "MEILENSTEINE_NAH",
      schwere: "hinweis",
      text: `${zahl(nah.length, "Meilenstein steht", "Meilensteine stehen")} in den nächsten ${NAH_TAGE} Tagen an.`,
      anzahl: nah.length,
      beispiele: nah.slice(0, MAX_BEISPIELE).map(beispiel),
    });
  }
  const vorbei = mitAufgaben
    ? zeilen.filter((z) => z.datum < heute && z.offen > 0)
    : [];
  if (vorbei.length > 0) {
    hinweise.push({
      code: "MEILENSTEINE_UEBERFAELLIG",
      schwere: "offen",
      text: `${zahl(vorbei.length, "Meilenstein ist", "Meilensteine sind")} vorbei, aber es hängen noch offene Aufgaben daran.`,
      anzahl: vorbei.length,
      beispiele: vorbei.slice(0, MAX_BEISPIELE).map(beispiel),
    });
  }
  return hinweise;
}

// Packliste und Notfall (#393) -------------------------------------------------------

async function pruefePacklisteHinweise({
  db,
  zugriff,
}: {
  db: Db;
  zugriff: LagerZugriff;
}): Promise<Hinweis[]> {
  const { erfuellt } = await pruefePackliste(db, zugriff.lager.id);
  return erfuellt
    ? []
    : [
        {
          code: "PACKLISTE_LEER",
          schwere: "offen",
          text: "Die Packliste hat noch keinen Punkt.",
        },
      ];
}

async function pruefeNotfallHinweise({
  db,
  zugriff,
}: {
  db: Db;
  zugriff: LagerZugriff;
}): Promise<Hinweis[]> {
  const { erfuellt } = await pruefeNotfall(db, zugriff.lager.id);
  return erfuellt
    ? []
    : [
        {
          code: "NOTFALL_OHNE_KONTAKT",
          schwere: "offen",
          text: "Es gibt noch keinen Notfall-Kontakt mit Telefonnummer.",
        },
      ];
}

// Adressbuch (#397): Datenschutz ------------------------------------------------------

// Im Fenster der Erinnerung (14 Tage vor dem Tag, an dem der tägliche Lauf löscht) zählt eine Abfrage die Kontakte ohne «behalten»; davor und danach gibt es nichts zu melden und keine Abfrage. Der Tag ist wie im Lauf das UTC-Datum. Nur die Zahl, nie ein Kontakt (kein Eintrag im Audit-Log: es werden keine Personendaten gelesen)
async function pruefeAdressbuch({
  db,
  zugriff,
  jetzt,
}: {
  db: Db;
  zugriff: LagerZugriff;
  jetzt: Date;
}): Promise<Hinweis[]> {
  const heute = jetzt.toISOString().slice(0, 10);
  const loeschtAm = aufraeumenAb(zugriff.lager.bis);
  if (heute >= loeschtAm || heute < addiereTage(loeschtAm, -ERINNERUNG_TAGE)) {
    return [];
  }
  const [z] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adressbuchKontakt)
    .where(
      and(
        eq(adressbuchKontakt.lagerId, zugriff.lager.id),
        eq(adressbuchKontakt.behalten, false),
      ),
    );
  const n = z?.n ?? 0;
  if (n === 0) return [];
  return [
    {
      code: "ADRESSBUCH_AUFRAEUMEN",
      schwere: "hinweis",
      text: `${zahl(n, "Kontakt im Adressbuch wird", "Kontakte im Adressbuch werden")} am ${schweizer(loeschtAm)} gelöscht, wenn du ${n === 1 ? "ihn" : "sie"} nicht für das nächste Lager behältst.`,
      anzahl: n,
    },
  ];
}

// Eigene Check-Punkte --------------------------------------------------------------

const punktAnsicht = (p: typeof lagerCheckPunkt.$inferSelect) => ({
  id: p.id,
  version: p.version,
  titel: p.titel,
  erledigt: p.erledigt,
  reihenfolge: p.reihenfolge,
});

async function pruefeEigene({
  db,
  zugriff,
}: {
  db: Db;
  zugriff: LagerZugriff;
}): Promise<Hinweis[]> {
  const zeilen = await db
    .select({
      id: lagerCheckPunkt.id,
      titel: lagerCheckPunkt.titel,
      n: sql<number>`(count(*) over ())::int`,
    })
    .from(lagerCheckPunkt)
    .where(
      and(
        eq(lagerCheckPunkt.lagerId, zugriff.lager.id),
        eq(lagerCheckPunkt.erledigt, false),
      ),
    )
    .orderBy(asc(lagerCheckPunkt.reihenfolge), asc(lagerCheckPunkt.id))
    .limit(MAX_BEISPIELE);
  if (zeilen.length === 0) return [];
  const n = zeilen[0]!.n;
  return [
    {
      code: "EIGENE_OFFEN",
      schwere: "offen",
      text: `${zahl(n, "eigener Check-Punkt ist", "eigene Check-Punkte sind")} noch offen.`,
      anzahl: n,
      beispiele: zeilen.map((z) => ({ id: z.id, titel: z.titel, datum: null })),
    },
  ];
}

registrierePruefer({
  id: "aufgaben",
  titel: "Aufgaben",
  sichtbar: (z) => leseUmfang(z) === "alle",
  pruefe: pruefeAufgaben,
});
registrierePruefer({
  id: "meilensteine",
  titel: "Meilensteine",
  sichtbar: (z) => darf(z, "zeitplan.lesen"),
  pruefe: pruefeMeilensteine,
});
registrierePruefer({
  id: "packliste",
  titel: "Packliste",
  sichtbar: (z) => darf(z, "packliste.lesen"),
  pruefe: pruefePacklisteHinweise,
});
registrierePruefer({
  id: "notfall",
  titel: "Notfall-Kontakte",
  sichtbar: (z) => darf(z, "notfall.lesen"),
  pruefe: pruefeNotfallHinweise,
});
registrierePruefer({
  id: "adressbuch",
  titel: "Datenschutz im Adressbuch",
  sichtbar: (z) => darf(z, "adressbuch.lesen"),
  pruefe: pruefeAdressbuch,
});
registrierePruefer({
  id: "eigene",
  titel: "Eigene Check-Punkte",
  // Wer den Check liest, liest auch die eigenen Punkte
  sichtbar: (z) => darf(z, "check.lesen"),
  pruefe: pruefeEigene,
});

// Ergebnis ---------------------------------------------------------------------------

const rang = { bereit: 0, hinweise: 1, offen: 2 } as const;
const schlimmster = (stande: Stand[]): Stand =>
  stande.reduce<Stand>((a, b) => (rang[b] > rang[a] ? b : a), "bereit");

export type PrueferErgebnis = {
  id: string;
  titel: string;
  stand: Stand;
  hinweise: Hinweis[];
};

// Alle Prüfer, die die Rolle sehen darf, gebündelt. Der Stand eines Prüfers ist der schlimmste seiner Hinweise, der Gesamtstand der schlimmste aller sichtbaren Prüfer
export async function ladeCheck(db: Db, zugriff: LagerZugriff, jetzt: Date) {
  const sichtbar = register.filter((p) => p.sichtbar(zugriff));
  const ergebnisse = await Promise.all(
    sichtbar.map(async (p): Promise<PrueferErgebnis> => {
      const hinweise = await p.pruefe({ db, zugriff, jetzt });
      return {
        id: p.id,
        titel: p.titel,
        stand: schlimmster(
          hinweise.map((h) => (h.schwere === "offen" ? "offen" : "hinweise")),
        ),
        hinweise,
      };
    }),
  );
  return {
    stand: schlimmster(ergebnisse.map((e) => e.stand)),
    datum: datumInZuerich(jetzt),
    pruefer: ergebnisse,
  };
}

// Eigene Punkte: Eingaben und Schreibwege ----------------------------------------

const version = z.number().int().min(1);
const titel = z.string().trim().min(1).max(200);
const reihenfolge = z.number().int().min(0).max(1000);

export const punktAnlegen = z.strictObject({
  titel,
  reihenfolge: reihenfolge.optional(),
});
export const punktAendern = z
  .strictObject({
    version,
    titel: titel.optional(),
    erledigt: z.boolean().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => Object.keys(b).length > 1);

// Die Liste der eigenen Punkte, höchstens MAX_PUNKTE (je Lager begrenzt, keine Seiten): eine Abfrage
export async function ladePunkte(db: Pick<Db, "select">, lagerId: string) {
  const zeilen = await db
    .select()
    .from(lagerCheckPunkt)
    .where(eq(lagerCheckPunkt.lagerId, lagerId))
    .orderBy(asc(lagerCheckPunkt.reihenfolge), asc(lagerCheckPunkt.id))
    .limit(MAX_PUNKTE);
  return zeilen.map(punktAnsicht);
}

type Akteur = { lagerId: string; personId: string };

// Unter der Lagersperre: Das Limit gilt auch bei gleichzeitigem Anlegen. Ohne Reihenfolge kommt der Punkt ans Ende
export async function legePunktAn(
  tx: Tx,
  k: Akteur,
  e: z.output<typeof punktAnlegen>,
) {
  await sperreLager(tx, k.lagerId);
  const [z] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      ende: sql<number>`coalesce(max(${lagerCheckPunkt.reihenfolge}) + 1, 0)::int`,
    })
    .from(lagerCheckPunkt)
    .where(eq(lagerCheckPunkt.lagerId, k.lagerId));
  if ((z?.n ?? 0) >= MAX_PUNKTE) return { fehler: "LIMIT_ERREICHT" as const };
  const zeile = await legeZeileAn(tx, lagerCheckPunkt, k, {
    titel: e.titel,
    reihenfolge: e.reihenfolge ?? Math.min(z?.ende ?? 0, 1000),
  });
  return { punkt: punktAnsicht(zeile) };
}

async function punktDa(tx: Pick<Db, "select">, lagerId: string, id: string) {
  const [zeile] = await tx
    .select({ id: lagerCheckPunkt.id })
    .from(lagerCheckPunkt)
    .where(
      and(eq(lagerCheckPunkt.id, id), eq(lagerCheckPunkt.lagerId, lagerId)),
    );
  if (!zeile) throw new HTTPException(404);
}

export async function aenderePunkt(
  tx: Tx,
  k: Akteur,
  id: string,
  { version: v, ...werte }: z.output<typeof punktAendern>,
) {
  await sperreLager(tx, k.lagerId);
  await punktDa(tx, k.lagerId, id);
  return punktAnsicht(
    await aendereZeile(tx, lagerCheckPunkt, k, {
      id,
      version: v,
      werte,
      ansicht: punktAnsicht,
    }),
  );
}

export async function loeschePunkt(tx: Tx, k: Akteur, id: string, v: number) {
  await sperreLager(tx, k.lagerId);
  await punktDa(tx, k.lagerId, id);
  await loescheZeile(tx, lagerCheckPunkt, k, {
    id,
    version: v,
    ansicht: punktAnsicht,
  });
}
