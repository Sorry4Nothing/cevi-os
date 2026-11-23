import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { ladenArtikel, ladenEinstellung, medium } from "../db/schema.js";
import type { Person } from "../rechte.js";
import type { Datenquelle } from "../website/abgleich.js";

// Lädeli (#566): Regeln, Schemas und Abfragen, die Routen und Website teilen.
// Offen und darum als Annahme gebaut (vom Nutzer zu bestätigen): bestellen darf jede angemeldete Person der Abteilung; die Bestellung ist verbindlich, bezahlt wird bei der Übergabe; es gibt keinen Lagerbestand.

// Wer Artikel pflegt und Bestellungen bearbeitet: die Abteilungsleitung, also ein Admin mit zweitem Faktor (den verlangt schon der Pfad /api/v1/admin/*). Kommt eine eigene Rolle dazu, ändert sich nur diese Funktion
export const darfLadenVerwalten = (person: Pick<Person, "admin">) =>
  person.admin;

// Obergrenzen gegen Missbrauch und Tippfehler
export const MAX_ARTIKEL = 200;
export const MAX_VARIANTEN = 20;
export const MAX_POSITIONEN = 20;
export const MAX_MENGE = 10;
// So viele Bestellungen einer Person dürfen zugleich offen oder bereit sein
export const MAX_OFFENE_JE_PERSON = 5;
export const MAX_UEBERGABEARTEN = 5;
export const UEBERGABE_VORGABE = ["Abholung im Lädeli"];
// Abgeschlossene Bestellungen (übergeben, storniert) bleiben so lange, damit Umtausch und Rückfragen über zwei Verkaufstermine hinweg möglich sind; wie die Anmeldungen zu Anlässen
export const AUFBEWAHRUNG_TAGE = 180;
// Bestellungen, die nie abgeschlossen wurden, fallen nach einem Jahr ohne Änderung weg
export const AUFBEWAHRUNG_OFFEN_TAGE = 365;

export const STATUS = ["offen", "bereit", "uebergeben", "storniert"] as const;
export type Status = (typeof STATUS)[number];
// Erlaubte Wechsel in der Verwaltung; übergeben und storniert sind endgültig
export const WECHSEL: Record<Status, readonly Status[]> = {
  offen: ["bereit", "uebergeben", "storniert"],
  bereit: ["offen", "uebergeben", "storniert"],
  uebergeben: [],
  storniert: [],
};

// Steuerzeichen gehören in keinen Text
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/\p{Cc}/u.test(s));
const eindeutig = (liste: string[]) =>
  new Set(liste.map((s) => s.toLocaleLowerCase("de-CH"))).size === liste.length;

// Pflichtangabe «Grösse»: ausdrücklich «Einheitsgrösse» (gespeichert als leere Liste) oder eine Liste mit mindestens zwei Einträgen. Die Art wird nicht gespeichert, sie folgt aus der Liste
export const GROESSENART = ["einheit", "liste"] as const;
const groessenart = z.enum(GROESSENART);
export const GROESSE_FEHLT = {
  code: "GROESSE_FEHLT",
  feld: "groessenart",
  message:
    "Gib die Grösse an: Einheitsgrösse oder eine Liste mit mindestens zwei Grössen.",
} as const;
export const GROESSE_UNGUELTIG = {
  code: "GROESSE_UNGUELTIG",
  feld: "varianten",
  message:
    "Eine Liste braucht mindestens zwei verschiedene Grössen. Gibt es nur eine, wähle Einheitsgrösse.",
} as const;
// Liefert den Fehler oder die Liste, die gespeichert wird (null: nichts zu ändern). Beim Anlegen ist die Art Pflicht; beim Ändern bleibt ohne Art und ohne Liste alles, wie es ist
export function pruefeGroesse(
  b: { groessenart?: (typeof GROESSENART)[number]; varianten?: string[] },
  anlegen: boolean,
):
  | { fehler: typeof GROESSE_FEHLT | typeof GROESSE_UNGUELTIG }
  | { varianten: string[] | null } {
  if (b.groessenart === undefined) {
    return anlegen || b.varianten !== undefined
      ? { fehler: GROESSE_FEHLT }
      : { varianten: null };
  }
  if (b.groessenart === "einheit") {
    return b.varianten !== undefined && b.varianten.length > 0
      ? { fehler: GROESSE_UNGUELTIG }
      : { varianten: [] };
  }
  return b.varianten !== undefined && b.varianten.length >= 2
    ? { varianten: b.varianten }
    : { fehler: GROESSE_UNGUELTIG };
}

// Verfügbarkeit je Grösse (#629): «nichtVerfuegbar» nennt die Grössen aus «varianten», die gerade nicht zu haben sind. Es gibt keinen Lagerbestand, nur diese Meldung je Grösse
export const NICHT_VERFUEGBAR_UNGUELTIG = {
  code: "NICHT_VERFUEGBAR_UNGUELTIG",
  feld: "nichtVerfuegbar",
  message:
    "Nur Grössen aus der Liste lassen sich als nicht verfügbar melden. Prüfe die Schreibweise.",
} as const;
// Der Artikel ist bestellbar, wenn er verfügbar gesetzt ist und (bei einer Liste) mindestens eine Grösse zu haben ist
export const artikelVerfuegbar = (
  a: Pick<Artikel, "verfuegbar" | "varianten" | "nichtVerfuegbar">,
) =>
  a.verfuegbar &&
  (a.varianten.length === 0 ||
    a.varianten.some((v) => !a.nichtVerfuegbar.includes(v)));
