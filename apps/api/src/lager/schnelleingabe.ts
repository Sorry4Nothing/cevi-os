import { z } from "zod";

// Schnelleingabe für Aufgaben (#375): aus einem Text wie «Offerte @Jonas bis 15.3. #Logistik» wird ein Vorschlag (Titel, Person, Ressort, Frist). Reine Funktionen ohne Datenbank und ohne Uhr: «heute», das Lager und die Listen der Personen und Ressorts kommen als Parameter. Der Parser legt nie etwas an und rät nie: Passt ein Name auf mehrere Personen oder Ressorts, liefert er die Kandidaten.
// Vorlage ist die Schnellerfassung des alten Lager-Tools (parseQuick und wortDatum): @Person, bis Datum, #Ressort, eine Zeile pro Aufgabe.

export const SCHNELL_MAX_ZEICHEN = 500;
export const SCHNELL_MAX_ZEILEN = 20;
const TITEL_MAX = 200;

export const schnelleingabeEingabe = z.strictObject({
  text: z
    .string()
    .max(SCHNELL_MAX_ZEICHEN)
    .refine((t) => {
      const n = zeilenVon(t).length;
      return n >= 1 && n <= SCHNELL_MAX_ZEILEN;
    }),
});

// Eine Zeile je Aufgabe; Aufzählungszeichen und «1.» am Zeilenanfang fallen weg (eingefügte Listen)
export function zeilenVon(text: string) {
  return text
    .split(/\r?\n/)
    .map((z) => z.replace(/^\s*(?:[-–•*]|\d{1,2}[.)])\s+/u, "").trim())
    .filter(Boolean);
}

export interface Kandidat {
  id: string;
  // Gegen diese Schlüssel wird nach «@» oder «#» verglichen (Vorname, Cevi-Name, voller Name; Kürzel, Name), ohne Rücksicht auf Gross- und Kleinschreibung
  schluessel: string[];
}

export type Treffer = {
  // «gefunden»: genau ein Treffer; «mehrdeutig»: mehrere, die App lässt wählen; «unbekannt»: keiner, der Text bleibt im Titel
  status: "gefunden" | "mehrdeutig" | "unbekannt";
  // Der Text hinter «@» oder «#», wie getippt
  text: string;
  ids: string[];
};

export interface Frist {
  // ISO-Datum
  datum: string;
  // Der erkannte Teil der Eingabe («bis 15.3.»), für die Chips der App
  text: string;
}

export type Hinweis = "TITEL_FEHLT" | "TITEL_ZU_LANG" | "DATUM_UNGUELTIG";

export interface Vorschlag {
  zeile: string;
  titel: string;
  person: Treffer | null;
  ressort: Treffer | null;
  frist: Frist | null;
  hinweise: Hinweis[];
}

export interface Kontext {
  // Referenzdatum (ISO, in der Schweiz); die Route setzt es, Tests fest
  heute: string;
  // Beginn des Lagers (ISO) für «2 Wochen vor Lager»
  lagerVon: string | null;
  personen: Kandidat[];
  ressorts: Kandidat[];
}

// ---------- Datum ----------

const TAG_MS = 86_400_000;
const WTAGE = [
  "sonntag",
  "montag",
  "dienstag",
  "mittwoch",
  "donnerstag",
  "freitag",
  "samstag",
];
const MONATE = [
  "januar",
  "februar",
  "m(?:ä|ae)rz",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "dezember",
];

const zeitpunkt = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const alsIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plusTage = (iso: string, n: number) =>
  alsIso(zeitpunkt(iso) + n * TAG_MS);
const wochentag = (iso: string) => new Date(zeitpunkt(iso)).getUTCDay();

// Ein echtes Datum? Prüft Monatsende und Schaltjahr (30.2. und 29.2.2027 gibt es nicht)
function datumOderNull(j: number, m: number, t: number) {
  if (j < 1000 || j > 9999 || m < 1 || m > 12 || t < 1) return null;
  const d = new Date(Date.UTC(j, m - 1, t));
  // Ein Tag über dem Monatsende rollt in den nächsten Monat: dann gibt es das Datum nicht
  return d.getUTCMonth() === m - 1 ? alsIso(d.getTime()) : null;
}
const monatsende = (j: number, m: number) => alsIso(Date.UTC(j, m, 1) - TAG_MS);

// Tag und Monat ohne Jahr: das nächste Mal ab heute (heute selbst zählt); der 29.2. wartet auf das nächste Schaltjahr
function naechstesVorkommen(heute: string, m: number, t: number) {
  const jahr = Number(heute.slice(0, 4));
  for (let j = jahr; j <= jahr + 8; j++) {
    const d = datumOderNull(j, m, t);
    if (d && d >= heute) return d;
  }
  return null;
}

const ENDE = "(?=[\\s.,;]|$)";
// Vorspann, der zur Frist gehört und mit ihr wegfällt: «bis», «am»
const VOR = "(?:bis\\s+)?(?:am\\s+)?";

