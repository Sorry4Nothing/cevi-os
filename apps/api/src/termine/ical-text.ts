// Text des ICS-Feeds (TC2 #438), nach RFC 5545. Reine Funktionen ohne Datenbank: Sie bekommen die Termine der Sicht «Mein Kalender» und liefern den Text.
// Zeiten stehen in UTC («Z»): Das braucht keinen VTIMEZONE-Block und ist für jede Kalender-App eindeutig. Ganztägige Termine sind DATE-Werte ohne Zeitzone.
// Der Feed trägt nur Titel, Zeit, Ort und Status; nie Beschreibung, Tags, Namen von Kindern oder Anmeldungen.

export interface IcsTermin {
  id: string;
  titel: string;
  status: "aktiv" | "abgesagt" | "pruefen";
  ganztaegig: boolean;
  beginn: Date | null;
  ende: Date | null;
  // «YYYY-MM-DD»; tagBis ist der letzte Tag (inklusive)
  tagVon: string | null;
  tagBis: string | null;
  ort: string | null;
}

export const KALENDER_NAME = "Mein Cevi-Kalender";
const ZEILENENDE = "\r\n";
const MAX_OKTETTE = 75;
const kodierer = new TextEncoder();

// TEXT-Wert: Backslash, Semikolon, Komma und Zeilenumbruch maskieren; übrige Steuerzeichen fallen weg
export function maskiere(text: string) {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/[\\;,]/g, (z) => `\\${z}`)
      .replace(/\n/g, "\\n")
  );
}

// Zeilen höchstens 75 Oktette (UTF-8), Fortsetzung mit einem Leerzeichen; nie mitten in einem Zeichen
export function falte(zeile: string) {
  const zeilen: string[] = [];
  let aktuell = "";
  let oktette = 0;
  for (const zeichen of zeile) {
    const laenge = kodierer.encode(zeichen).length;
    if (oktette + laenge > MAX_OKTETTE) {
      zeilen.push(aktuell);
      aktuell = " ";
      oktette = 1;
    }
    aktuell += zeichen;
    oktette += laenge;
  }
  zeilen.push(aktuell);
  return zeilen.join(ZEILENENDE);
}

// «20270102T090000Z»
export const utcZeit = (d: Date) =>
  d.toISOString().replace(/[-:]|\.\d{3}/g, "");
// «2027-01-02» zu «20270102»
const datum = (tag: string) => tag.replaceAll("-", "");
// Das Ende eines ganztägigen Termins ist exklusiv: der Tag nach dem letzten
const folgetag = (tag: string) =>
  datum(new Date(Date.parse(tag) + 86_400_000).toISOString().slice(0, 10));

const STATUS = {
  aktiv: "CONFIRMED",
  abgesagt: "CANCELLED",
  // Der Termin fehlt im Kalender und ist zu prüfen: nicht als sicher zeigen
  pruefen: "TENTATIVE",
} as const;

function ereignis(t: IcsTermin, stempel: string): string[] | null {
  const zeit: string[] = [];
  if (t.ganztaegig) {
    if (!t.tagVon) return null;
    zeit.push(
      `DTSTART;VALUE=DATE:${datum(t.tagVon)}`,
      `DTEND;VALUE=DATE:${folgetag(t.tagBis ?? t.tagVon)}`,
    );
  } else {
    if (!t.beginn) return null;
    zeit.push(`DTSTART:${utcZeit(t.beginn)}`);
    if (t.ende && t.ende > t.beginn) zeit.push(`DTEND:${utcZeit(t.ende)}`);
  }
  return [
    "BEGIN:VEVENT",
    `UID:${t.id}@cevi-os`,
    `DTSTAMP:${stempel}`,
    ...zeit,
    `SUMMARY:${maskiere(t.titel)}`,
    ...(t.ort ? [`LOCATION:${maskiere(t.ort)}`] : []),
    `STATUS:${STATUS[t.status]}`,
    "END:VEVENT",
  ];
}

// Der ganze Kalender, jede Zeile gefaltet und mit CRLF beendet. Termine ohne gültige Zeit fallen weg, statt den Feed zu brechen
export function baueIcs(termine: IcsTermin[], jetzt: Date) {
  const stempel = utcZeit(jetzt);
  const zeilen = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cevi OS//Termine//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${maskiere(KALENDER_NAME)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...termine.flatMap((t) => ereignis(t, stempel) ?? []),
    "END:VCALENDAR",
  ];
  return zeilen.map(falte).join(ZEILENENDE) + ZEILENENDE;
}

// Ein einzelner Termin als Datei zum Importieren (#847): ohne Kalendername und Abo-Intervall, sonst legte mancher Kalender beim Öffnen einen eigenen Kalender an. null, wenn der Termin keine gültige Zeit hat
export function baueEinzelIcs(t: IcsTermin, jetzt: Date) {
  const vevent = ereignis(t, utcZeit(jetzt));
  if (!vevent) return null;
  const zeilen = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cevi OS//Termine//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...vevent,
    "END:VCALENDAR",
  ];
  return zeilen.map(falte).join(ZEILENENDE) + ZEILENENDE;
}

// Der Stempel ändert sich mit jedem Bau; für den ETag zählt nur der Inhalt, sonst wäre jeder Abruf nach dem Zwischenspeicher ein neuer Stand
export const ohneStempel = (ics: string) =>
  ics.replace(/^DTSTAMP:.*\r\n/gm, "");