// Liefert den Fehler oder die Liste, die gespeichert wird (null: nichts zu ändern). groesse ist das Ergebnis von pruefeGroesse, bisher der gespeicherte Stand (beim Ändern). Wechselt die Liste der Grössen, ohne dass «nichtVerfuegbar» mitkommt, bleiben nur die Meldungen zu Grössen, die es noch gibt
export function pruefeNichtVerfuegbar(
  b: { nichtVerfuegbar?: string[] },
  groesse: { varianten: string[] | null },
  bisher: { varianten: string[]; nichtVerfuegbar: string[] } | null,
):
  | { fehler: typeof NICHT_VERFUEGBAR_UNGUELTIG }
  | { nichtVerfuegbar: string[] | null } {
  const vorhanden = groesse.varianten ?? bisher?.varianten ?? [];
  if (b.nichtVerfuegbar !== undefined) {
    return b.nichtVerfuegbar.every((v) => vorhanden.includes(v))
      ? { nichtVerfuegbar: b.nichtVerfuegbar }
      : { fehler: NICHT_VERFUEGBAR_UNGUELTIG };
  }
  return groesse.varianten !== null && bisher
    ? {
        nichtVerfuegbar: bisher.nichtVerfuegbar.filter((v) =>
          vorhanden.includes(v),
        ),
      }
    : { nichtVerfuegbar: null };
}

const artikelFelder = {
  name: text(100),
  preisRappen: z.number().int().min(0).max(1_000_000),
  mediumId: z.uuid().nullable(),
  varianten: z.array(text(40)).max(MAX_VARIANTEN).refine(eindeutig),
  nichtVerfuegbar: z.array(text(40)).max(MAX_VARIANTEN).refine(eindeutig),
  hinweis: text(200).nullable(),
  verfuegbar: z.boolean(),
};
export const artikelAnlegenSchema = z.strictObject({
  name: artikelFelder.name,
  preisRappen: artikelFelder.preisRappen,
  groessenart: groessenart.optional(),
  mediumId: artikelFelder.mediumId.optional(),
  varianten: artikelFelder.varianten.optional(),
  nichtVerfuegbar: artikelFelder.nichtVerfuegbar.optional(),
  hinweis: artikelFelder.hinweis.optional(),
  verfuegbar: artikelFelder.verfuegbar.optional(),
});
// Die Reihenfolge der Artikel setzt nur die Liste: Ein Aufruf nennt die Artikel in der neuen Folge; der Server vergibt 0, 1, 2 … ohne Lücken. Artikel, die fehlen, folgen am Ende in ihrer bisherigen Folge
export const reihenfolgeSchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(MAX_ARTIKEL)
    .refine((l) => new Set(l).size === l.length),
});
// Ohne Schlüssel bleibt der Wert; null löscht Bild und Hinweis
export const artikelAendernSchema = z.strictObject({
  ...(Object.fromEntries(
    Object.entries(artikelFelder).map(([n, s]) => [n, s.optional()]),
  ) as {
    [K in keyof typeof artikelFelder]: z.ZodOptional<(typeof artikelFelder)[K]>;
  }),
  groessenart: groessenart.optional(),
});

export const einstellungSchema = z.strictObject({
  uebergabearten: z
    .array(text(80))
    .min(1)
    .max(MAX_UEBERGABEARTEN)
    .refine(eindeutig),
});

// Eine Bestellung nennt nur Artikel, Variante und Menge: Name, Preis und Summe liest der Server aus den Artikeln
export const bestellenSchema = z.strictObject({
  positionen: z
    .array(
      z.strictObject({
        artikelId: z.uuid(),
        variante: text(40).nullable().optional(),
        menge: z.number().int().min(1).max(MAX_MENGE),
      }),
    )
    .min(1)
    .max(MAX_POSITIONEN),
  uebergabe: text(80),
  // Die Summe, die die Person gesehen hat: Weicht sie ab (ein Preis hat sich geändert), entsteht keine Bestellung
  erwarteteSummeRappen: z.number().int().min(0).optional(),
});

export const listeSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  nach: z.uuid().optional(),
});

export type Artikel = typeof ladenArtikel.$inferSelect;
export const artikelAnsicht = (a: Artikel) => ({
  id: a.id,
  name: a.name,
  preisRappen: a.preisRappen,
  mediumId: a.mediumId,
  groessenart:
    a.varianten.length > 0 ? ("liste" as const) : ("einheit" as const),
  varianten: a.varianten,
  nichtVerfuegbar: a.nichtVerfuegbar,
  hinweis: a.hinweis,
  // Für Anzeige und Bestellung: nicht verfügbar ist auch ein Artikel, dessen Grössen alle nicht zu haben sind
  verfuegbar: artikelVerfuegbar(a),
  // Der Schalter des Artikels selbst, wie ihn die Verwaltung gesetzt hat
  verfuegbarGesetzt: a.verfuegbar,
  reihenfolge: a.reihenfolge,
});

