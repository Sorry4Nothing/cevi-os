import {
  and,
  desc,
  eq,
  getTableName,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { dokument, lagerDatei } from "../db/schema.js";
import { dateiAnsicht } from "./datei.js";
import {
  registriereDateiVerweis,
  sichtbarJeVerweis,
  tabellenName,
  verweiseAnderer,
} from "./datei-verweise.js";
import { darf, type LagerZugriff } from "./policy.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Dokumente im Lager (#396): Titel, Verweis auf eine Datei im SharePoint (lager_datei, #370), Stichworte und die Freigabe für das Team. Es gibt keinen Speicher für Inhalte: Öffnen und Herunterladen gehen über den Link direkt zum Ablageort. Die Sicht «Dokumente» ist eine Sammelabfrage (ladeDokumente): die Dokumente und, soweit andere Module ihre Dateien im Verweisregister angemeldet haben (registriereDateiVerweis), deren Dateien.
// Wer liest: dokumente.lesen_alle alle Dokumente, dokumente.team_lesen nur die mit team_sichtbar. Die Rolle Team hat im Standard nur das zweite.

const alle = (zugriff: LagerZugriff) => darf(zugriff, "dokumente.lesen_alle");

// Welche der IDs sieht die Person (Zeilenfilter des Feeds): Mit lesen_alle alle, sonst nur Dokumente mit team_sichtbar. Der Feed fragt auch gelöschte Zeilen, darum kein Filter auf geloescht_am
async function sichtbareDokumente(
  db: Db,
  zugriff: LagerZugriff,
  ids: string[],
) {
  if (alle(zugriff)) return new Set(ids);
  if (ids.length === 0) return new Set<string>();
  const zeilen = await db
    .select({ id: dokument.id })
    .from(dokument)
    .where(
      and(
        inArray(dokument.id, ids),
        eq(dokument.lagerId, zugriff.lager.id),
        eq(dokument.teamSichtbar, true),
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}

// Anmeldung beim ersten Import dieser Datei. Feed: nur mit dokumente.team_lesen, mit dem Zeilenfilter oben. Verweisregister: Die Datei eines Dokuments sieht, wer das Dokument sieht (nicht gelöschte Dokumente; eines im Papierkorb hält die Datei trotzdem, siehe datei-verweise.ts)
registriereLagerTabelle({
  tabelle: dokument,
  recht: "dokumente.team_lesen",
  sichtbar: sichtbareDokumente,
});
registriereDateiVerweis({
  tabelle: dokument,
  spalte: dokument.dateiId,
  recht: "dokumente.team_lesen",
  sichtbar: async (db, zugriff, dateiIds) => {
    const zeilen = await db
      .select({ id: dokument.dateiId })
      .from(dokument)
      .where(
        and(
          inArray(dokument.dateiId, dateiIds),
          eq(dokument.lagerId, zugriff.lager.id),
          isNull(dokument.geloeschtAm),
          alle(zugriff) ? undefined : eq(dokument.teamSichtbar, true),
        ),
      );
    return new Set(zeilen.map((z) => z.id));
  },
});

// Ansicht für die Konfliktantwort des Sync-Kerns: nur die Spalten der Route
export const dokumentAnsicht = (r: typeof dokument.$inferSelect) => ({
  id: r.id,
  version: r.version,
  titel: r.titel,
  dateiId: r.dateiId,
  stichworte: r.stichworte,
  teamSichtbar: r.teamSichtbar,
});

// Eingaben: strikt, nur die genannten Felder (SR-72). Stichworte werden klein geschrieben und ohne Doppelte gespeichert, damit der Filter (GIN-Index, @>) exakt trifft
export const MAX_STICHWORTE = 20;
const stichwort = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\p{C},]+$/u)
  .transform((s) => s.replace(/\s+/g, " ").toLowerCase());
const ohneDoppelte = (liste: string[]) => [...new Set(liste)];
const stichworte = z
  .array(stichwort)
  .max(MAX_STICHWORTE)
  .transform(ohneDoppelte);
const titel = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{C}]+$/u);
const version = z.number().int().min(1);