// Jede Regel liefert das Datum, null (Form erkannt, aber kein gültiges Datum) oder undefined (Form nicht anwendbar, zum Beispiel «vor Lager» ohne Lager)
type Regel = [
  RegExp,
  (m: RegExpMatchArray, k: Kontext) => string | null | undefined,
];

const REGELN: Regel[] = [
  // 2027-03-15
  [
    new RegExp(`(?<![\\d-])${VOR}(\\d{4})-(\\d{2})-(\\d{2})${ENDE}`, "iu"),
    (m) => datumOderNull(+m[1]!, +m[2]!, +m[3]!),
  ],
  // 15.3. · 15.3.27 · 15.3.2027
  [
    new RegExp(
      `(?<![\\d.])${VOR}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?![\\d])`,
      "iu",
    ),
    (m, k) => {
      const [t, mo] = [+m[1]!, +m[2]!];
      if (!m[3]) return naechstesVorkommen(k.heute, mo, t) ?? null;
      return datumOderNull(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, t);
    },
  ],
  // 2 Wochen vor Lager (vor «in 2 Wochen», sonst gälte die Zahl ab heute)
  [
    new RegExp(
      `(?<![\\p{L}\\d])${VOR}(\\d{1,2})\\s+(tage?|wochen?)\\s+vor\\s+(?:dem\\s+)?lager(?:beginn)?${ENDE}`,
      "iu",
    ),
    (m, k) =>
      k.lagerVon
        ? plusTage(k.lagerVon, -+m[1]! * (/^w/i.test(m[2]!) ? 7 : 1))
        : undefined,
  ],
  [
    new RegExp(`(?<![\\p{L}\\d])${VOR}vor\\s+(?:dem\\s+)?lager${ENDE}`, "iu"),
    (_m, k) => (k.lagerVon ? plusTage(k.lagerVon, -1) : undefined),
  ],
  [
    new RegExp(`(?<![\\p{L}\\d])${VOR}(?:übermorgen|uebermorgen)${ENDE}`, "iu"),
    (_m, k) => plusTage(k.heute, 2),
  ],
  [
    new RegExp(`(?<![\\p{L}\\d])${VOR}morgen${ENDE}`, "iu"),
    (_m, k) => plusTage(k.heute, 1),
  ],
  [new RegExp(`(?<![\\p{L}\\d])${VOR}heute${ENDE}`, "iu"), (_m, k) => k.heute],
  // in 3 Tagen · in 2 Wochen · in 1 Monat
  [
    new RegExp(
      `(?<![\\p{L}\\d])${VOR}in\\s+(\\d{1,2})\\s+(tag|tagen|woche|wochen|monat|monaten)${ENDE}`,
      "iu",
    ),
    (m, k) => {
      const n = +m[1]!;
      const einheit = m[2]!.toLowerCase();
      if (einheit.startsWith("t")) return plusTage(k.heute, n);
      if (einheit.startsWith("w")) return plusTage(k.heute, n * 7);
      // Monate: gleicher Tag, am Monatsende der letzte des Zielmonats (31.1. + 1 Monat = 28.2.)
      const j = Number(k.heute.slice(0, 4));
      const mo = Number(k.heute.slice(5, 7)) - 1 + n;
      const ziel = Date.UTC(j, mo, 1);
      const zj = new Date(ziel).getUTCFullYear();
      const zm = new Date(ziel).getUTCMonth() + 1;
      const tag = Math.min(
        Number(k.heute.slice(8, 10)),
        Number(monatsende(zj, zm).slice(8, 10)),
      );
      return datumOderNull(zj, zm, tag);
    },
  ],
  // Ende Woche: der Freitag dieser Woche (am Wochenende der kommende)
  [
    new RegExp(
      `(?<![\\p{L}\\d])${VOR}ende\\s+(?:dieser\\s+|der\\s+)?woche${ENDE}`,
      "iu",
    ),
    (_m, k) => plusTage(k.heute, (5 - wochentag(k.heute) + 7) % 7),
  ],
  // nächste Woche: der Freitag der Woche, die am nächsten Montag beginnt
  [
    new RegExp(`(?<![\\p{L}\\d])${VOR}nächste\\s+woche${ENDE}`, "iu"),
    (_m, k) => plusTage(k.heute, ((8 - wochentag(k.heute)) % 7 || 7) + 4),
  ],
  [
    new RegExp(
      `(?<![\\p{L}\\d])${VOR}ende\\s+(?:des\\s+)?monats?${ENDE}`,
      "iu",
    ),
    (_m, k) =>
      monatsende(Number(k.heute.slice(0, 4)), Number(k.heute.slice(5, 7))),
  ],
  // Anfang / Mitte / Ende Mai: der nächste ab heute (heute selbst zählt)
  [
    new RegExp(
      `(?<![\\p{L}\\d])${VOR}(anfang|mitte|ende)\\s+(${MONATE.join("|")})${ENDE}`,
      "iu",
    ),
    (m, k) => {
      const mo =
        MONATE.findIndex((n) => new RegExp(`^${n}$`, "iu").test(m[2]!)) + 1;
      const art = m[1]!.toLowerCase();
      const jahr = Number(k.heute.slice(0, 4));
      for (const j of [jahr, jahr + 1]) {
        const d =
          art === "anfang"
            ? datumOderNull(j, mo, 1)
            : art === "mitte"
              ? datumOderNull(j, mo, 15)
              : monatsende(j, mo);
        if (d && d >= k.heute) return d;
      }
      return null;
    },
  ],
  // (nächsten) Montag: der nächste Tag dieses Namens nach heute (heute ist ein Montag: in 7 Tagen)
  [
    new RegExp(
      `(?<![\\p{L}\\d])${VOR}(?:nächsten\\s+|kommenden\\s+)?(${WTAGE.join("|")})${ENDE}`,
      "iu",
    ),
    (m, k) =>
      plusTage(
        k.heute,
        (WTAGE.indexOf(m[1]!.toLowerCase()) - wochentag(k.heute) + 7) % 7 || 7,
      ),
  ],
];

