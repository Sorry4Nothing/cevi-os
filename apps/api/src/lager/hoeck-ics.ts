// Ein Höck als Kalenderdatei (RFC 5545, #378). Die Datei enthält nur, was auch das Team von einem Team-Höck sieht: Titel, Ort, Datum und Zeit. Keine Namen, keine Anwesenden, keine Traktanden, kein Lager, keine Links in die App.
//
// Die Zeit ist die Zeit des Lagers ohne Zeitzone («schwebend»): Der Kalender zeigt sie so, wie sie dasteht, was für eine Sitzung in der Schweiz gemeint ist. Ein Höck ohne Zeit ist ein Tag (DTSTART;VALUE=DATE). Ein Ende gibt es nicht, weil der Höck keines hat; RFC 5545 erlaubt das.
// UID bleibt über Änderungen gleich, SEQUENCE steigt mit der Version der Zeile: Importiert jemand die Datei nach einer Änderung noch einmal, ersetzt der Kalender den Termin, statt einen zweiten anzulegen. DTSTAMP kommt aus dem Änderungszeitpunkt, nicht aus der Uhr: Dieselbe Zeile ergibt dieselbe Datei.

export type HoeckFuerIcs = {
  id: string;
  version: number;
  datum: string;
  zeit: string | null;
  titel: string;
  ort: string | null;
  geaendertAm: Date;
};

// Text-Werte nach RFC 5545 3.3.11: Backslash, Strichpunkt, Komma und Zeilenumbruch maskieren (der Backslash zuerst); übrige Steuerzeichen werden zu einem Leerzeichen, damit kein Wert eine Zeile oder einen Block beginnen kann
export function maskiereIcsText(wert: string) {
  return wert
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n|[\p{Zl}\p{Zp}]/gu, "\\n")
    .replace(/(?!\t)\p{Cc}/gu, " ");
}

// Zeilen höchstens 75 Oktette lang, Fortsetzungen mit einem Leerzeichen am Anfang (RFC 5545 3.1); ein Zeichen wird nie zerschnitten
export function faltIcsZeile(zeile: string) {
  const teile: string[] = [];
  let aktuell = "";
  let oktette = 0;
  for (const zeichen of zeile) {
    const laenge = Buffer.byteLength(zeichen, "utf8");
    // Fortsetzungszeilen beginnen mit einem Leerzeichen, das mitzählt
    if (oktette + laenge > 75) {
      teile.push(aktuell);
      aktuell = " ";
      oktette = 1;
    }
    aktuell += zeichen;
    oktette += laenge;
  }
  teile.push(aktuell);
  return teile.join("\r\n");
}

const utc = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

export function erzeugeHoeckIcs(h: HoeckFuerIcs) {
  const tag = h.datum.replaceAll("-", "");
  const start = h.zeit
    ? `DTSTART:${tag}T${h.zeit.replace(":", "")}00`
    : `DTSTART;VALUE=DATE:${tag}`;
  const zeilen = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cevi OS//Lager//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${h.id}@cevi-os`,
    `DTSTAMP:${utc(h.geaendertAm)}`,
    `SEQUENCE:${h.version - 1}`,
    start,
    `SUMMARY:${maskiereIcsText(h.titel)}`,
    ...(h.ort ? [`LOCATION:${maskiereIcsText(h.ort)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return zeilen.map(faltIcsZeile).join("\r\n") + "\r\n";
}
