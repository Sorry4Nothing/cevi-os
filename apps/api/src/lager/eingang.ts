import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  EINGANG_ARTEN,
  EINGANG_STATUS,
  eingang,
  ressort,
  traktandum,
  user,
} from "../db/schema.js";
import { benachrichtige, type Zustellung } from "./benachrichtigung.js";
import { registriereSuchquelle } from "./suche.js";
import { LagerAntwortFehler, type Tx } from "./sync.js";

// Eingang des Lagers (#383): Ideen, Wünsche, Fragen und Feedback an die Lagerleitung, auf Wunsch anonym. Entscheid des Nutzers (22.11.2026): Anonym heisst echt anonym. Bei einer anonymen Meldung steht nirgends eine Person: keine Konto-ID, keine IP-Adresse, kein Audit, kein genauer Zeitpunkt (nur der Tag), keine ID, die nach Zeit ordnet, kein Eintrag im Änderungsfeed oder im Verlauf (db/schema-lager.ts begründet es). Die Tabelle ist darum nicht im Sync-Kern angemeldet.
//
// Wie die meldende Person die Antwort liest: Beim Senden einer anonymen Meldung erzeugt der Server einen Rückfragecode (100 Bit) und gibt ihn einmal zurück; gespeichert ist nur sein Hash. Mit dem Code fragt die Person Status und Antwort ab (POST .../eingang/status). Die Antwort steht ausserdem an der Meldung selbst, für alle mit eingang.lesen. Es gibt keinen Push an eine anonyme Person (der Server kennt sie nicht). Eine nicht anonyme Meldung behält den Absender (person_id): Die Person liest sie unter .../eingang/eigene, und die Antwort löst einen Push aus.
// Rate-Limit: nur grobe Zähler im Arbeitsspeicher je Lager (anonym) beziehungsweise je Konto (nicht anonym), nie eine Person neben einer anonymen Meldung.

// Suche (#399): Text und Antwort, nur für wen die ganze Liste lesen darf (eingang.lesen). Die Zeile trägt keine Person, und die Suche gibt nur Typ, ID und Text heraus, nie einen Absender. Wer nur senden darf, findet auch die eigenen Meldungen nicht
registriereSuchquelle({
  typ: "eingang",
  recht: "eingang.lesen",
  tabelle: eingang,
  spalten: [eingang.text, eingang.antwort],
  titel: sql`left(${eingang.text}, 80)`,
  aktiv: sql`true`,
});

export const EINGANG_TEXT_MAX = 5000;
// Anonym: höchstens so viele Meldungen und Code-Abfragen je Lager und Stunde; nicht anonym je Konto
export const LIMIT_ANONYM_JE_LAGER = 60;
export const LIMIT_CODE_JE_LAGER = 120;
export const LIMIT_NAMENTLICH_JE_KONTO = 20;
export const FENSTER_MS = 60 * 60 * 1000;

// Ein Zähler im Arbeitsspeicher je Schlüssel. Der Schlüssel einer anonymen Meldung ist die Lager-ID, nie eine Person
// shortcut: ein Neustart setzt den Zähler zurück und mehrere Instanzen zählen getrennt; in die Datenbank, sobald die API auf mehr als einer Instanz läuft (ohne Person, nur Zähler je Lager)
export function erstelleZaehler(max: number, fensterMs = FENSTER_MS) {
  const versuche = new Map<string, number[]>();
  return (schluessel: string) => {
    const jetzt = Date.now();
    const liste = (versuche.get(schluessel) ?? []).filter(
      (t) => jetzt - t < fensterMs,
    );
    const voll = liste.length >= max;
    if (!voll) liste.push(jetzt);
    if (liste.length === 0) versuche.delete(schluessel);
    else versuche.set(schluessel, liste);
    return voll;
  };
}

// 32 Zeichen ohne Verwechslungen (kein 0, O, 1, I): 20 Zeichen sind 100 Bit; 256 ist durch 32 teilbar, die Verteilung bleibt gleich
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function neuerRueckfragecode() {
  const roh = [...randomBytes(20)]
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("");
  return {
    // Gruppen zu vier Zeichen, damit man ihn abschreiben kann
    code: roh.match(/.{4}/g)!.join("-"),
    hash: hashVonCode(roh)!,
  };
}

// Gross- und Kleinschreibung, Bindestriche und Leerzeichen gelten nicht; undefined: so kann kein Code aussehen
export function hashVonCode(eingabe: string) {
  const roh = eingabe.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z2-9]{20}$/.test(roh)) return undefined;
  return createHash("sha256").update(roh).digest("hex");
}

const art = z.enum(EINGANG_ARTEN);
const status = z.enum(EINGANG_STATUS);
const text = z.string().trim().min(1).max(EINGANG_TEXT_MAX);
const version = z.number().int().min(1);