// Nimmt die erste Fristform, die passt, aus dem Text (nur eine; weitere bleiben im Titel)
function nimmFrist(text: string, k: Kontext) {
  for (const [muster, wert] of REGELN) {
    const m = muster.exec(text);
    if (!m) continue;
    const datum = wert(m, k);
    if (datum === undefined) continue;
    if (datum === null) return { ungueltig: true as const };
    return {
      frist: { datum, text: m[0].trim() } satisfies Frist,
      rest: text.slice(0, m.index) + " " + text.slice(m.index + m[0].length),
    };
  }
  return null;
}

// ---------- Person und Ressort ----------

const WORT = "[\\p{L}\\p{N}_-]";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// Erstes «@» oder «#» am Wortanfang (kein «a@b.ch»). Der längste Schlüssel, der dort passt, gewinnt («@Jonas Beispiel» vor «@Jonas»); gehören die längsten Treffer zu mehreren Kandidaten, ist es mehrdeutig. Ein unbekanntes Wort bleibt im Text
function nimmErwaehnung(
  text: string,
  zeichen: "@" | "#",
  kandidaten: Kandidat[],
) {
  const anfang = new RegExp(
    `(?<![\\p{L}\\p{N}_@#.-])${esc(zeichen)}(?=${WORT})`,
    "u",
  ).exec(text);
  if (!anfang) return null;
  const von = anfang.index + 1;
  const danach = text.slice(von);
  let laenge = 0;
  let ids = new Set<string>();
  for (const k of kandidaten) {
    for (const schluessel of k.schluessel) {
      const teile = schluessel.trim().split(/\s+/u).filter(Boolean);
      if (teile.length === 0) continue;
      const m = new RegExp(
        `^${teile.map(esc).join("\\s+")}(?!${WORT})`,
        "iu",
      ).exec(danach);
      if (!m) continue;
      if (m[0].length > laenge) {
        laenge = m[0].length;
        ids = new Set([k.id]);
      } else if (m[0].length === laenge) ids.add(k.id);
    }
  }
  if (laenge === 0) {
    const wort = new RegExp(`^${WORT}+`, "u").exec(danach)![0];
    return {
      treffer: { status: "unbekannt", text: wort, ids: [] } satisfies Treffer,
      rest: text,
    };
  }
  return {
    treffer: {
      status: ids.size === 1 ? "gefunden" : "mehrdeutig",
      text: danach.slice(0, laenge),
      ids: [...ids],
    } satisfies Treffer,
    rest: text.slice(0, anfang.index) + " " + text.slice(von + laenge),
  };
}

// ---------- Zusammenbau ----------

export function parseZeile(zeile: string, k: Kontext): Vorschlag {
  const hinweise: Hinweis[] = [];
  let rest = ` ${zeile} `;

  const p = nimmErwaehnung(rest, "@", k.personen);
  if (p) rest = p.rest;
  const r = nimmErwaehnung(rest, "#", k.ressorts);
  if (r) rest = r.rest;

  const f = nimmFrist(rest, k);
  let frist: Frist | null = null;
  if (f && "ungueltig" in f) hinweise.push("DATUM_UNGUELTIG");
  else if (f) {
    frist = f.frist;
    rest = f.rest;
  }

  const titel = rest.replace(/\s+/gu, " ").trim();
  if (!titel) hinweise.push("TITEL_FEHLT");
  if (titel.length > TITEL_MAX) hinweise.push("TITEL_ZU_LANG");
  return {
    zeile,
    titel,
    person: p?.treffer ?? null,
    ressort: r?.treffer ?? null,
    frist,
    hinweise,
  };
}

export function parseSchnelleingabe(text: string, k: Kontext): Vorschlag[] {
  return zeilenVon(text).map((z) => parseZeile(z, k));
}

// Gibt es etwas aufzulösen? Ohne «@» und «#» braucht die Route keine Abfrage
export const brauchtPersonen = (text: string) => text.includes("@");
export const brauchtRessorts = (text: string) => text.includes("#");
