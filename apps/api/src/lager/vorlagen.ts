import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { aufgabe, packlistePunkt, vorlage } from "../db/schema.js";
import { VORLAGE_ARTEN } from "../db/schema-lager-vorlagen.js";
import { aufgabeAktiv } from "./aufgaben.js";
import { PUNKTE_MAX } from "./lagerinfos.js";
import { sperreLager } from "./ressorts.js";
import { legeZeilenAn, type Tx } from "./sync.js";

// Vorlagen für Aufgaben und Packlisten (#376). Eine Vorlage gehört der Abteilung und ist nur ein Satz Einträge; das Anwenden legt im Lager neue Zeilen über den Sync-Kern an (mit Folgenummer und Feed) und behält keinen Verweis auf die Vorlage. Wer sie zweimal anwendet, hat jeden Eintrag zweimal.
//
// Inhalt je Art (strikt, höchstens so viel, wie das Lager fasst):
//   aufgaben:  { aufgaben: [{ titel, teil?, notiz?, stern?, laufend?, fristTage? }] }, bis 200 Einträge
//   packliste: { punkte: [{ abschnitt, text, nurLagerleitung? }] }, bis PUNKTE_MAX Einträge
// fristTage zählt in Tagen ab Lagerbeginn (lager.von): 0 ist der erste Lagertag, -30 dreissig Tage davor, 5 fünf Tage danach. Verantwortliche und Ressorts gehören nicht in die Vorlage, weil sie zu einem Lager gehören; die Lagerleitung teilt sie nach dem Anwenden zu.

export type VorlageArt = (typeof VORLAGE_ARTEN)[number];
export const AUFGABEN_MAX = 200;
export const VORLAGEN_MAX = 100;

const fristTage = z.number().int().min(-366).max(366);
const aufgabeEintrag = z.strictObject({
  titel: z.string().trim().min(1).max(200),
  teil: z.string().trim().min(1).max(100).optional(),
  notiz: z.string().trim().min(1).max(5000).optional(),
  stern: z.boolean().optional(),
  laufend: z.boolean().optional(),
  fristTage: fristTage.optional(),
});
const punktEintrag = z.strictObject({
  abschnitt: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(300),
  nurLagerleitung: z.boolean().optional(),
});

export const aufgabenInhalt = z.strictObject({
  aufgaben: z.array(aufgabeEintrag).min(1).max(AUFGABEN_MAX),
});
export const packlisteInhalt = z.strictObject({
  punkte: z.array(punktEintrag).min(1).max(PUNKTE_MAX),
});
export const INHALT_SCHEMA = {
  aufgaben: aufgabenInhalt,
  packliste: packlisteInhalt,
} as const satisfies Record<VorlageArt, z.ZodType>;

// Die Spalte der Tabelle und die Ansichten der Routen
export type VorlageZeile = typeof vorlage.$inferSelect;

const anzahl = (v: Pick<VorlageZeile, "art" | "inhalt">) => {
  const liste = (v.inhalt as Record<string, unknown>)[
    v.art === "aufgaben" ? "aufgaben" : "punkte"
  ];
  return Array.isArray(liste) ? liste.length : 0;
};
export const vorlageUebersicht = (v: VorlageZeile) => ({
  id: v.id,
  art: v.art,
  name: v.name,
  anzahl: anzahl(v),
  geaendertAm: v.geaendertAm,
});
export const vorlageAnsicht = (v: VorlageZeile) => ({
  ...vorlageUebersicht(v),
  inhalt: v.inhalt,
});

// Datum plus Tage, ohne Zeitzone: «YYYY-MM-DD» wie die Spalte lager.von
export const fristAb = (von: string, tage: number) =>
  new Date(Date.parse(`${von}T00:00:00Z`) + tage * 86_400_000)
    .toISOString()
    .slice(0, 10);

export type Plan =
  | {
      art: "aufgaben";
      aufgaben: (Omit<z.output<typeof aufgabeEintrag>, "fristTage"> & {
        frist: string | null;
      })[];
    }
  | {
      art: "packliste";
      punkte: { abschnitt: string; text: string; nurLagerleitung: boolean }[];
    };