export const dokumentAnlegen = z.strictObject({
  titel,
  // Die Verknüpfung aus POST /lager/{id}/dateien (Link-Prüfung dort)
  dateiId: z.uuid(),
  stichworte: stichworte.optional(),
  teamSichtbar: z.boolean().optional(),
});
export const dokumentAendern = z
  .strictObject({
    version,
    titel: titel.optional(),
    dateiId: z.uuid().optional(),
    stichworte: stichworte.optional(),
    teamSichtbar: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

export const DOKUMENT_TYPEN = [
  "pdf",
  "word",
  "excel",
  "bild",
  "sharepoint",
  "link",
] as const;
export const SEITE = 50;
export const dokumenteAbfrage = z.strictObject({
  // Suche in Titel und Stichworten, nie im Inhalt der Datei
  q: z.string().trim().min(1).max(100).optional(),
  // Kommagetrennt, höchstens 5; ein Dokument muss alle tragen
  stichwort: z
    .string()
    .max(300)
    .transform((s) => s.split(","))
    .pipe(z.array(stichwort).min(1).max(5))
    .transform(ohneDoppelte)
    .optional(),
  typ: z.enum(DOKUMENT_TYPEN).optional(),
  // Cursor: die ID des letzten Eintrags der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(SEITE),
});

// Art der Datei aus MIME-Typ oder Endung des Anzeigenamens (beides kommt vom Anlegen, der Server ruft den Link nie ab); «link» ist alles andere. SharePoint ist keine Art, sondern der Ablageort (Host *.sharepoint.com), er kann zu jeder Art kommen
const endung = (muster: string) =>
  sql`${lagerDatei.anzeigename} ~* ${`\\.(${muster})$`}`;
const artSql = sql<string | null>`case
  when ${lagerDatei.id} is null then null
  when ${lagerDatei.typ} = 'application/pdf' or ${endung("pdf")} then 'pdf'
  when ${lagerDatei.typ} in ('application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') or ${endung("docx?")} then 'word'
  when ${lagerDatei.typ} in ('application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') or ${endung("xlsx?")} then 'excel'
  when ${lagerDatei.typ} like 'image/%' or ${endung("png|jpe?g|gif|webp|heic")} then 'bild'
  else 'link' end`;
const sharepointSql = sql<boolean | null>`case
  when ${lagerDatei.id} is null then null
  else ${lagerDatei.link} ~* '^https://[^/]+\\.sharepoint\\.com(/|$)' end`;
const typFilter = (typ: (typeof DOKUMENT_TYPEN)[number]) =>
  typ === "sharepoint" ? sharepointSql : sql`${artSql} = ${typ}`;

export type DokumentEintrag = {
  // «dokument» oder der Name der Tabelle des Moduls, das die Datei einbindet (zum Beispiel «pinnwand_beitrag»); bei einer Datei eines anderen Moduls ist id die ID der Datei
  quelle: string;
  id: string;
  version: number | null;
  titel: string;
  stichworte: string[];
  teamSichtbar: boolean | null;
  // null: die Datei ist gelöscht
  datei: ReturnType<typeof dateiAnsicht> | null;
  art: string | null;
  sharepoint: boolean | null;
  erstelltAm: Date;
};

// LIKE-Muster mit maskierten Sonderzeichen
const muster = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

export type DokumentAbfrage = {
  // Ein einzelnes Dokument
  id?: string;
  q?: string;
  stichworte?: string[];
  typ?: (typeof DOKUMENT_TYPEN)[number];
  nach?: string;
  limit?: number;
  // Ohne den Filter der Rolle (die Antwort auf die eigene Änderung)
  ungefiltert?: true;
};

// Die Sammelabfrage, absteigend nach ID (uuidv7: neueste zuerst), mit Cursor. Abfragen: eine für die Dokumente samt Dateien (Join), dazu nur wenn andere Module Dateien angemeldet haben und kein Stichwort gefiltert wird: eine für deren Dateien und eine je angemeldetem Verweis für die Sichtbarkeit. Ohne Verweise anderer Module sind es genau diese eine.
// Beide Quellen laufen in einer Folge: Von den Dateien anderer Module bleiben nur die sichtbaren. Ist ihr Stapel voll (limit Kandidaten), kann es darunter mehr geben; dann zählen nur Einträge ab der kleinsten untersuchten ID («bis»), und die nächste Seite beginnt dort
export async function ladeDokumente(
  db: Db,
  zugriff: LagerZugriff,
  p: DokumentAbfrage = {},
): Promise<{ eintraege: DokumentEintrag[]; naechster: string | null }> {
  const lagerId = zugriff.lager.id;
  const limit = p.limit ?? SEITE;
  const typ = p.typ && typFilter(p.typ);
  const zeilen = await db
    .select({
      zeile: dokument,
      datei: lagerDatei,
      art: artSql,
      sharepoint: sharepointSql,
    })
    .from(dokument)
    .leftJoin(
      lagerDatei,
      and(eq(lagerDatei.id, dokument.dateiId), isNull(lagerDatei.geloeschtAm)),
    )
    .where(
      and(
        eq(dokument.lagerId, lagerId),
        isNull(dokument.geloeschtAm),
        p.id ? eq(dokument.id, p.id) : undefined,
        p.nach ? lt(dokument.id, p.nach) : undefined,
        alle(zugriff) || p.ungefiltert
          ? undefined
          : eq(dokument.teamSichtbar, true),
        p.stichworte?.length
          ? sql`${dokument.stichworte} @> array[${sql.join(
              p.stichworte.map((s) => sql`${s}`),
              sql`, `,
            )}]::text[]`
          : undefined,
        p.q
          ? or(
              ilike(dokument.titel, muster(p.q)),
              sql`exists (select 1 from unnest(${dokument.stichworte}) s where s ilike ${muster(p.q)})`,
            )
          : undefined,
        typ,
      ),
    )
    .orderBy(desc(dokument.id))
    .limit(limit + 1);
  const eigene: DokumentEintrag[] = zeilen.map((z) => ({
    quelle: "dokument",
    id: z.zeile.id,
    version: z.zeile.version,
    titel: z.zeile.titel,
    stichworte: z.zeile.stichworte,
    teamSichtbar: z.zeile.teamSichtbar,
    datei: z.datei && dateiAnsicht(z.datei),
    art: z.art,
    sharepoint: z.sharepoint,
    erstelltAm: z.zeile.erstelltAm,
  }));

  // Dateien anderer Module (nie bei einem einzelnen Dokument, nie mit Stichwortfilter: nur Dokumente tragen Stichworte)
  const quellen =
    p.id || p.stichworte?.length
      ? []
      : verweiseAnderer(zugriff, dokument.dateiId);
  const andere: DokumentEintrag[] = [];
  let bis: string | null = null;
  if (quellen.length > 0) {
    const kandidaten = await db
      .select({ datei: lagerDatei, art: artSql, sharepoint: sharepointSql })
      .from(lagerDatei)
      .where(
        and(
          eq(lagerDatei.lagerId, lagerId),
          isNull(lagerDatei.geloeschtAm),
          p.nach ? lt(lagerDatei.id, p.nach) : undefined,
          p.q ? ilike(lagerDatei.anzeigename, muster(p.q)) : undefined,
          typ,
          // Eine Datei, die ein Dokument einbindet, steht als Dokument in der Liste
          sql`not exists (select 1 from dokument d where d.datei_id = ${lagerDatei.id} and d.lager_id = ${lagerId} and d.geloescht_am is null)`,
          or(
            ...quellen.map(
              (v) =>
                sql`exists (select 1 from ${tabellenName(v)} v where v.${sql.identifier(v.spalte.name)} = ${lagerDatei.id} and v.lager_id = ${lagerId} and v.geloescht_am is null)`,
            ),
          ),
        ),
      )
      .orderBy(desc(lagerDatei.id))
      .limit(limit);
    if (kandidaten.length === limit) bis = kandidaten[limit - 1]!.datei.id;
    if (kandidaten.length > 0) {
      const ids = kandidaten.map((k) => k.datei.id);
      const quelleVon = new Map<string, string>();
      for (const v of quellen) {
        for (const id of await sichtbarJeVerweis(db, zugriff, v, ids)) {
          if (!quelleVon.has(id)) quelleVon.set(id, getTableName(v.tabelle));
        }
      }
      for (const k of kandidaten) {
        const quelle = quelleVon.get(k.datei.id);
        if (!quelle) continue;
        andere.push({
          quelle,
          id: k.datei.id,
          version: null,
          titel: k.datei.anzeigename,
          stichworte: [],
          teamSichtbar: null,
          datei: dateiAnsicht(k.datei),
          art: k.art,
          sharepoint: k.sharepoint,
          erstelltAm: k.datei.erstelltAm,
        });
      }
    }
  }

  const folge = [...eigene, ...andere]
    .filter((e) => bis === null || e.id >= bis)
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  const seite = folge.slice(0, limit);
  return {
    eintraege: seite,
    naechster: folge.length > limit ? seite[limit - 1]!.id : bis,
  };
}
