import { and, desc, eq, ilike, inArray, isNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  beschluss,
  hoeck,
  lagerDatei,
  PROTOKOLL_ART,
  protokoll,
} from "../db/schema.js";
import { dateiAnsicht } from "./datei.js";
import { registriereDateiVerweis } from "./datei-verweise.js";
import { hoeckAnsicht, hoeckUmfang, ladeHoeckZeile } from "./hoecks.js";
import type { LagerZugriff } from "./policy.js";
import { sperreLager } from "./ressorts.js";
import { aendereZeile, legeZeileAn, loescheZeile, type Tx } from "./sync.js";
import { registriereSuchquelle } from "./suche.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Protokolle und Beschlüsse im Lager (#379). Das Protokoll liegt als Datei im SharePoint der Abteilung; Cevi OS speichert nur Art, Titel, Datum, den Verweis auf die Datei (lager_datei, #370: dort Anzeigename und Link) und optional den Höck. Kein Protokolltext, keine Abschnitte, keine Revisionen des Inhalts; Öffnen und Herunterladen gehen über den Link direkt zum Ablageort, der selbst regelt, wer die Datei öffnen darf. Die Beschlüsse sind eine kurze Liste in Cevi OS (Text, optional Protokoll und Höck).
//
// Rechte (lager/rechte-katalog.ts): protokolle.lesen (Lesen), protokolle.bearbeiten (Schreiben). Zusätzliche Regel: Ein Protokoll oder Beschluss, der zu einem Höck der Art «lagerleitung» gehört, sehen nur Rollen, die alle Höcks lesen (hoecks.lesen_alle oder hoecks.bearbeiten); sonst ist er unbekannt (404). Das gilt unabhängig davon, ob jemand protokolle.lesen eingestellt bekommen hat: Das Team liest nie Protokolle der Lagerleitung.
// hoeck.protokoll_id (#378) zeigt auf das Sitzungsprotokoll des Höcks. Der Server pflegt sie: Ein Protokoll der Art «sitzung» mit Höck setzt sie, wenn der Höck noch keines hat; Löschen, Umhängen oder Ändern der Art nimmt sie zurück (ohne Ersatz).

// Sichtbarkeit nach Höck (die Rolle liest nicht alle Höcks): Ein Höck der Lagerleitung verbirgt. Auch ein gelöschter Höck verbirgt weiter (kein Filter auf geloescht_am)
const hoeckOffen = (lagerId: unknown, hoeckId: unknown) =>
  sql`(${hoeckId} is null or exists (select 1 from "hoeck" h where h."lager_id" = ${lagerId} and h."id" = ${hoeckId} and h."art" = 'team'))`;
const protokollSicht = hoeckOffen(protokoll.lagerId, protokoll.hoeckId);
// Beschluss: der eigene Höck und der Höck seines Protokolls
const beschlussSicht = sql`(${hoeckOffen(beschluss.lagerId, beschluss.hoeckId)} and (${beschluss.protokollId} is null or exists (select 1 from "protokoll" p where p."lager_id" = ${beschluss.lagerId} and p."id" = ${beschluss.protokollId} and ${hoeckOffen(sql`p."lager_id"`, sql`p."hoeck_id"`)})))`;

const alleHoecks = (zugriff: LagerZugriff) => hoeckUmfang(zugriff) === "alle";