// Die Einträge, die das Anwenden anlegen würde (für den Trockenlauf und zum Schreiben). undefined: Der gespeicherte Inhalt passt nicht zum Schema (nur nach einem Eingriff an der Datenbank möglich)
export function planeVorlage(
  v: Pick<VorlageZeile, "art" | "inhalt">,
  lagerVon: string,
): Plan | undefined {
  if (v.art === "aufgaben") {
    const r = aufgabenInhalt.safeParse(v.inhalt);
    if (!r.success) return undefined;
    return {
      art: "aufgaben",
      aufgaben: r.data.aufgaben.map(({ fristTage: tage, ...a }) => ({
        ...a,
        frist: tage === undefined ? null : fristAb(lagerVon, tage),
      })),
    };
  }
  const r = packlisteInhalt.safeParse(v.inhalt);
  if (!r.success) return undefined;
  return {
    art: "packliste",
    punkte: r.data.punkte.map((p) => ({
      ...p,
      nurLagerleitung: p.nurLagerleitung ?? false,
    })),
  };
}

// Die Vorschau der Antwort: nur, was sichtbar anders wird (kein Rohinhalt)
export const planAnsicht = (plan: Plan) =>
  plan.art === "aufgaben"
    ? {
        art: plan.art,
        aufgaben: plan.aufgaben.map((a) => ({
          titel: a.titel,
          frist: a.frist,
        })),
      }
    : { art: plan.art, punkte: plan.punkte };

// Die Vorlage der eigenen Abteilung; eine fremde oder unbekannte ID gibt es nicht
export async function ladeVorlage(
  d: Pick<Db, "select">,
  abteilungId: string,
  id: string,
) {
  const [zeile] = await d
    .select()
    .from(vorlage)
    .where(and(eq(vorlage.id, id), eq(vorlage.abteilungId, abteilungId)));
  return zeile;
}

// Die Packliste fasst höchstens PUNKTE_MAX Punkte; die Vorlage darf sie nicht über die Grenze heben. Der Trockenlauf prüft dasselbe
export async function passtInsLager(
  d: Pick<Db, "select">,
  lagerId: string,
  plan: Plan,
) {
  if (plan.art !== "packliste") return true;
  const [stand] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(packlistePunkt)
    .where(
      and(
        eq(packlistePunkt.lagerId, lagerId),
        isNull(packlistePunkt.geloeschtAm),
      ),
    );
  return stand!.n + plan.punkte.length <= PUNKTE_MAX;
}

// Schreibt den Plan ans Ende der Liste des Lagers, in einer Transaktion des Aufrufers (Sperre des Lagers, Zählen, ein Insert samt Feed-Eintrag je Tabelle). Die Rolle prüft der Aufrufer; es entsteht keine Benachrichtigung, weil kein Eintrag eine Person zuteilt
export async function schreibePlan(
  tx: Tx,
  k: { lagerId: string; personId: string },
  plan: Plan,
) {
  await sperreLager(tx, k.lagerId);
  if (plan.art === "aufgaben") {
    const [ende] = await tx
      .select({ n: sql<number>`coalesce(max(${aufgabe.reihenfolge}) + 1, 0)` })
      .from(aufgabe)
      .where(and(eq(aufgabe.lagerId, k.lagerId), aufgabeAktiv));
    await legeZeilenAn(
      tx,
      aufgabe,
      k,
      plan.aufgaben.map((a, i) => ({ ...a, reihenfolge: ende!.n + i })),
    );
    return;
  }
  const [ende] = await tx
    .select({
      n: sql<number>`coalesce(max(${packlistePunkt.reihenfolge}) + 1, 0)`,
    })
    .from(packlistePunkt)
    .where(
      and(
        eq(packlistePunkt.lagerId, k.lagerId),
        isNull(packlistePunkt.geloeschtAm),
      ),
    );
  await legeZeilenAn(
    tx,
    packlistePunkt,
    k,
    plan.punkte.map((p, i) => ({ ...p, reihenfolge: ende!.n + i })),
  );
}
