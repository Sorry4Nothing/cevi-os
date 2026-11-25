import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { abzaehlen, kind, teilnehmer } from "../db/schema.js";
import { registriereSuchquelle } from "./suche.js";
import { loescheZeilen, type Tx } from "./sync.js";
import { registriereLagerTabelle } from "./tabellen.js";

// Teilnehmende und Abzählen des Lagers (#384). Beide Tabellen sind beim ersten Import dieser Datei im Register des Sync-Kerns angemeldet (Feed: nur mit teilnehmer.lesen, kein Zeilenfilter; der Feed nennt nur IDs).
for (const tabelle of [teilnehmer, abzaehlen]) {
  registriereLagerTabelle({ tabelle, recht: "teilnehmer.lesen" });
}

// Suche (#399): Vor- und Nachname, wie ihn jede Rolle mit teilnehmer.lesen in der Liste sieht. Der Cevi-Name sieht nur, wer bearbeiten darf: Er ist nicht durchsuchbar (sonst liesse er sich über die Suche erraten)
registriereSuchquelle({
  typ: "teilnehmer",
  recht: "teilnehmer.lesen",
  tabelle: teilnehmer,
  spalten: [teilnehmer.vorname, teilnehmer.nachname],
  titel: sql`${teilnehmer.vorname} || ' ' || ${teilnehmer.nachname}`,
});

// Wer nur lesen darf (Team, Leitung, Lesen), sieht Vorname, Nachname, Stufe und ob die Person abgewählt («nicht dabei», #387) ist, sonst nichts. Wer bearbeiten darf, sieht zusätzlich den Cevi-Namen (Anzeigename für Aushänge). Keine Gesundheitsdaten, kein Telefon, keine Adresse: Es gibt dafür kein Feld
export const teilnehmerKurz = (r: typeof teilnehmer.$inferSelect) => ({
  id: r.id,
  version: r.version,
  vorname: r.vorname,
  nachname: r.nachname,
  stufe: r.stufe,
  abgewaehlt: r.abgewaehlt,
});
export const teilnehmerVoll = (r: typeof teilnehmer.$inferSelect) => ({
  ...teilnehmerKurz(r),
  ceviName: r.ceviName,
});

// Eingaben: strikt, nur die genannten Felder (SR-72); Leerzeichen am Rand fallen weg, Umlaute werden zusammengesetzt (NFC), Steuerzeichen sind verboten
const text = (max: number) =>
  z
    .string()
    .transform((w) => w.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine((w) => !/\p{Cc}/u.test(w)),
    );
const vorname = text(100);
const nachname = text(100);
const stufe = text(50);
const ceviName = text(50);
const version = z.number().int().min(1);

