import { and, asc, count, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { bildUrlImLager } from "../bild.js";
import type { Db } from "../db/client.js";
import {
  lagertag,
  TAGESSEITE_BLOCK_ARTEN,
  tagesseite,
  tagesseiteBlock,
  user,
} from "../db/schema.js";
import { ladeAufgaben, leseUmfang } from "./aufgaben.js";
import { ladeDateien, pruefeDateiImLager } from "./datei.js";
import { registriereDateiVerweis } from "./datei-verweise.js";
import { istMitglied } from "./lagerinfos.js";
import { darf, type LagerZugriff } from "./policy.js";
import { sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile, type Tx } from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";
import { ladeWetter } from "./wetter.js";
import type { Wetterdienst } from "./wetter-openmeteo.js";

// Tagesseiten (#391): je Lagertag Tageschef, Notiz und Blöcke. Lesen braucht tagesseiten.lesen, Ändern tagesseiten.bearbeiten (Standard: Leitung und Lagerleitung). Die Seite entsteht beim ersten Schreiben. Die Antwort für einen Tag fasst zusammen, was der Tag zeigt: die Seite mit Blöcken, das Wetter des Tages (wetter.lesen, lager/wetter.ts) und die Aufgaben mit Frist an diesem Tag (die To-dos des Tages sind Aufgaben aus #372, keine eigene Tabelle). Alle Schreibwege gehen durch lager/sync.ts (Version, 409 VERSION_KONFLIKT, Feed); Löschen ist endgültig (#427)
registriereLagerTabelle({ tabelle: tagesseite, recht: "tagesseiten.lesen" });
registriereLagerTabelle({
  tabelle: tagesseiteBlock,
  recht: "tagesseiten.lesen",
});
// Suche (#399): Notiz und Blöcke einer Tagesseite finden den Lagertag (Typ «tagesseite», ID des Tages); wer die Tagesseiten lesen darf, findet alles (kein Zeilenfilter, wie in der Liste)
const tagTitel = sql`'Tag ' || to_char(${lagertag.datum}, 'DD.MM.YYYY')`;
const mitTag = (kind: typeof tagesseite | typeof tagesseiteBlock) =>
  kind === tagesseite
    ? sql`${tagesseite} join ${lagertag} on ${lagertag.lagerId} = ${tagesseite.lagerId} and ${lagertag.id} = ${tagesseite.lagertagId}`
    : sql`${tagesseiteBlock} join ${tagesseite} on ${tagesseite.lagerId} = ${tagesseiteBlock.lagerId} and ${tagesseite.id} = ${tagesseiteBlock.seiteId} join ${lagertag} on ${lagertag.lagerId} = ${tagesseite.lagerId} and ${lagertag.id} = ${tagesseite.lagertagId}`;
registriereSuchquelle({
  typ: "tagesseite",
  recht: "tagesseiten.lesen",
  tabelle: tagesseite,
  spalten: [tagesseite.notiz],
  titel: tagTitel,
  von: mitTag(tagesseite),
  id: sql`${lagertag.id}`,
});
registriereSuchquelle({
  typ: "tagesseite",
  recht: "tagesseiten.lesen",
  tabelle: tagesseiteBlock,
  spalten: [tagesseiteBlock.text],
  titel: tagTitel,
  von: mitTag(tagesseiteBlock),
  id: sql`${lagertag.id}`,
});
// Das Programmbild sieht, wer die Tagesseite lesen darf (lager/datei-verweise.ts)
registriereDateiVerweis({
  tabelle: tagesseiteBlock,
  spalte: tagesseiteBlock.dateiId,
  recht: "tagesseiten.lesen",
});

// Obergrenze je Seite: hält die Antwort eines Tages in einer Abfrage ohne Seitenwechsel
export const MAX_BLOECKE = 100;

type SeiteZeile = typeof tagesseite.$inferSelect;
type BlockZeile = typeof tagesseiteBlock.$inferSelect;

export const seiteAnsicht = (s: SeiteZeile) => ({
  id: s.id,
  version: s.version,
  lagertagId: s.lagertagId,
  tageschefPersonId: s.tageschefPersonId,
  notiz: s.notiz,
});
export const blockAnsicht = (b: BlockZeile) => ({
  id: b.id,
  version: b.version,
  seiteId: b.seiteId,
  art: b.art,
  text: b.text,
  dateiId: b.dateiId,
  reihenfolge: b.reihenfolge,
});

const version = z.number().int().min(1);
const personId = z.uuid().nullable();
const notiz = z.string().trim().max(5000).nullable();
const reihenfolge = z.number().int().min(0).max(100_000);
const mindestensEins = (b: object) => Object.keys(b).length > 1;

export const seiteAnlegen = z.strictObject({
  tageschefPersonId: personId.optional(),
  notiz: notiz.optional(),
});
export const seiteAendern = z
  .strictObject({
    version,
    tageschefPersonId: personId.optional(),
    notiz: notiz.optional(),
  })
  .refine(mindestensEins);
export const blockAnlegen = z
  .strictObject({
    art: z.enum(TAGESSEITE_BLOCK_ARTEN),
    text: z.string().trim().min(1).max(1000),
    // Nur beim Programmbild: Eintrag aus lager_datei (Verknüpfung auf den SharePoint)
    dateiId: z.uuid().optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine((b) => (b.art === "programmbild") === (b.dateiId !== undefined));
// Art und Datei bleiben: Wer sie ändern will, löscht den Block und legt einen neuen an
export const blockAendern = z
  .strictObject({
    version,
    text: z.string().trim().min(1).max(1000).optional(),
    reihenfolge: reihenfolge.optional(),
  })
  .refine(mindestensEins);

type Akteur = { lagerId: string; personId: string };
type Leser = Pick<Db, "select">;

export type TagesseiteFehler =
  "SEITE_VORHANDEN" | "KEIN_MITGLIED" | "LIMIT_ERREICHT";
export const FEHLER_TEXT: Record<TagesseiteFehler, [number, string]> = {
  SEITE_VORHANDEN: [409, "Für diesen Tag gibt es schon eine Seite."],
  KEIN_MITGLIED: [400, "Der Tageschef muss Mitglied dieses Lagers sein."],
  LIMIT_ERREICHT: [409, "Mehr Blöcke sind auf dieser Seite nicht möglich."],
};
type Fehler = { fehler: TagesseiteFehler };

// Der Lagertag (nicht gelöscht) dieses Lagers, sonst 404
async function ladeTag(tx: Leser, lagerId: string, lagertagId: string) {
  const [tag] = await tx
    .select()
    .from(lagertag)
    .where(and(eq(lagertag.id, lagertagId), eq(lagertag.lagerId, lagerId)));
  if (!tag) throw new HTTPException(404);
  return tag;
}

const seiteDesTags = (tx: Leser, lagerId: string, lagertagId: string) =>
  tx
    .select()
    .from(tagesseite)
    .where(
      and(
        eq(tagesseite.lagerId, lagerId),
        eq(tagesseite.lagertagId, lagertagId),
      ),
    )
    .then((z) => z[0]);

// Alle Tage des Lagers mit dem Stand ihrer Seite, in einer Abfrage (die Tage sind je Lager begrenzt)
export async function ladeTagesliste(db: Leser, lagerId: string) {
  const zeilen = await db
    .select({
      tag: lagertag,
      seite: tagesseite,
      name: user.name,
      ceviName: user.ceviName,
      bildUrl: bildUrlImLager(sql`${user.id}`, lagerId),
    })
    .from(lagertag)
    .leftJoin(
      tagesseite,
      and(
        eq(tagesseite.lagerId, lagertag.lagerId),
        eq(tagesseite.lagertagId, lagertag.id),
      ),
    )
    .leftJoin(user, eq(user.id, tagesseite.tageschefPersonId))
    .where(and(eq(lagertag.lagerId, lagerId)))
    .orderBy(asc(lagertag.datum), asc(lagertag.id));
  return zeilen.map((z) => ({
    lagertagId: z.tag.id,
    datum: z.tag.datum,
    label: z.tag.label,
    seite: z.seite
      ? {
          ...seiteAnsicht(z.seite),
          tageschef: z.seite.tageschefPersonId
            ? {
                id: z.seite.tageschefPersonId,
                name: z.name,
                ceviName: z.ceviName,
                bildUrl: z.bildUrl,
              }
            : null,
        }
      : null,
  }));
}

// Die Seite eines Tages mit allem, was der Tag zeigt. Abfragen: der Tag mit Seite und Tageschef (eine), die Blöcke (eine), die Programmbilder (eine, nur mit solchen), das Wetter (eine auf den Zwischenspeicher, ein Abruf nur bei zu altem Stand), die Aufgaben mit Frist an diesem Tag (zwei, nur mit Recht darauf)
export async function ladeTagesseite(
  db: Db,
  zugriff: LagerZugriff,
  lagertagId: string,
  dienst: Wetterdienst,
) {
  const lagerId = zugriff.lager.id;
  const [zeile] = await db
    .select({
      tag: lagertag,
      seite: tagesseite,
      name: user.name,
      ceviName: user.ceviName,
      bildUrl: bildUrlImLager(sql`${user.id}`, lagerId),
    })
    .from(lagertag)
    .leftJoin(
      tagesseite,
      and(
        eq(tagesseite.lagerId, lagertag.lagerId),
        eq(tagesseite.lagertagId, lagertag.id),
      ),
    )
    .leftJoin(user, eq(user.id, tagesseite.tageschefPersonId))
    .where(and(eq(lagertag.id, lagertagId), eq(lagertag.lagerId, lagerId)));
  if (!zeile) throw new HTTPException(404);
  const { tag, seite } = zeile;

  const bloecke = seite
    ? await db
        .select()
        .from(tagesseiteBlock)
        .where(
          and(
            eq(tagesseiteBlock.lagerId, lagerId),
            eq(tagesseiteBlock.seiteId, seite.id),
          ),
        )
        .orderBy(asc(tagesseiteBlock.reihenfolge), asc(tagesseiteBlock.id))
    : [];
  const dateiIds = bloecke.flatMap((b) => (b.dateiId ? [b.dateiId] : []));
  const dateien = await ladeDateien(db, lagerId, dateiIds);

  const umfang = leseUmfang(zugriff);
  const [wetter, aufgaben] = await Promise.all([
    darf(zugriff, "wetter.lesen")
      ? ladeWetter(db, zugriff.lager, dienst)
      : undefined,
    umfang
      ? ladeAufgaben(db, lagerId, {
          fristVon: tag.datum,
          fristBis: tag.datum,
          limit: 100,
          eigeneVon: umfang === "eigene" ? zugriff.personId : undefined,
        })
      : undefined,
  ]);

  return {
    lagertag: { id: tag.id, datum: tag.datum, label: tag.label },
    seite: seite
      ? {
          ...seiteAnsicht(seite),
          tageschef: seite.tageschefPersonId
            ? {
                id: seite.tageschefPersonId,
                name: zeile.name,
                ceviName: zeile.ceviName,
                bildUrl: zeile.bildUrl,
              }
            : null,
        }
      : null,
    bloecke: bloecke.map((b) => ({
      ...blockAnsicht(b),
      datei: b.dateiId ? (dateien.get(b.dateiId) ?? null) : null,
    })),
    wetter: wetter?.tage.find((t) => t.datum === tag.datum) ?? null,
    wetterStand: wetter?.stand ?? null,
    aufgaben: aufgaben?.aufgaben ?? [],
  };
}

async function pruefeTageschef(
  tx: Tx,
  lagerId: string,
  person: string | null | undefined,
) {
  if (!person) return true;
  return istMitglied(tx, lagerId, person);
}

export async function legeSeiteAn(
  tx: Tx,
  k: Akteur,
  lagertagId: string,
  e: z.output<typeof seiteAnlegen>,
): Promise<Fehler | { seite: ReturnType<typeof seiteAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  await ladeTag(tx, k.lagerId, lagertagId);
  if (await seiteDesTags(tx, k.lagerId, lagertagId)) {
    return { fehler: "SEITE_VORHANDEN" };
  }
  if (!(await pruefeTageschef(tx, k.lagerId, e.tageschefPersonId))) {
    return { fehler: "KEIN_MITGLIED" };
  }
  return {
    seite: seiteAnsicht(
      await legeZeileAn(tx, tagesseite, k, { lagertagId, ...e }),
    ),
  };
}

export async function aendereSeite(
  tx: Tx,
  k: Akteur,
  lagertagId: string,
  { version: v, ...werte }: z.output<typeof seiteAendern>,
): Promise<Fehler | { seite: ReturnType<typeof seiteAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  await ladeTag(tx, k.lagerId, lagertagId);
  const seite = await seiteDesTags(tx, k.lagerId, lagertagId);
  if (!seite) throw new HTTPException(404);
  if (!(await pruefeTageschef(tx, k.lagerId, werte.tageschefPersonId))) {
    return { fehler: "KEIN_MITGLIED" };
  }
  return {
    seite: seiteAnsicht(
      await aendereZeile(tx, tagesseite, k, {
        id: seite.id,
        version: v,
        werte,
        ansicht: seiteAnsicht,
      }),
    ),
  };
}

// Der erste Block legt die Seite an (ohne Tageschef und Notiz): Die App muss dafür keinen eigenen Aufruf machen
export async function legeBlockAn(
  tx: Tx,
  k: Akteur,
  lagertagId: string,
  e: z.output<typeof blockAnlegen>,
): Promise<Fehler | { block: ReturnType<typeof blockAnsicht> }> {
  await sperreLager(tx, k.lagerId);
  await ladeTag(tx, k.lagerId, lagertagId);
  if (e.dateiId) await pruefeDateiImLager(tx, k.lagerId, e.dateiId);
  const seite =
    (await seiteDesTags(tx, k.lagerId, lagertagId)) ??
    (await legeZeileAn(tx, tagesseite, k, { lagertagId }));
  const [stand] = await tx
    .select({
      n: count(),
      ende: sql<number>`coalesce(max(${tagesseiteBlock.reihenfolge}) + 1, 0)`,
    })
    .from(tagesseiteBlock)
    .where(
      and(
        eq(tagesseiteBlock.lagerId, k.lagerId),
        eq(tagesseiteBlock.seiteId, seite.id),
      ),
    );
  if (stand!.n >= MAX_BLOECKE) return { fehler: "LIMIT_ERREICHT" };
  return {
    block: blockAnsicht(
      await legeZeileAn(tx, tagesseiteBlock, k, {
        seiteId: seite.id,
        art: e.art,
        text: e.text,
        dateiId: e.dateiId ?? null,
        reihenfolge: e.reihenfolge ?? stand!.ende,
      }),
    ),
  };
}

// Der Block gehört zu diesem Lagertag, sonst 404 (eine URL mit fremdem Tag trifft nichts)
async function ladeBlock(
  tx: Leser,
  lagerId: string,
  lagertagId: string,
  blockId: string,
) {
  const [zeile] = await tx
    .select({ block: tagesseiteBlock })
    .from(tagesseiteBlock)
    .innerJoin(
      tagesseite,
      and(
        eq(tagesseite.lagerId, tagesseiteBlock.lagerId),
        eq(tagesseite.id, tagesseiteBlock.seiteId),
      ),
    )
    .where(
      and(
        eq(tagesseiteBlock.id, blockId),
        eq(tagesseiteBlock.lagerId, lagerId),
        eq(tagesseite.lagertagId, lagertagId),
      ),
    );
  if (!zeile) throw new HTTPException(404);
  return zeile.block;
}

export async function aendereBlock(
  tx: Tx,
  k: Akteur,
  lagertagId: string,
  blockId: string,
  { version: v, ...werte }: z.output<typeof blockAendern>,
) {
  await sperreLager(tx, k.lagerId);
  await ladeBlock(tx, k.lagerId, lagertagId, blockId);
  return blockAnsicht(
    await aendereZeile(tx, tagesseiteBlock, k, {
      id: blockId,
      version: v,
      werte,
      ansicht: blockAnsicht,
    }),
  );
}

export async function loescheBlock(
  tx: Tx,
  k: Akteur,
  lagertagId: string,
  blockId: string,
  v: number,
) {
  await sperreLager(tx, k.lagerId);
  await ladeBlock(tx, k.lagerId, lagertagId, blockId);
  await loescheZeile(tx, tagesseiteBlock, k, {
    id: blockId,
    version: v,
    ansicht: blockAnsicht,
  });
}
