import ICAL from "ical.js";
import { ANTWORT_UNGUELTIG, KalenderFehler } from "./fehler.js";

export type ProgrammAusKalender = {
  googleEventId: string;
  googleSerie: string | null;
  titel: string;
  ganztaegig: boolean;
  beginn: Date | null;
  ende: Date | null;
  tagVon: string | null;
  tagBis: string | null;
  googleOrt: string | null;
  googleBeschreibung: string | null;
};

const TAG_MS = 24 * 60 * 60 * 1000;
// Schutz vor Serien, die nie enden und ewig zurückliegen; ein Lauf zählt nur Termine im Fenster, rund 400 Tage voraus
const MAX_SCHRITTE = 100_000;

// Reine Abbildung des iCal-Texts auf Programme und Absagen; ein ungültiger Kalender wirft und lässt die Abteilung scheitern
export function gleicheAb(
  ics: string,
  jetzt: Date,
): { programme: ProgrammAusKalender[]; absagen: string[] } {
  try {
    return abbilden(ics, jetzt);
  } catch (fehler) {
    throw fehler instanceof KalenderFehler
      ? fehler
      : new KalenderFehler(ANTWORT_UNGUELTIG, { cause: fehler });
  }
}

// Ohne Zeitzone wäre der Zeitpunkt zweideutig (ical.js nähme die des Servers); VTIMEZONE-Blöcke des Kalenders sind registriert
// Ein Tag ohne Uhrzeit hat keine Zone und dient nur dem Fenstervergleich (UTC-Mitternacht)
function zeitpunkt(zeit: ICAL.Time) {
  if (zeit.isDate)
    return new Date(Date.UTC(zeit.year, zeit.month - 1, zeit.day));
  if (zeit.zone.tzid === "floating")
    throw new KalenderFehler(ANTWORT_UNGUELTIG);
  return zeit.toJSDate();
}

function abbilden(ics: string, jetzt: Date) {
  const wurzel = new ICAL.Component(ICAL.parse(ics));
  if (wurzel.name !== "vcalendar") throw new KalenderFehler(ANTWORT_UNGUELTIG);
  for (const zone of wurzel.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(zone);
  }
  const von = jetzt.getTime() - TAG_MS;
  const bis = jetzt.getTime() + 400 * TAG_MS;
  const programme: ProgrammAusKalender[] = [];
  const absagen: string[] = [];

  function uebernimm(
    termin: ICAL.Event,
    id: string,
    serie: string | null,
    start: ICAL.Time,
    ende: ICAL.Time,
  ) {
    // Zuerst die Absage: Sie braucht weder Titel noch Zeit
    if (termin.component.getFirstPropertyValue("status") === "CANCELLED") {
      absagen.push(id);
      return;
    }
    const klasse = termin.component.getFirstPropertyValue("class");
    if (klasse === "PRIVATE" || klasse === "CONFIDENTIAL") return;
    const titel = termin.summary?.trim();
    if (!titel) return;
    // Gemischte Zeiten: lieber die Abteilung abbrechen als raten
    if (start.isDate !== ende.isDate)
      throw new KalenderFehler(ANTWORT_UNGUELTIG);
    const ganztaegig = start.isDate;
    const beginn = zeitpunkt(start);
    const schluss = zeitpunkt(ende);
    // Das Fenster hält gestrige und laufende Termine; Ganztägiges endet exklusiv am Folgetag
    if (schluss.getTime() <= von || beginn.getTime() >= bis) return;
    let tagBis: string | null = null;
    if (ganztaegig) {
      const letzter = ende.clone();
      letzter.adjust(-1, 0, 0, 0);
      tagBis =
        letzter.compare(start) < 0 ? start.toString() : letzter.toString();
    }
    programme.push({
      googleEventId: id,
      googleSerie: serie,
      titel,
      ganztaegig,
      beginn: ganztaegig ? null : beginn,
      ende: ganztaegig ? null : schluss,
      tagVon: ganztaegig ? start.toString() : null,
      tagBis,
      googleOrt: termin.location || null,
      googleBeschreibung: termin.description?.trim() || null,
    });
  }

  const nachUid = new Map<
    string,
    { haupt?: ICAL.Component; ausnahmen: ICAL.Component[] }
  >();
  for (const teil of wurzel.getAllSubcomponents("vevent")) {
    const uid = teil.getFirstPropertyValue("uid");
    if (typeof uid !== "string" || uid === "") continue;
    const eintrag = nachUid.get(uid) ?? { ausnahmen: [] };
    if (teil.hasProperty("recurrence-id")) eintrag.ausnahmen.push(teil);
    else eintrag.haupt = teil;
    nachUid.set(uid, eintrag);
  }

  for (const [uid, { haupt, ausnahmen }] of nachUid) {
    // Einzelne Ausnahmen ohne Serie (etwa eine Einladung zu einem Termin): wie ein eigener Termin
    if (!haupt) {
      for (const teil of ausnahmen) {
        const termin = new ICAL.Event(teil);
        uebernimm(
          termin,
          `${uid}_${termin.recurrenceId.toICALString()}`,
          null,
          termin.startDate,
          termin.endDate,
        );
      }
      continue;
    }
    const termin = new ICAL.Event(haupt, { exceptions: ausnahmen });
    if (!termin.isRecurring()) {
      uebernimm(termin, uid, null, termin.startDate, termin.endDate);
      continue;
    }
    // EXDATE, RDATE und verschobene Instanzen löst ical.js auf; die Instanz-ID folgt dem ursprünglichen Beginn, damit sie bei einer Verschiebung gleich bleibt
    const lauf = termin.iterator();
    let schritte = 0;
    for (let t = lauf.next(); t; t = lauf.next()) {
      if (++schritte > MAX_SCHRITTE)
        throw new KalenderFehler(ANTWORT_UNGUELTIG);
      const instanz = termin.getOccurrenceDetails(t);
      if (zeitpunkt(instanz.startDate).getTime() >= bis) break;
      uebernimm(
        instanz.item,
        `${uid}_${instanz.recurrenceId.toICALString()}`,
        uid,
        instanz.startDate,
        instanz.endDate,
      );
    }
  }
  return { programme, absagen };
}

const ENTITAETEN: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Die App rendert nur Text: Links werden «Text (Ziel)», Blockenden ein Zeilenumbruch, Tags fallen weg («Alter < 10» bleibt), Entities werden aufgelöst
export function htmlZuText(html: string): string | null {
  const text = html
    .replace(
      /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, inhalt: string) => {
        const t = inhalt.replace(/<[^>]*>/g, "");
        return t === href ? t : `${t} (${href})`;
      },
    )
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(
      /&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
      (treffer, e: string) => {
        const klein = e.toLowerCase();
        if (klein.startsWith("#")) {
          const n = klein.startsWith("#x")
            ? parseInt(klein.slice(2), 16)
            : parseInt(klein.slice(1), 10);
          // fromCodePoint wirft ausserhalb von Unicode, und NUL lehnt Postgres ab: beides hielte den Lauf der Abteilung an
          return n >= 1 && n <= 0x10ffff ? String.fromCodePoint(n) : treffer;
        }
        return ENTITAETEN[klein];
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