// Strikt: Es gibt kein Feld für Gesundheitsdaten (und keines für eine Person)
export const eingangSenden = z.strictObject({
  art,
  text,
  anonym: z.boolean(),
});
export const eingangAendern = z
  .strictObject({
    version,
    status: status.optional(),
    // null nimmt die Antwort zurück
    antwort: text.nullable().optional(),
    ressortId: z.uuid().nullable().optional(),
    traktandumId: z.uuid().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const eingangStatusAbfrage = z.strictObject({
  code: z.string().min(1).max(64),
});
export const eingangTraktandum = z.strictObject({
  version,
  titel: z.string().trim().min(1).max(200),
  hoeckId: z.uuid().nullable().optional(),
});
export const eingangListe = z.strictObject({
  status: status.optional(),
  art: art.optional(),
  // Cursor: die ID der letzten Meldung der vorigen Seite
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const eigeneListe = z.strictObject({
  nach: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const eingangVersionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

export type EingangZeile = typeof eingang.$inferSelect;

// Was die Lagerleitung sieht: nie eine Person bei einer anonymen Meldung (von ist dort null), nie den Hash des Codes
export const eingangAnsicht = (z: EingangZeile) => ({
  id: z.id,
  version: z.version,
  art: z.art,
  text: z.text,
  anonym: z.anonym,
  status: z.status,
  antwort: z.antwort,
  beantwortetTag: z.beantwortetTag,
  erstelltTag: z.erstelltTag,
  ressortId: z.ressortId,
  traktandumId: z.traktandumId,
});

// Was die meldende Person unter «eigene» sieht
const eigeneAnsicht = (z: EingangZeile) => ({
  id: z.id,
  art: z.art,
  text: z.text,
  status: z.status,
  antwort: z.antwort,
  beantwortetTag: z.beantwortetTag,
  erstelltTag: z.erstelltTag,
});

// Was der Rückfragecode zeigt: Status und Antwort, nicht die ID der Meldung
export const codeAnsicht = (z: EingangZeile) => ({
  art: z.art,
  status: z.status,
  antwort: z.antwort,
  beantwortetTag: z.beantwortetTag,
  erstelltTag: z.erstelltTag,
});

// Die Seite hinter «nach»: (Tag, ID) kleiner als die der letzten Zeile. Die IDs sind zufällig, die Reihenfolge am selben Tag sagt also nichts über die Zeit; ist die Zeile unbekannt, bleibt die Seite leer
const nachCursor = (lagerId: string, nach: string | undefined) =>
  nach
    ? sql`(${eingang.erstelltTag}, ${eingang.id}) < (select e.erstellt_tag, e.id from eingang e where e.id = ${nach} and e.lager_id = ${lagerId})`
    : undefined;

// Eine Abfrage je Seite; die Person kommt nur bei einer nicht anonymen Meldung mit (Verbund auf person_id, das bei einer anonymen Meldung leer ist)
export async function ladeEingaenge(
  db: Pick<Db, "select">,
  lagerId: string,
  p: {
    id?: string;
    status?: (typeof EINGANG_STATUS)[number];
    art?: (typeof EINGANG_ARTEN)[number];
    nach?: string;
    limit: number;
  },
) {
  const zeilen = await db
    .select({ zeile: eingang, name: user.name, ceviName: user.ceviName })
    .from(eingang)
    .leftJoin(user, eq(user.id, eingang.personId))
    .where(
      and(
        eq(eingang.lagerId, lagerId),
        p.id ? eq(eingang.id, p.id) : undefined,
        p.status ? eq(eingang.status, p.status) : undefined,
        p.art ? eq(eingang.art, p.art) : undefined,
        nachCursor(lagerId, p.nach),
      ),
    )
    .orderBy(desc(eingang.erstelltTag), desc(eingang.id))
    .limit(p.limit + 1);
  const seite = zeilen.slice(0, p.limit);
  return {
    eintraege: seite.map((z) => ({
      ...eingangAnsicht(z.zeile),
      von: z.zeile.personId
        ? {
            id: z.zeile.personId,
            name: z.name,
            ceviName: z.ceviName,
          }
        : null,
    })),
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.zeile.id : null,
  };
}

export async function ladeEigene(
  db: Pick<Db, "select">,
  lagerId: string,
  personId: string,
  p: { nach?: string; limit: number },
) {
  const zeilen = await db
    .select()
    .from(eingang)
    .where(
      and(
        eq(eingang.lagerId, lagerId),
        eq(eingang.personId, personId),
        nachCursor(lagerId, p.nach),
      ),
    )
    .orderBy(desc(eingang.erstelltTag), desc(eingang.id))
    .limit(p.limit + 1);
  const seite = zeilen.slice(0, p.limit);
  return {
    eintraege: seite.map(eigeneAnsicht),
    naechster: zeilen.length > p.limit ? seite[p.limit - 1]!.id : null,
  };
}

export async function ladeEingangZeile(
  db: Pick<Db, "select">,
  lagerId: string,
  id: string,
) {
  const [zeile] = await db
    .select()
    .from(eingang)
    .where(and(eq(eingang.id, id), eq(eingang.lagerId, lagerId)));
  return zeile;
}

export async function ladeNachCode(
  db: Pick<Db, "select">,
  lagerId: string,
  hash: string,
) {
  const [zeile] = await db
    .select()
    .from(eingang)
    .where(
      and(eq(eingang.lagerId, lagerId), eq(eingang.rueckfragecodeHash, hash)),
    );
  return zeile;
}

// Legt die Meldung an. Anonym: keine Person, dafür der Hash des Codes, der einmal an die Antwort kommt
export async function sendeEingang(
  db: Pick<Db, "insert">,
  lagerId: string,
  personId: string,
  felder: z.output<typeof eingangSenden>,
) {
  const code = felder.anonym ? neuerRueckfragecode() : undefined;
  const [zeile] = await db
    .insert(eingang)
    .values({
      lagerId,
      art: felder.art,
      text: felder.text,
      anonym: felder.anonym,
      personId: felder.anonym ? null : personId,
      rueckfragecodeHash: code?.hash ?? null,
    })
    .returning();
  return { zeile: zeile!, rueckfragecode: code?.code };
}

export type EingangFehler = "RESSORT_UNBEKANNT" | "TRAKTANDUM_UNBEKANNT";

// Ressort und Traktandum gibt es in diesem Lager und sind nicht gelöscht (Ziele aus der Anfrage sind nie ein Nachweis, SR-11); die Fremdschlüssel halten dasselbe noch einmal fest
export async function pruefeEingangZiele(
  tx: Pick<Db, "select">,
  lagerId: string,
  werte: { ressortId?: string | null; traktandumId?: string | null },
): Promise<EingangFehler | undefined> {
  if (typeof werte.ressortId === "string") {
    const [r] = await tx
      .select({ id: ressort.id })
      .from(ressort)
      .where(
        and(
          eq(ressort.id, werte.ressortId),
          eq(ressort.lagerId, lagerId),
          sql`${ressort.geloeschtAm} is null`,
        ),
      );
    if (!r) return "RESSORT_UNBEKANNT";
  }
  if (typeof werte.traktandumId === "string") {
    const [t] = await tx
      .select({ id: traktandum.id })
      .from(traktandum)
      .where(
        and(
          eq(traktandum.id, werte.traktandumId),
          eq(traktandum.lagerId, lagerId),
          sql`${traktandum.geloeschtAm} is null`,
        ),
      );
    if (!t) return "TRAKTANDUM_UNBEKANNT";
  }
  return undefined;
}

// Ändert Status, Antwort und Zuordnung unter der Version (409 VERSION_KONFLIKT wie im Sync-Kern, aber ohne Feed). Eine neue oder geänderte Antwort bekommt den heutigen Tag; die Antwort an eine nicht anonyme Meldung benachrichtigt die Person (Art eingang_antwort, nur Lagertitel, nie der Text)
export async function aendereEingang(
  tx: Tx,
  k: { lagerId: string; personId: string },
  id: string,
  eingabe: z.output<typeof eingangAendern>,
): Promise<{ zeile: EingangZeile; zustellung?: Zustellung }> {
  const { version: erwartet, antwort, ...rest } = eingabe;
  const alt = await ladeEingangZeile(tx, k.lagerId, id);
  const antwortGeaendert = antwort !== undefined && antwort !== alt?.antwort;
  const werte = {
    ...rest,
    ...(antwort !== undefined && {
      antwort,
      beantwortetTag: antwort === null ? null : sql`current_date`,
    }),
  };
  const [zeile] = await tx
    .update(eingang)
    .set({ ...werte, version: sql`${eingang.version} + 1` })
    .where(
      and(
        eq(eingang.id, id),
        eq(eingang.lagerId, k.lagerId),
        eq(eingang.version, erwartet),
      ),
    )
    .returning();
  if (!zeile) {
    const aktuell = alt ?? (await ladeEingangZeile(tx, k.lagerId, id));
    if (!aktuell) throw new HTTPException(404);
    const stand = eingangAnsicht(aktuell) as Record<string, unknown>;
    const gewollt: Record<string, unknown> = { ...rest };
    if (antwort !== undefined) gewollt.antwort = antwort;
    throw new LagerAntwortFehler(409, {
      code: "VERSION_KONFLIKT",
      message: "Die Meldung wurde inzwischen geändert.",
      aktuell: stand,
      abweichend: Object.keys(gewollt).filter(
        (feld) =>
          feld in stand &&
          JSON.stringify(stand[feld]) !== JSON.stringify(gewollt[feld]),
      ),
    });
  }
  let zustellung: Zustellung | undefined;
  if (antwortGeaendert && antwort !== null && zeile.personId) {
    zustellung = await benachrichtige(tx, {
      lagerId: k.lagerId,
      empfaengerIds: [zeile.personId],
      art: "eingang_antwort",
      objekt: { typ: "eingang", id: zeile.id },
      ausgeloestVon: k.personId,
    });
  }
  return { zeile, zustellung };
}