// Alle Artikel der Abteilung in der Reihenfolge des Ladens; eine Abfrage
export const ladeArtikel = (
  db: Db,
  abteilungId: string,
  nurVerfuegbar = false,
) =>
  db
    .select()
    .from(ladenArtikel)
    .where(
      and(
        eq(ladenArtikel.abteilungId, abteilungId),
        nurVerfuegbar ? eq(ladenArtikel.verfuegbar, true) : undefined,
      ),
    )
    .orderBy(asc(ladenArtikel.reihenfolge), asc(ladenArtikel.name))
    .limit(MAX_ARTIKEL);

export async function ladeUebergabearten(
  db: Pick<Db, "select">,
  abteilungId: string,
): Promise<string[]> {
  const [zeile] = await db
    .select({ arten: ladenEinstellung.uebergabearten })
    .from(ladenEinstellung)
    .where(eq(ladenEinstellung.abteilungId, abteilungId));
  return zeile?.arten ?? UEBERGABE_VORGABE;
}

// Das Bild eines Artikels muss ein öffentliches Bild der Abteilung sein: Der Laden steht auf einer öffentlichen Seite
export async function istLadenBild(db: Db, abteilungId: string, id: string) {
  const [m] = await db
    .select({ id: medium.id })
    .from(medium)
    .where(
      and(
        eq(medium.id, id),
        eq(medium.abteilungId, abteilungId),
        eq(medium.sichtbarkeit, "oeffentlich"),
        sql`${medium.mimeTyp} like 'image/%'`,
      ),
    );
  return m !== undefined;
}

// «CHF 40.–», «CHF 12.50» und «gratis», wie der Laden und die Verwaltung im Browser (public/website/laden.js: preisText)
export function preisText(rappen: number): string {
  if (rappen === 0) return "gratis";
  const franken = Math.floor(rappen / 100)
    .toString()
    .replace(/\B(?=(\d{3})+$)/g, "’");
  const rest = rappen % 100;
  return `CHF ${franken}.${rest === 0 ? "–" : String(rest).padStart(2, "0")}`;
}

// Website: Hat eine Seite den Baustein «laden», kommen die Artikel der Abteilung und ihre Bilder in die Daten des Renderers. Drei Abfragen je Lauf des Abgleichs (Artikel, Übergabearten, Bilder), keine je Besuch
export const ladeLadenDaten: Datenquelle = async (
  db,
  abteilungId,
  _seitenIds,
  dokumente,
) => {
  const gebraucht = [...(dokumente?.values() ?? [])].some((d) =>
    d.bausteine.some((b) => b.typ === "laden"),
  );
  if (!gebraucht) return {};
  const [artikel, uebergabearten] = await Promise.all([
    ladeArtikel(db, abteilungId),
    ladeUebergabearten(db, abteilungId),
  ]);
  const bildIds = artikel.flatMap((a) => (a.mediumId ? [a.mediumId] : []));
  const bilder =
    bildIds.length === 0
      ? []
      : await db
          .select()
          .from(medium)
          .where(
            and(
              eq(medium.abteilungId, abteilungId),
              eq(medium.sichtbarkeit, "oeffentlich"),
              inArray(medium.id, bildIds),
            ),
          );
  // Maps, weil der Abgleich die Einträge der Quellen je Schlüssel zusammenführt; die Reihenfolge der Artikel bleibt die der Abfrage
  return {
    laden: new Map(artikel.map((a) => [a.id, artikelAnsicht(a)])),
    ladenUebergabe: new Map(uebergabearten.map((u) => [u, true as const])),
    medien: new Map(
      bilder.map((m) => [
        m.id,
        {
          mimeTyp: m.mimeTyp,
          groesse: m.groesse,
          breite: m.breite,
          hoehe: m.hoehe,
          altText: m.altText,
        },
      ]),
    ),
  };
};

// Löscht abgeschlossene Bestellungen nach der Frist und nie abgeschlossene nach einem Jahr ohne Änderung; die Positionen gehen mit (CASCADE). Eine Abfrage. Das Audit-Log führt nur Kennungen, also bleibt nichts zurück. Liefert die Zahl gelöschter Bestellungen
export async function loescheAlteBestellungen(
  db: Db,
  jetzt = new Date(),
): Promise<number> {
  const zeilen = await db.execute<{ n: number }>(sql`
    with weg as (
      delete from laden_bestellung
      where abgeschlossen_am < ${jetzt.toISOString()}::timestamptz - make_interval(days => ${AUFBEWAHRUNG_TAGE})
         or (abgeschlossen_am is null and geaendert_am < ${jetzt.toISOString()}::timestamptz - make_interval(days => ${AUFBEWAHRUNG_OFFEN_TAGE}))
      returning 1
    )
    select count(*)::int as n from weg
  `);
  return zeilen[0]?.n ?? 0;
}
