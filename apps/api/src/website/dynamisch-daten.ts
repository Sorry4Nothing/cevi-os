import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { tag, user } from "../db/schema.js";
import { kartenLink } from "../karten-standort.js";
import { TERMIN_BEGINN } from "../termine/sicht.js";
import type { Datenquelle } from "./abgleich.js";
import {
  istDynamisch,
  type DynamischerBaustein,
  type KENNZAHL_ARTEN,
} from "./bausteine-dynamisch.js";
import { hatAussenrolle } from "./personen.js";

// Die Daten der Bausteine aus bausteine-dynamisch.ts (#740). Der Abgleich holt sie beim Erzeugen der Dateien: wenige Abfragen für alle Seiten und Bausteine, nie eine je Seite, Baustein oder Besuch.
// Was die öffentliche Seite zeigt: Anlässe mit Sichtbarkeit «öffentlich», deren Termin aktiv und für Eltern sichtbar ist (dieselbe Regel wie die Termin-Liste); Orte der Bibliothek, die die Seite ausdrücklich wählt; Zahlen ohne Bezug zu einer Person.
// Nie: Anmeldungen, Teilnehmende, Kinder, Notizen, Anlässe anderer Abteilungen. Eine Änderung steht nach dem nächsten Lauf des Abgleichs in der Datei (Veröffentlichen, Ereignis, spätestens 10 Minuten).

export type AnlassInfo = {
  id: string;
  titel: string;
  art: "anlass" | "lager";
  // Tage «JJJJ-MM-TT» und Zeiten «HH:MM» in Zürcher Zeit, schon so aus der Abfrage
  von: string;
  bis: string;
  zeitVon: string | null;
  zeitBis: string | null;
  ort: string | null;
  // Anmeldung ist offen und die Frist nicht abgelaufen (Stand beim Erzeugen)
  anmeldungOffen: boolean;
  fristTag: string | null;
  fristZeit: string | null;
  seiteId: string | null;
  // Adresse der öffentlichen Seite des Anlasses; der Abgleich setzt sie
  seitePfad?: string;
};
export type OrtInfo = {
  name: string;
  beschreibung: string | null;
  karte: string | null;
};
export type Kennzahl = { art: (typeof KENNZAHL_ARTEN)[number]; zahl: number };

// Je Baustein (nach seiner ID) das Ergebnis; fehlt der Eintrag, entfällt der Baustein
export type DynamischErgebnis =
  | { typ: "anlaesse"; anlaesse: AnlassInfo[] }
  | { typ: "countdown"; anlass: AnlassInfo; tage: number; zielTag: string }
  | { typ: "orte"; orte: OrtInfo[] }
  | { typ: "kennzahlen"; zahlen: Kennzahl[] };

// Zahlen unter dieser Grenze zeigt die Website nicht: Wenige Personen wären erkennbar
export const MIN_ANZEIGE_LEITENDE = 3;
// Höchstens so viele Anlässe je Art holt eine Abfrage (die grösste Anzahl der Bausteine)
const MAX_HOLEN = 12;

type Zeile = {
  id: string;
  titel: string;
  art: "anlass" | "lager";
  ort: string | null;
  seite_id: string | null;
  von: string;
  bis: string;
  zeit_von: string | null;
  zeit_bis: string | null;
  anmeldung_offen: boolean;
  frist_tag: string | null;
  frist_zeit: string | null;
  offen_jetzt: boolean;
  kommend: boolean;
};

const zuInfo = (z: Zeile): AnlassInfo => ({
  id: z.id,
  titel: z.titel,
  art: z.art,
  von: z.von,
  bis: z.bis,
  zeitVon: z.zeit_von,
  zeitBis: z.zeit_bis,
  ort: z.ort,
  anmeldungOffen: z.anmeldung_offen && z.offen_jetzt && z.kommend,
  fristTag: z.frist_tag,
  fristZeit: z.frist_zeit,
  seiteId: z.seite_id,
});

const FELDER = sql`
  anlass.id, anlass.art, anlass.seite_id, programm.titel, programm.ort, anlass.anmeldung_offen,
  case when programm.ganztaegig then programm.tag_von::text else to_char(programm.beginn at time zone 'Europe/Zurich', 'YYYY-MM-DD') end as von,
  case when programm.ganztaegig then programm.tag_bis::text else to_char(coalesce(programm.ende, programm.beginn) at time zone 'Europe/Zurich', 'YYYY-MM-DD') end as bis,
  case when programm.ganztaegig then null else to_char(programm.beginn at time zone 'Europe/Zurich', 'HH24:MI') end as zeit_von,
  case when programm.ganztaegig or programm.ende is null then null else to_char(programm.ende at time zone 'Europe/Zurich', 'HH24:MI') end as zeit_bis,
  to_char(anlass.frist at time zone 'Europe/Zurich', 'YYYY-MM-DD') as frist_tag,
  to_char(anlass.frist at time zone 'Europe/Zurich', 'HH24:MI') as frist_zeit,
  (anlass.frist is null or anlass.frist > now()) as offen_jetzt,
  (case when programm.ganztaegig then programm.tag_bis >= (now() at time zone 'Europe/Zurich')::date else programm.ende >= now() end) as kommend`;