export const teilnehmerAnlegen = z.strictObject({
  vorname,
  nachname,
  stufe: stufe.nullable().optional(),
  ceviName: ceviName.nullable().optional(),
});
export const teilnehmerAendern = z
  .strictObject({
    version,
    vorname: vorname.optional(),
    nachname: nachname.optional(),
    stufe: stufe.nullable().optional(),
    ceviName: ceviName.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 1);
export const versionAbfrage = z.strictObject({
  version: z.coerce.number().int().min(1),
});

// Import (Einfügen aus Excel): höchstens so viele Datenzeilen und Zeichen je Anfrage (SR-71)
export const IMPORT_MAX_ZEILEN = 500;
// 40'000 Zeichen bleiben unter dem allgemeinen Limit von 64 KB je Anfrage (app.ts), auch mit Umlauten; für 500 Personen mit Stufe und Cevi-Name reicht es
export const IMPORT_MAX_ZEICHEN = 40_000;
export const teilnehmerImport = z.strictObject({
  text: z.string().max(IMPORT_MAX_ZEICHEN),
  // false: nur Vorschau, es wird nichts geschrieben
  uebernehmen: z.boolean(),
});

export type ImportZeile = {
  zeile: number;
  vorname: string;
  nachname: string;
  stufe: string | null;
  ceviName: string | null;
};
export type ImportFehler = {
  zeile: number;
  code:
    | "ZU_WENIG_SPALTEN"
    | "ZU_VIELE_SPALTEN"
    | "VORNAME_FEHLT"
    | "NACHNAME_FEHLT"
    | "ZU_LANG"
    | "STEUERZEICHEN";
  message: string;
};
const FEHLER_TEXT: Record<ImportFehler["code"], string> = {
  ZU_WENIG_SPALTEN:
    "Die Zeile braucht mindestens Vorname und Nachname, getrennt durch Tab oder Semikolon.",
  ZU_VIELE_SPALTEN:
    "Die Zeile hat mehr als vier Spalten (Vorname, Nachname, Stufe, Cevi-Name).",
  VORNAME_FEHLT: "Der Vorname fehlt.",
  NACHNAME_FEHLT: "Der Nachname fehlt.",
  ZU_LANG: "Ein Feld ist zu lang (Namen 100, Stufe und Cevi-Name 50 Zeichen).",
  STEUERZEICHEN: "Ein Feld enthält Steuerzeichen.",
};

// Gleiche Person: Vorname, Nachname und Stufe ohne Beachtung der Gross- und Kleinschreibung. Zwei gleiche Namen in verschiedenen Stufen sind verschiedene Personen
export const schluessel = (p: {
  vorname: string;
  nachname: string;
  stufe: string | null;
}) =>
  [p.vorname, p.nachname, p.stufe ?? ""]
    .map((w) => w.normalize("NFC").toLowerCase())
    .join("\u0000");

export type ImportErgebnis = {
  zeilen: ImportZeile[];
  fehler: ImportFehler[];
  // Zeilen, die dieselbe Person schon weiter oben im Text nennen
  doppeltImText: { zeile: number }[];
};

// Das Byte-Order-Mark am Anfang eines eingefügten Texts
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

// Liest eingefügten Text aus einer Tabellenkalkulation: eine Person je Zeile, Spalten Vorname, Nachname, Stufe, Cevi-Name (die letzten beiden freiwillig), getrennt durch Tab; ohne Tab durch Semikolon. Eine Kopfzeile «Vorname; Nachname» wird übersprungen, leere Zeilen auch. Fehlerhafte Zeilen kommen mit ihrer Zeilennummer (ab 1, wie im eingefügten Text) in die Fehlerliste, die übrigen werden trotzdem gelesen. Gibt null zurück, wenn der Text mehr als IMPORT_MAX_ZEILEN Datenzeilen hat
export function leseImport(eingabe: string): ImportErgebnis | null {
  const zeilen = eingabe.replace(BOM, "").split(/\r\n|\r|\n/);
  const trenner = zeilen.some((z) => z.includes("\t")) ? "\t" : ";";
  const ergebnis: ImportErgebnis = {
    zeilen: [],
    fehler: [],
    doppeltImText: [],
  };
  const gesehen = new Set<string>();
  let daten = 0;
  let ersteZeile = true;
  for (const [i, roh] of zeilen.entries()) {
    const nummer = i + 1;
    const zellen = roh.split(trenner).map(zelle);
    while (zellen.length > 0 && zellen[zellen.length - 1] === "") zellen.pop();
    if (zellen.length === 0) continue;
    if (ersteZeile) {
      ersteZeile = false;
      if (
        zellen[0]!.toLowerCase() === "vorname" &&
        zellen[1]?.toLowerCase() === "nachname"
      ) {
        continue;
      }
    }
    if (++daten > IMPORT_MAX_ZEILEN) return null;
    const fehler = (code: ImportFehler["code"]) =>
      ergebnis.fehler.push({ zeile: nummer, code, message: FEHLER_TEXT[code] });
    if (zellen.length < 2) {
      fehler("ZU_WENIG_SPALTEN");
      continue;
    }
    if (zellen.length > 4) {
      fehler("ZU_VIELE_SPALTEN");
      continue;
    }
    const [v, n, s, c] = zellen;
    if (zellen.some((w) => /\p{Cc}/u.test(w))) {
      fehler("STEUERZEICHEN");
      continue;
    }
    if (!v) {
      fehler("VORNAME_FEHLT");
      continue;
    }
    if (!n) {
      fehler("NACHNAME_FEHLT");
      continue;
    }
    if (
      v.length > 100 ||
      n.length > 100 ||
      (s?.length ?? 0) > 50 ||
      (c?.length ?? 0) > 50
    ) {
      fehler("ZU_LANG");
      continue;
    }
    const person = {
      zeile: nummer,
      vorname: v,
      nachname: n,
      stufe: s || null,
      ceviName: c || null,
    };
    const s2 = schluessel(person);
    if (gesehen.has(s2)) {
      ergebnis.doppeltImText.push({ zeile: nummer });
      continue;
    }
    gesehen.add(s2);
    ergebnis.zeilen.push(person);
  }
  return ergebnis;
}

// Eine Zelle: Excel setzt Zellen mit Anführungszeichen oder Zeilenumbruch in «...» (innen ""); Leerraum zusammenfassen, Umlaute in NFC
function zelle(roh: string) {
  let w = roh.trim();
  if (w.length >= 2 && w.startsWith('"') && w.endsWith('"')) {
    w = w.slice(1, -1).replaceAll('""', '"');
  }
  return w.normalize("NFC").replace(/\s+/g, " ").trim();
}

const kindSchluessel = (p: { vorname: string; nachname: string }) =>
  [p.vorname, p.nachname]
    .map((w) => w.normalize("NFC").trim().toLowerCase())
    .join("\u0000");

// Ordnet neue Teilnehmende dem Kind der Abteilung zu (#779): nur bei genau einem Kind mit gleichem Vor- und Nachnamen (ohne Beachtung der Gross- und Kleinschreibung), sonst bleibt kind_id leer; nie raten. Die Zuordnung lässt das Löschen des Kindes die Namenskopien mitnehmen. Gibt je Eintrag die Kind-ID oder null zurück, in der Reihenfolge der Eingabe
export async function ordneKinderZu(
  tx: Pick<Db, "select">,
  abteilungId: string,
  personen: { vorname: string; nachname: string }[],
): Promise<(string | null)[]> {
  if (personen.length === 0) return [];
  const kandidaten = await tx
    .select({ id: kind.id, vorname: kind.vorname, nachname: kind.nachname })
    .from(kind)
    .where(
      and(
        eq(kind.abteilungId, abteilungId),
        inArray(sql`lower(${kind.nachname})`, [
          ...new Set(personen.map((p) => p.nachname.toLowerCase())),
        ]),
      ),
    );
  const je = new Map<string, string[]>();
  for (const k of kandidaten) {
    const s = kindSchluessel(k);
    je.set(s, [...(je.get(s) ?? []), k.id]);
  }
  return personen.map((p) => {
    const treffer = je.get(kindSchluessel(p));
    return treffer?.length === 1 ? treffer[0]! : null;
  });
}

// Löscht die Teilnehmenden, die an einem Kind hängen (#779), in allen Lagern samt Einteilung, Abzählen, Anwesenheit und Fahrten (Fremdschlüssel von dort mit CASCADE); der Feed meldet «geloescht», damit Apps die Zeilen entfernen. Läuft in der Transaktion, die das Kind löscht. Liefert die Zahl der Lager und der Teilnehmenden
export async function loescheTeilnehmendeDesKindes(
  tx: Tx,
  kindId: string,
  personId: string,
) {
  const zeilen = await tx
    .select({ id: teilnehmer.id, lagerId: teilnehmer.lagerId })
    .from(teilnehmer)
    .where(eq(teilnehmer.kindId, kindId))
    // Feste Reihenfolge der Lagersperren: zwei gleichzeitige Löschvorgänge blockieren sich nicht gegenseitig
    .orderBy(teilnehmer.lagerId);
  const lager = new Map<string, string[]>();
  for (const z of zeilen) {
    lager.set(z.lagerId, [...(lager.get(z.lagerId) ?? []), z.id]);
  }
  for (const [lagerId, ids] of lager) {
    await loescheZeilen(tx, teilnehmer, { lagerId, personId }, { ids });
  }
  return { lager: lager.size, teilnehmende: zeilen.length };
}

// Wie lange die Daten der Teilnehmenden nach dem Ende des Lagers bleiben: sechs Monate (altes Datenschutzfenster)
export const AUFBEWAHRUNG_MONATE = 6;

// Löscht die Teilnehmenden aller Lager, die vor mehr als sechs Monaten (nach dem Lagerende) endeten, samt ihrer Haken (Fremdschlüssel mit CASCADE). Eine gebündelte Abfrage für alle Lager, ein Eintrag im Audit-Log je Lager mit nur der Anzahl. Der Änderungsfeed behält nur IDs und läuft nach 30 Tagen aus. Liefert die Zahl gelöschter Teilnehmenden
export async function loescheAlteTeilnehmende(
  db: Db,
  jetzt = new Date(),
  // Nur für Tests, die ihre eigenen Lager prüfen
  nurLager?: string[],
) {
  const heute = jetzt.toISOString().slice(0, 10);
  const eingeschraenkt = nurLager
    ? sql`and l.id in (${sql.join(
        nurLager.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const zeilen = await db.execute<{ n: number }>(sql`
    with betroffen as (
      select l.id, l.abteilung_id from lager l
      where l.bis < (${heute}::date - make_interval(months => ${AUFBEWAHRUNG_MONATE}))
        and exists (select 1 from teilnehmer t where t.lager_id = l.id)
        ${eingeschraenkt}
    ),
    weg as (
      delete from teilnehmer where lager_id in (select id from betroffen)
      returning lager_id
    ),
    je_lager as (
      select lager_id, count(*)::int as n from weg group by lager_id
    ),
    protokoll as (
      insert into audit_log (abteilung_id, akteur_id, aktion, ziel_typ, ziel_id, details)
      select b.abteilung_id, 'system', 'lager_teilnehmende_geloescht', 'lager', b.id, jsonb_build_object('anzahl', j.n)
      from je_lager j join betroffen b on b.id = j.lager_id
      returning 1
    )
    select coalesce(sum(n), 0)::int as n from je_lager`);
  return zeilen[0]?.n ?? 0;
}