// Welche der IDs sieht die Person (Zeilenfilter des Feeds): mit allen Höcks alle, sonst die ohne Höck der Lagerleitung. Der Feed fragt auch gelöschte Zeilen, darum kein Filter auf geloescht_am
async function sichtbareProtokolle(
  db: Db,
  zugriff: LagerZugriff,
  ids: string[],
) {
  if (alleHoecks(zugriff)) return new Set(ids);
  if (ids.length === 0) return new Set<string>();
  const zeilen = await db
    .select({ id: protokoll.id })
    .from(protokoll)
    .where(
      and(
        inArray(protokoll.id, ids),
        eq(protokoll.lagerId, zugriff.lager.id),
        protokollSicht,
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}
async function sichtbareBeschluesse(
  db: Db,
  zugriff: LagerZugriff,
  ids: string[],
) {
  if (alleHoecks(zugriff)) return new Set(ids);
  if (ids.length === 0) return new Set<string>();
  const zeilen = await db
    .select({ id: beschluss.id })
    .from(beschluss)
    .where(
      and(
        inArray(beschluss.id, ids),
        eq(beschluss.lagerId, zugriff.lager.id),
        beschlussSicht,
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}

registriereLagerTabelle({
  tabelle: protokoll,
  recht: "protokolle.lesen",
  sichtbar: sichtbareProtokolle,
});
registriereLagerTabelle({
  tabelle: beschluss,
  recht: "protokolle.lesen",
  sichtbar: sichtbareBeschluesse,
});
// Suche (#399): nur der Titel des Protokolls (der Inhalt der Datei im SharePoint ist nie durchsuchbar) und der Text eines Beschlusses; derselbe Höck-Filter wie die Liste
registriereSuchquelle({
  typ: "protokoll",
  recht: "protokolle.lesen",
  tabelle: protokoll,
  spalten: [protokoll.titel],
  titel: sql`${protokoll.titel}`,
  filter: (zugriff) => (alleHoecks(zugriff) ? undefined : protokollSicht),
});
registriereSuchquelle({
  typ: "beschluss",
  recht: "protokolle.lesen",
  tabelle: beschluss,
  spalten: [beschluss.text],
  titel: sql`left(${beschluss.text}, 80)`,
  filter: (zugriff) => (alleHoecks(zugriff) ? undefined : beschlussSicht),
});
// Verweisregister (#370): Die Datei eines Protokolls sieht, wer das Protokoll sieht (nicht gelöschte Protokolle; eines im Papierkorb hält die Datei trotzdem, siehe datei-verweise.ts)
registriereDateiVerweis({
  tabelle: protokoll,
  spalte: protokoll.dateiId,
  recht: "protokolle.lesen",
  sichtbar: async (db, zugriff, dateiIds) => {
    const zeilen = await db
      .select({ id: protokoll.dateiId })
      .from(protokoll)
      .where(
        and(
          inArray(protokoll.dateiId, dateiIds),
          eq(protokoll.lagerId, zugriff.lager.id),
          isNull(protokoll.geloeschtAm),
          alleHoecks(zugriff) ? undefined : protokollSicht,
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});

export type ProtokollZeile = typeof protokoll.$inferSelect;
export type BeschlussZeile = typeof beschluss.$inferSelect;

// Ansichten für die Konfliktantwort des Sync-Kerns: nur die Spalten der Route
export const protokollAnsicht = (p: ProtokollZeile) => ({
  id: p.id,
  version: p.version,
  art: p.art,
  titel: p.titel,
  datum: p.datum,
  hoeckId: p.hoeckId,
  dateiId: p.dateiId,
});
export const beschlussAnsicht = (b: BeschlussZeile) => ({
  id: b.id,
  version: b.version,
  text: b.text,
  protokollId: b.protokollId,
  hoeckId: b.hoeckId,
});

// Eingaben: strikt, nur die genannten Felder (SR-72)
const version = z.number().int().min(1);
const datum = z.iso.date().refine((wert) => !wert.startsWith("0000"));
const titel = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{C}]+$/u);
const beschlussText = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  // Zeilenumbrüche sind erlaubt, andere Steuerzeichen nicht
  .regex(/^[^\p{C}]*(?:[\n\r\t][^\p{C}]*)*$/u);

export const protokollAnlegen = z.strictObject({
  art: z.enum(PROTOKOLL_ART),
  titel,
  datum,
  // Die Verknüpfung aus POST /lager/{id}/dateien (Link-Prüfung dort)
  dateiId: z.uuid(),
  hoeckId: z.uuid().nullable().optional(),
});
export const protokollAendern = z
  .strictObject({
    version,
    art: z.enum(PROTOKOLL_ART).optional(),
    titel: titel.optional(),
    datum: datum.optional(),
    dateiId: z.uuid().optional(),
    hoeckId: z.uuid().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const beschlussAnlegen = z.strictObject({
  text: beschlussText,
  protokollId: z.uuid().nullable().optional(),
  hoeckId: z.uuid().nullable().optional(),
});
export const beschlussAendern = z
  .strictObject({
    version,
    text: beschlussText.optional(),
    protokollId: z.uuid().nullable().optional(),
    hoeckId: z.uuid().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

export const SEITE = 50;
export const protokolleAbfrage = z.strictObject({
  hoeckId: z.uuid().optional(),
  art: z.enum(PROTOKOLL_ART).optional(),
  // Suche im Titel, nie im Inhalt der Datei
  q: z.string().trim().min(1).max(100).optional(),
  // Cursor: die ID des letzten Eintrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});
export const beschluesseAbfrage = z.strictObject({
  hoeckId: z.uuid().optional(),
  protokollId: z.uuid().optional(),
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});

// LIKE-Muster mit maskierten Sonderzeichen
const muster = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

export type ProtokollEintrag = ReturnType<typeof protokollAnsicht> & {
  // null: die Datei ist gelöscht
  datei: ReturnType<typeof dateiAnsicht> | null;
  erstelltAm: Date;
  erstelltVon: string | null;
};

// Die Protokolle, neueste zuerst (uuidv7), mit Cursor. Eine Abfrage samt Datei (Join). Ohne alle Höcks fehlen die Protokolle der Lagerleitung; «ungefiltert» für die Antwort auf die eigene Änderung (die Route hat die Sicht schon geprüft)
export async function ladeProtokolle(
  db: Db,
  zugriff: LagerZugriff,
  p: {
    id?: string;
    hoeckId?: string;
    art?: (typeof PROTOKOLL_ART)[number];
    q?: string;
    nach?: string;
    limit?: number;
    ungefiltert?: true;
  } = {},
): Promise<{ eintraege: ProtokollEintrag[]; naechster: string | null }> {
  const limit = p.limit ?? SEITE;
  const zeilen = await db
    .select({ zeile: protokoll, datei: lagerDatei })
    .from(protokoll)
    .leftJoin(
      lagerDatei,
      and(eq(lagerDatei.id, protokoll.dateiId), isNull(lagerDatei.geloeschtAm)),
    )
    .where(
      and(
        eq(protokoll.lagerId, zugriff.lager.id),
        isNull(protokoll.geloeschtAm),
        p.id ? eq(protokoll.id, p.id) : undefined,
        p.hoeckId ? eq(protokoll.hoeckId, p.hoeckId) : undefined,
        p.art ? eq(protokoll.art, p.art) : undefined,
        p.q ? ilike(protokoll.titel, muster(p.q)) : undefined,
        p.nach ? lt(protokoll.id, p.nach) : undefined,
        alleHoecks(zugriff) || p.ungefiltert ? undefined : protokollSicht,
      ),
    )
    .orderBy(desc(protokoll.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  return {
    eintraege: seite.map((z) => ({
      ...protokollAnsicht(z.zeile),
      datei: z.datei && dateiAnsicht(z.datei),
      erstelltAm: z.zeile.erstelltAm,
      erstelltVon: z.zeile.erstelltVon,
    })),
    naechster: zeilen.length > limit ? seite[limit - 1]!.zeile.id : null,
  };
}

export type BeschlussEintrag = ReturnType<typeof beschlussAnsicht> & {
  erstelltAm: Date;
  erstelltVon: string | null;
};

// Die Beschlüsse, neueste zuerst, mit Cursor, in einer Abfrage
export async function ladeBeschluesse(
  db: Db,
  zugriff: LagerZugriff,
  p: {
    id?: string;
    hoeckId?: string;
    protokollId?: string;
    nach?: string;
    limit?: number;
    ungefiltert?: true;
  } = {},
): Promise<{ eintraege: BeschlussEintrag[]; naechster: string | null }> {
  const limit = p.limit ?? SEITE;
  const zeilen = await db
    .select()
    .from(beschluss)
    .where(
      and(
        eq(beschluss.lagerId, zugriff.lager.id),
        isNull(beschluss.geloeschtAm),
        p.id ? eq(beschluss.id, p.id) : undefined,
        p.hoeckId ? eq(beschluss.hoeckId, p.hoeckId) : undefined,
        p.protokollId ? eq(beschluss.protokollId, p.protokollId) : undefined,
        p.nach ? lt(beschluss.id, p.nach) : undefined,
        alleHoecks(zugriff) || p.ungefiltert ? undefined : beschlussSicht,
      ),
    )
    .orderBy(desc(beschluss.id))
    .limit(limit + 1);
  const seite = zeilen.slice(0, limit);
  return {
    eintraege: seite.map((z) => ({
      ...beschlussAnsicht(z),
      erstelltAm: z.erstelltAm,
      erstelltVon: z.erstelltVon,
    })),
    naechster: zeilen.length > limit ? seite[limit - 1]!.id : null,
  };
}

type Akteur = { lagerId: string; personId: string };
export type Pruefung =
  | { fehler: "HOECK_UNBEKANNT" | "PROTOKOLL_UNBEKANNT" | "HOECK_PASST_NICHT" }
  | undefined;

// Den Höck kennt die Person nur, wenn es ihn in diesem Lager gibt, er nicht gelöscht ist und sie ihn lesen darf (Ziele aus der Anfrage sind nie ein Nachweis, SR-11)
async function hoeckDa(
  tx: Tx,
  zugriff: LagerZugriff,
  hoeckId: string,
): Promise<boolean> {
  const zeile = await ladeHoeckZeile(tx, zugriff.lager.id, hoeckId);
  return !!zeile && (zeile.art === "team" || alleHoecks(zugriff));
}

// Das Protokoll gibt es in diesem Lager, es ist nicht gelöscht und die Person sieht es
async function protokollDa(tx: Tx, zugriff: LagerZugriff, id: string) {
  const [zeile] = await tx
    .select()
    .from(protokoll)
    .where(
      and(
        eq(protokoll.id, id),
        eq(protokoll.lagerId, zugriff.lager.id),
        isNull(protokoll.geloeschtAm),
        alleHoecks(zugriff) ? undefined : protokollSicht,
      ),
    );
  return zeile;
}

async function ladeBeschlussZeile(tx: Tx, lagerId: string, id: string) {
  const [zeile] = await tx
    .select()
    .from(beschluss)
    .where(
      and(
        eq(beschluss.id, id),
        eq(beschluss.lagerId, lagerId),
        isNull(beschluss.geloeschtAm),
      ),
    );
  return zeile;
}

// hoeck.protokoll_id pflegen (siehe Kopf). Beides unter der Lagersperre der aufrufenden Transaktion; die Version des Höcks wird hier gelesen, nicht vom Client
async function zeigerSetzen(
  tx: Tx,
  k: Akteur,
  hoeckId: string,
  protokollId: string,
) {
  const h = await ladeHoeckZeile(tx, k.lagerId, hoeckId);
  if (!h || h.protokollId) return;
  await aendereZeile(tx, hoeck, k, {
    id: h.id,
    version: h.version,
    werte: { protokollId },
    ansicht: hoeckAnsicht,
  });
}
async function zeigerLoesen(
  tx: Tx,
  k: Akteur,
  hoeckId: string,
  protokollId: string,
) {
  const h = await ladeHoeckZeile(tx, k.lagerId, hoeckId);
  if (!h || h.protokollId !== protokollId) return;
  await aendereZeile(tx, hoeck, k, {
    id: h.id,
    version: h.version,
    werte: { protokollId: null },
    ansicht: hoeckAnsicht,
  });
}

export async function legeProtokollAn(
  tx: Tx,
  zugriff: LagerZugriff,
  k: Akteur,
  eingabe: z.output<typeof protokollAnlegen>,
): Promise<{ fehler: "HOECK_UNBEKANNT" } | { id: string }> {
  await sperreLager(tx, k.lagerId);
  const { hoeckId = null, ...rest } = eingabe;
  if (hoeckId && !(await hoeckDa(tx, zugriff, hoeckId))) {
    return { fehler: "HOECK_UNBEKANNT" };
  }
  const neu = await legeZeileAn(tx, protokoll, k, { ...rest, hoeckId });
  if (hoeckId && neu.art === "sitzung") {
    await zeigerSetzen(tx, k, hoeckId, neu.id);
  }
  return { id: neu.id };
}

export async function aendereProtokoll(
  tx: Tx,
  zugriff: LagerZugriff,
  k: Akteur,
  id: string,
  eingabe: z.output<typeof protokollAendern>,
): Promise<{ fehler: "HOECK_UNBEKANNT" } | undefined> {
  const { version: erwartet, ...werte } = eingabe;
  await sperreLager(tx, k.lagerId);
  const alt = await protokollDa(tx, zugriff, id);
  if (!alt) throw new HTTPException(404);
  if (
    werte.hoeckId &&
    werte.hoeckId !== alt.hoeckId &&
    !(await hoeckDa(tx, zugriff, werte.hoeckId))
  ) {
    return { fehler: "HOECK_UNBEKANNT" };
  }
  const neu = await aendereZeile(tx, protokoll, k, {
    id,
    version: erwartet,
    werte,
    ansicht: protokollAnsicht,
  });
  if (alt.hoeckId && (alt.hoeckId !== neu.hoeckId || neu.art !== "sitzung")) {
    await zeigerLoesen(tx, k, alt.hoeckId, id);
  }
  if (neu.hoeckId && neu.art === "sitzung") {
    await zeigerSetzen(tx, k, neu.hoeckId, id);
  }
  return undefined;
}

// Löschen ist ein Soft-Delete (endgültig mit #427). Beschlüsse bleiben stehen und zeigen weiter auf das gelöschte Protokoll
export async function loescheProtokoll(
  tx: Tx,
  zugriff: LagerZugriff,
  k: Akteur,
  id: string,
  erwartet: number,
) {
  await sperreLager(tx, k.lagerId);
  const alt = await protokollDa(tx, zugriff, id);
  if (!alt) throw new HTTPException(404);
  await loescheZeile(tx, protokoll, k, {
    id,
    version: erwartet,
    ansicht: protokollAnsicht,
  });
  if (alt.hoeckId) await zeigerLoesen(tx, k, alt.hoeckId, id);
}

// Protokoll und Höck eines Beschlusses: beide gibt es im Lager und die Person sieht sie; gehört das Protokoll zu einem Höck, muss ein genannter Höck derselbe sein. Beim Anlegen ohne Höck übernimmt der Beschluss den Höck des Protokolls
async function pruefeBeschluss(
  tx: Tx,
  zugriff: LagerZugriff,
  protokollId: string | null,
  hoeckId: string | null,
): Promise<{ pruefung: Pruefung; hoeckId: string | null }> {
  let hoeck = hoeckId;
  if (protokollId) {
    const p = await protokollDa(tx, zugriff, protokollId);
    if (!p) return { pruefung: { fehler: "PROTOKOLL_UNBEKANNT" }, hoeckId };
    if (p.hoeckId && hoeck && p.hoeckId !== hoeck) {
      return { pruefung: { fehler: "HOECK_PASST_NICHT" }, hoeckId };
    }
    hoeck = hoeck ?? p.hoeckId;
  }
  if (hoeck && !(await hoeckDa(tx, zugriff, hoeck))) {
    return { pruefung: { fehler: "HOECK_UNBEKANNT" }, hoeckId };
  }
  return { pruefung: undefined, hoeckId: hoeck };
}

export async function legeBeschlussAn(
  tx: Tx,
  zugriff: LagerZugriff,
  k: Akteur,
  eingabe: z.output<typeof beschlussAnlegen>,
): Promise<NonNullable<Pruefung> | { id: string }> {
  await sperreLager(tx, k.lagerId);
  const protokollId = eingabe.protokollId ?? null;
  const { pruefung, hoeckId } = await pruefeBeschluss(
    tx,
    zugriff,
    protokollId,
    eingabe.hoeckId ?? null,
  );
  if (pruefung) return pruefung;
  const neu = await legeZeileAn(tx, beschluss, k, {
    text: eingabe.text,
    protokollId,
    hoeckId,
  });
  return { id: neu.id };
}

export async function aendereBeschluss(
  tx: Tx,
  zugriff: LagerZugriff,
  k: Akteur,
  id: string,
  eingabe: z.output<typeof beschlussAendern>,
): Promise<Pruefung> {
  const { version: erwartet, ...werte } = eingabe;
  await sperreLager(tx, k.lagerId);
  const alt = await ladeBeschlussZeile(tx, k.lagerId, id);
  if (!alt) throw new HTTPException(404);
  // Nur wer das Protokoll oder den Höck ändert, löst die Prüfung aus; eine Änderung des Textes allein prüft nichts
  const protokollId =
    werte.protokollId === undefined ? alt.protokollId : werte.protokollId;
  const hoeckId = werte.hoeckId === undefined ? alt.hoeckId : werte.hoeckId;
  if (werte.protokollId !== undefined || werte.hoeckId !== undefined) {
    const { pruefung } = await pruefeBeschluss(
      tx,
      zugriff,
      protokollId,
      hoeckId,
    );
    if (pruefung) return pruefung;
  }
  await aendereZeile(tx, beschluss, k, {
    id,
    version: erwartet,
    werte,
    ansicht: beschlussAnsicht,
  });
  return undefined;
}

export async function loescheBeschluss(
  tx: Tx,
  k: Akteur,
  id: string,
  erwartet: number,
) {
  await sperreLager(tx, k.lagerId);
  await loescheZeile(tx, beschluss, k, {
    id,
    version: erwartet,
    ansicht: beschlussAnsicht,
  });
}