// Aktiver Termin für Eltern an einem öffentlichen Anlass der Abteilung: dieselbe Regel wie die Termin-Liste
const OEFFENTLICH = (abteilungId: string) => sql`
  anlass.abteilung_id = ${abteilungId} and programm.abteilung_id = ${abteilungId} and programm.status = 'aktiv'
  and programm.sichtbarkeit = 'eltern' and anlass.sichtbarkeit = 'oeffentlich'`;
const KOMMEND = sql`(case when programm.ganztaegig then programm.tag_bis >= (now() at time zone 'Europe/Zurich')::date else programm.ende >= now() end)`;

const heuteZuerich = (jetzt: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(jetzt);
// Ganze Tage von «heute» bis «tag» (beide JJJJ-MM-TT)
export const tageBis = (heute: string, tag: string) =>
  Math.round(
    (Date.parse(`${tag}T00:00:00Z`) - Date.parse(`${heute}T00:00:00Z`)) /
      86_400_000,
  );

const uuidListe = (ids: string[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );

export const ladeDynamischeBausteine: Datenquelle = async (
  db,
  abteilungId,
  _seitenIds,
  dokumente,
  jetzt = new Date(),
) => {
  const dynamisch = new Map<string, DynamischErgebnis>();
  const bausteine: DynamischerBaustein[] = [];
  for (const dok of dokumente?.values() ?? []) {
    bausteine.push(...dok.bausteine.filter(istDynamisch));
  }
  if (bausteine.length === 0) return { dynamisch };

  // Anlässe: die gewählten und die jeweils nächsten öffentlichen (je Art höchstens MAX_HOLEN, in einer Abfrage)
  const gewaehlt = [
    ...new Set(
      bausteine.flatMap((b) =>
        (b.typ === "naechsterAnlass" ||
          b.typ === "lagerkarte" ||
          b.typ === "countdown") &&
        b.daten.anlassId
          ? [b.daten.anlassId.toLowerCase()]
          : [],
      ),
    ),
  ];
  const braucheNaechste = bausteine.some(
    (b) =>
      b.typ === "anlaesse" ||
      ((b.typ === "naechsterAnlass" || b.typ === "countdown") &&
        !b.daten.anlassId),
  );
  const einzeln = new Map<string, AnlassInfo>();
  const kommende: Record<"anlass" | "lager", AnlassInfo[]> = {
    anlass: [],
    lager: [],
  };
  if (gewaehlt.length > 0) {
    const zeilen = await db.execute<Zeile>(sql`
      select ${FELDER} from anlass join programm on programm.id = anlass.programm_id
      where ${OEFFENTLICH(abteilungId)} and anlass.id in (${uuidListe(gewaehlt)})`);
    for (const z of zeilen) einzeln.set(z.id, zuInfo(z));
  }
  if (braucheNaechste) {
    const zeilen = await db.execute<Zeile & { rn: number }>(sql`
      select * from (
        select ${FELDER}, row_number() over (partition by anlass.art order by ${TERMIN_BEGINN}, anlass.id) as rn
        from anlass join programm on programm.id = anlass.programm_id
        where ${OEFFENTLICH(abteilungId)} and ${KOMMEND}
      ) t where rn <= ${MAX_HOLEN} order by rn`);
    for (const z of zeilen) kommende[z.art].push(zuInfo(z));
  }
  const nachBeginn = (a: AnlassInfo, b: AnlassInfo) =>
    `${a.von} ${a.zeitVon ?? ""}`.localeCompare(
      `${b.von} ${b.zeitVon ?? ""}`,
    ) || a.id.localeCompare(b.id);
  const naechste = (art?: "anlass" | "lager") =>
    (art ? kommende[art] : [...kommende.anlass, ...kommende.lager]).sort(
      nachBeginn,
    );

  // Orte der Bibliothek: nur aktive Orte dieser Abteilung, in der Reihenfolge, die der Baustein wählt
  const ortIds = [
    ...new Set(
      bausteine.flatMap((b) =>
        b.typ === "treffpunkte"
          ? b.daten.ortIds.map((i) => i.toLowerCase())
          : [],
      ),
    ),
  ];
  const orte = new Map<string, OrtInfo>();
  if (ortIds.length > 0) {
    const zeilen = await db.execute<{
      id: string;
      name: string;
      beschreibung: string | null;
      karte_adresse: string | null;
      breite: number | null;
      laenge: number | null;
      karte_url: string | null;
    }>(sql`
      select id, name, beschreibung, karte_adresse, breite, laenge, karte_url from ort
      where abteilung_id = ${abteilungId} and aktiv and id in (${uuidListe(ortIds)})`);
    for (const z of zeilen) {
      orte.set(z.id, {
        name: z.name,
        beschreibung: z.beschreibung,
        karte: kartenLink({
          adresse: z.karte_adresse,
          breite: z.breite,
          laenge: z.laenge,
          url: z.karte_url,
        }),
      });
    }
  }

  // Zahlen: ein Zähler je Art, nur wenn ein Baustein ihn braucht; nie eine Person, nie ein Kind
  const gebraucht = new Set(
    bausteine.flatMap((b) => (b.typ === "kennzahlen" ? b.daten.zahlen : [])),
  );
  const zahlen = new Map<(typeof KENNZAHL_ARTEN)[number], number>();
  if (gebraucht.has("stufen")) {
    const [z] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tag)
      .where(and(eq(tag.abteilungId, abteilungId), eq(tag.typ, "stufe")));
    zahlen.set("stufen", z?.n ?? 0);
  }
  if (gebraucht.has("leitende")) {
    const [z] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(user)
      .where(
        and(
          eq(user.abteilungId, abteilungId),
          isNull(user.deaktiviertAm),
          sql`${user.banned} is not true`,
          isNotNull(user.ceviName),
          hatAussenrolle,
        ),
      );
    zahlen.set("leitende", z?.n ?? 0);
  }
  if (gebraucht.has("anlaesse")) {
    const [z] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from anlass join programm on programm.id = anlass.programm_id
      where ${OEFFENTLICH(abteilungId)} and ${KOMMEND}`);
    zahlen.set("anlaesse", z?.n ?? 0);
  }

  const heute = heuteZuerich(jetzt);
  for (const b of bausteine) {
    switch (b.typ) {
      case "naechsterAnlass": {
        const a = b.daten.anlassId
          ? einzeln.get(b.daten.anlassId.toLowerCase())
          : naechste(b.daten.art)[0];
        if (a) dynamisch.set(b.id, { typ: "anlaesse", anlaesse: [a] });
        break;
      }
      case "lagerkarte": {
        const a = einzeln.get(b.daten.anlassId.toLowerCase());
        if (a) dynamisch.set(b.id, { typ: "anlaesse", anlaesse: [a] });
        break;
      }
      case "anlaesse": {
        const liste = naechste(b.daten.art).slice(0, b.daten.anzahl);
        dynamisch.set(b.id, { typ: "anlaesse", anlaesse: liste });
        break;
      }
      case "countdown": {
        const a = b.daten.anlassId
          ? einzeln.get(b.daten.anlassId.toLowerCase())
          : naechste()[0];
        // Ziel: der erste Tag des Anlasses oder der Tag der Anmeldefrist; liegt es hinter uns, entfällt der Baustein
        const zielTag = b.daten.bis === "frist" ? a?.fristTag : a?.von;
        if (!a || !zielTag || (b.daten.bis === "frist" && !a.anmeldungOffen)) {
          break;
        }
        const tage = tageBis(heute, zielTag);
        if (tage >= 0) {
          dynamisch.set(b.id, { typ: "countdown", anlass: a, tage, zielTag });
        }
        break;
      }
      case "treffpunkte": {
        const liste = b.daten.ortIds.flatMap((i) => {
          const o = orte.get(i.toLowerCase());
          return o ? [o] : [];
        });
        if (liste.length > 0) dynamisch.set(b.id, { typ: "orte", orte: liste });
        break;
      }
      case "kennzahlen": {
        const liste = b.daten.zahlen.flatMap((art) => {
          const zahl = zahlen.get(art);
          if (zahl === undefined || zahl < 1) return [];
          if (art === "leitende" && zahl < MIN_ANZEIGE_LEITENDE) return [];
          return [{ art, zahl }];
        });
        if (liste.length > 0) {
          dynamisch.set(b.id, { typ: "kennzahlen", zahlen: liste });
        }
        break;
      }
      default:
        break;
    }
  }
  return { dynamisch };
};

// Der Abgleich kennt erst nach dem Laden, welche Seiten für Besucher stehen: Ein Anlass führt auf seine öffentliche Seite, wenn es sie gibt (wie in der Termin-Liste)
export function setzeSeitenpfade(
  dynamisch: ReadonlyMap<string, DynamischErgebnis>,
  pfadVon: (seiteId: string) => string | undefined,
) {
  for (const e of dynamisch.values()) {
    const liste =
      e.typ === "anlaesse"
        ? e.anlaesse
        : e.typ === "countdown"
          ? [e.anlass]
          : [];
    for (const a of liste) {
      const pfad = a.seiteId ? pfadVon(a.seiteId) : undefined;
      if (pfad) a.seitePfad = pfad;
    }
  }
}
