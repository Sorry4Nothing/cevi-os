import {
  ADRESSE_UNGUELTIG,
  antwortMitStatus,
  KalenderFehler,
  NICHT_ERREICHBAR,
} from "./fehler.js";

const ZEITLIMIT_MS = 30_000;

// Holt den iCal-Text unter einem Zeitlimit, ohne Wiederholung; die Adresse ist geheim und steht in keinem Fehlertext.
// shortcut: keine Obergrenze für die Antwortgrösse, der Kalender einer Abteilung ist klein; bei fremden Quellen begrenzen
export async function holeKalender(adresse: string): Promise<string> {
  let url: URL;
  try {
    // Outlook gibt die Adresse auch als webcal:// weiter
    url = new URL(adresse.replace(/^webcal:/i, "https:"));
  } catch (fehler) {
    throw new KalenderFehler(ADRESSE_UNGUELTIG, { cause: fehler });
  }
  if (url.protocol !== "https:") throw new KalenderFehler(ADRESSE_UNGUELTIG);
  let antwort: Response;
  let text: string;
  try {
    antwort = await fetch(url, { signal: AbortSignal.timeout(ZEITLIMIT_MS) });
    text = await antwort.text();
  } catch (fehler) {
    throw new KalenderFehler(NICHT_ERREICHBAR, { cause: fehler });
  }
  if (!antwort.ok) throw new KalenderFehler(antwortMitStatus(antwort.status));
  return text;
}
