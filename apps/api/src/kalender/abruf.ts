import {
  ADRESSE_UNGUELTIG,
  ANTWORT_UNGUELTIG,
  antwortMitStatus,
  KalenderFehler,
  NICHT_ERREICHBAR,
} from "./fehler.js";

const ZEITLIMIT_MS = 30_000;
export const MAX_BYTES = 10 * 1024 * 1024;

// Liest den Body in Stücken und bricht ab, sobald MAX_BYTES überschritten sind: Der ganze Body landet nie im Speicher
async function leseGedeckelt(antwort: Response): Promise<string> {
  const laenge = Number(antwort.headers.get("content-length"));
  if (laenge > MAX_BYTES) {
    await antwort.body?.cancel();
    throw new KalenderFehler(ANTWORT_UNGUELTIG);
  }
  if (!antwort.body) return "";
  const stuecke: Uint8Array[] = [];
  let summe = 0;
  for await (const stueck of antwort.body) {
    summe += stueck.byteLength;
    if (summe > MAX_BYTES) {
      throw new KalenderFehler(ANTWORT_UNGUELTIG);
    }
    stuecke.push(stueck);
  }
  return Buffer.concat(stuecke).toString("utf8");
}

// Holt den iCal-Text unter einem Zeitlimit und einer Grössengrenze, ohne Wiederholung; die Adresse ist geheim und steht in keinem Fehlertext.
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
    // Keine Weiterleitung: Sie könnte auf eine interne Adresse zeigen (wie bei den anderen Abrufen, #775)
    antwort = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
    if (!antwort.ok) throw new KalenderFehler(antwortMitStatus(antwort.status));
    text = await leseGedeckelt(antwort);
  } catch (fehler) {
    if (fehler instanceof KalenderFehler) throw fehler;
    throw new KalenderFehler(NICHT_ERREICHBAR, { cause: fehler });
  }
  return text;
}
