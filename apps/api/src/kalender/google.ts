import { sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  ANTWORT_UNGUELTIG,
  antwortMitStatus,
  KalenderFehler,
  NICHT_ERREICHBAR,
  SCHLUESSEL_UNGUELTIG,
} from "./fehler.js";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
// Partial Response: hält Organisator-, Ersteller- und Teilnehmeradressen, htmlLink und iCalUID aus Job und Aufzeichnungen; nextPageToken muss in die Maske, sonst endet das Paging nach der ersten Seite
const FELDER =
  "items(id,status,summary,description,location,start,end,recurringEventId,visibility),nextPageToken";
const ZEITLIMIT_MS = 30_000;
const TAG_MS = 24 * 60 * 60 * 1000;

const schluesselSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});
const tokenSchema = z.object({ access_token: z.string().min(1) });

const base64url = (wert: string) => Buffer.from(wert).toString("base64url");

// Die Schlüsseldatei wird bei jedem Lauf neu gelesen: So greift ein gewechselter Schlüssel ohne Neustart
export async function holeToken(
  schluesselDatei: string | undefined,
  jetzt: Date,
): Promise<string> {
  let zusicherung: string;
  try {
    if (!schluesselDatei) throw new Error("keine Schlüsseldatei konfiguriert");
    const schluessel = schluesselSchema.parse(
      JSON.parse(await readFile(schluesselDatei, "utf8")),
    );
    const iat = Math.floor(jetzt.getTime() / 1000);
    const inhalt = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
      JSON.stringify({
        iss: schluessel.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat,
        exp: iat + 3600,
      }),
    )}`;
    zusicherung = `${inhalt}.${sign("sha256", Buffer.from(inhalt), schluessel.private_key).toString("base64url")}`;
  } catch (fehler) {
    throw new KalenderFehler(SCHLUESSEL_UNGUELTIG, { cause: fehler });
  }
  const text = await lies(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: zusicherung,
    }),
  });
  try {
    return tokenSchema.parse(JSON.parse(text)).access_token;
  } catch (fehler) {
    throw new KalenderFehler(ANTWORT_UNGUELTIG, { cause: fehler });
  }
}

// Liefert die rohen Seiten, wie Google sie schickt: Geprüft wird in abgleich.ts, und die CLI zeichnet sie unverändert auf
export async function holeSeiten(
  token: string,
  kalenderId: string,
  jetzt: Date,
): Promise<unknown[]> {
  const seiten: unknown[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(kalenderId)}/events`,
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    // timeMin begrenzt das Ende: Gestrige und laufende Termine bleiben so im Fenster
    url.searchParams.set(
      "timeMin",
      new Date(jetzt.getTime() - TAG_MS).toISOString(),
    );
    url.searchParams.set(
      "timeMax",
      new Date(jetzt.getTime() + 400 * TAG_MS).toISOString(),
    );
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("fields", FELDER);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const text = await lies(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    let seite: unknown;
    try {
      seite = JSON.parse(text);
    } catch (fehler) {
      throw new KalenderFehler(ANTWORT_UNGUELTIG, { cause: fehler });
    }
    seiten.push(seite);
    const naechste = (seite as { nextPageToken?: unknown }).nextPageToken;
    pageToken =
      typeof naechste === "string" && naechste !== "" ? naechste : undefined;
  } while (pageToken);
  return seiten;
}

// Anfrage samt Body-Lesen unter einem Zeitlimit, ohne Wiederholung; die Fehlertexte nennen weder URL noch Token
async function lies(url: string, init: RequestInit) {
  let antwort: Response;
  let text: string;
  try {
    antwort = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
    text = await antwort.text();
  } catch (fehler) {
    throw new KalenderFehler(NICHT_ERREICHBAR, { cause: fehler });
  }
  if (!antwort.ok) throw new KalenderFehler(antwortMitStatus(antwort.status));
  return text;
}
