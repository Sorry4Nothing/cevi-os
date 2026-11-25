import { createSign } from "node:crypto";
import type {
  AndroidEingabe,
  NachweisErgebnis,
  NachweisPruefer,
} from "./typen.js";

// Google Play Integrity (#785): Der Server lässt das Token der App von Google dekodieren (die App kann es nicht fälschen, der Server entschlüsselt nie selbst) und prüft die Antwort gegen das, was er erwartet. Nur gegen selbst erzeugte Fixtures getestet; eine echte Antwort von Google liegt erst mit der fertigen App vor (docs/app-nachweis.md)

export type Geraetesiegel =
  "MEETS_BASIC_INTEGRITY" | "MEETS_DEVICE_INTEGRITY" | "MEETS_STRONG_INTEGRITY";

// Der Teil «tokenPayloadExternal» der Antwort von decodeIntegrityToken; alles ist optional, denn geprüft wird jedes Feld
export type IntegritaetsAntwort = {
  requestDetails?: {
    requestPackageName?: string;
    nonce?: string;
    timestampMillis?: string | number;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
    certificateSha256Digest?: string[];
  };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
};

// Dekodiert ein Token; wirft bei einem Fehler der Verbindung oder wenn Google es ablehnt
export type Dekodierer = (token: string) => Promise<IntegritaetsAntwort>;

// Wie alt der Zeitstempel im Token höchstens sein darf
const MAX_ALTER_MS = 5 * 60_000;
// Die Uhren dürfen leicht auseinanderlaufen
const MAX_VORSPRUNG_MS = 60_000;

const fehler = (grund: string): NachweisErgebnis => ({ ok: false, grund });

export class DienstFehler extends Error {}

export function erstelleAndroidPruefer({
  paketname,
  zertifikate,
  mindestGeraete = "MEETS_DEVICE_INTEGRITY",
  dekodiere,
  jetzt = Date.now,
}: {
  paketname: string;
  // SHA-256-Fingerabdrücke des App-Zertifikats, hex, klein, ohne Doppelpunkte
  zertifikate: string[];
  mindestGeraete?: Geraetesiegel;
  dekodiere: Dekodierer;
  jetzt?: () => number;
}): NachweisPruefer<AndroidEingabe> {
  const erlaubt = new Set(zertifikate);
  return {
    async pruefe({ nonce, integrityToken }) {
      let antwort: IntegritaetsAntwort;
      try {
        antwort = await dekodiere(integrityToken);
      } catch (e) {
        // Google nicht erreichbar oder Fehler im Dienstkonto: nicht die Schuld des Nachweises, der Versuch darf wiederholt werden. Ein Token, das Google ablehnt (400), ist dagegen ungültig
        return e instanceof DienstFehler
          ? { ok: false, grund: "dienst", voruebergehend: true }
          : fehler("token");
      }
      const anfrage = antwort.requestDetails;
      // Die Bindung: Das Token gehört zu dieser Herausforderung und diesem Benutzernamen
      if (anfrage?.nonce !== nonce) return fehler("nonce");
      if (anfrage.requestPackageName !== paketname) return fehler("paket");
      const zeit = Number(anfrage.timestampMillis);
      if (!Number.isFinite(zeit)) return fehler("zeit");
      const alter = jetzt() - zeit;
      if (alter > MAX_ALTER_MS || alter < -MAX_VORSPRUNG_MS) {
        return fehler("zeit");
      }
      const app = antwort.appIntegrity;
      if (app?.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
        return fehler("app-erkannt");
      }
      if (app.packageName !== paketname) return fehler("paket");
      // Google liefert die Digests als base64url; verlangt wird mindestens einer, und jeder muss erlaubt sein
      const digests = app.certificateSha256Digest ?? [];
      if (
        digests.length === 0 ||
        !digests.every((d) =>
          erlaubt.has(Buffer.from(d, "base64url").toString("hex")),
        )
      ) {
        return fehler("zertifikat");
      }
      if (
        !antwort.deviceIntegrity?.deviceRecognitionVerdict?.includes(
          mindestGeraete,
        )
      ) {
        return fehler("geraet");
      }
      return { ok: true, plattform: "android", geraetOk: true };
    },
  };
}

// Das Dienstkonto aus der Schlüsseldatei (JSON von Google Cloud): nur die zwei Felder, die gebraucht werden
export type Dienstkonto = { client_email: string; private_key: string };

export function leseDienstkonto(text: string): Dienstkonto {
  const wert = JSON.parse(text) as Partial<Dienstkonto>;
  if (
    typeof wert.client_email !== "string" ||
    typeof wert.private_key !== "string" ||
    !wert.private_key.includes("PRIVATE KEY")
  ) {
    throw new Error("Dienstkonto: Aufbau der Schlüsseldatei ungültig");
  }
  return { client_email: wert.client_email, private_key: wert.private_key };
}

// Feste Hosts: Der Server spricht nur mit diesen zwei Adressen, nie mit einer aus der Datei oder Anfrage
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASIS = "https://playintegrity.googleapis.com/v1/";
const ANTWORT_MAX = 64 * 1024;
const ZEITLIMIT_MS = 8000;
// Länger als 16 KB ist kein Integrity-Token
export const TOKEN_MAX = 16 * 1024;

// Liest höchstens max Byte; mehr ist ein Fehler. Weder Redirects noch lange Antworten
async function lesenBegrenzt(antwort: Response, max: number) {
  const laenge = Number(antwort.headers.get("content-length") ?? "0");
  if (laenge > max) throw new DienstFehler("zu gross");
  const leser = antwort.body?.getReader();
  if (!leser) return "";
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.length;
    if (summe > max) {
      void leser.cancel();
      throw new DienstFehler("zu gross");
    }
    teile.push(value);
  }
  return Buffer.concat(teile).toString("utf8");
}

const base64url = (wert: string | Buffer) =>
  Buffer.from(wert).toString("base64url");

// Dekodiert über die Google-API: Dienstkonto-JWT (RS256) gegen ein OAuth-Token, mit dem decodeIntegrityToken aufgerufen wird. Das OAuth-Token lebt im Speicher, nie im Log
export function erstelleGoogleDekodierer({
  dienstkonto,
  paketname,
  fetchFn = fetch,
  jetzt = Date.now,
}: {
  dienstkonto: Dienstkonto;
  paketname: string;
  fetchFn?: typeof fetch;
  jetzt?: () => number;
}): Dekodierer {
  let zugang: { token: string; bisMs: number } | undefined;

  const anfrage = async (url: string, init: RequestInit) => {
    let antwort: Response;
    try {
      antwort = await fetchFn(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      });
    } catch {
      throw new DienstFehler("Verbindung");
    }
    const text = await lesenBegrenzt(antwort, ANTWORT_MAX);
    return { status: antwort.status, text };
  };

  async function zugangsToken() {
    if (zugang && zugang.bisMs - 60_000 > jetzt()) return zugang.token;
    const iat = Math.floor(jetzt() / 1000);
    const kopf = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const inhalt = base64url(
      JSON.stringify({
        iss: dienstkonto.client_email,
        scope: "https://www.googleapis.com/auth/playintegrity",
        aud: TOKEN_URL,
        iat,
        exp: iat + 3600,
      }),
    );
    const signatur = createSign("RSA-SHA256")
      .update(`${kopf}.${inhalt}`)
      .sign(dienstkonto.private_key)
      .toString("base64url");
    const { status, text } = await anfrage(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${kopf}.${inhalt}.${signatur}`,
      }),
    });
    if (status !== 200) throw new DienstFehler("OAuth");
    const antwort = JSON.parse(text) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof antwort.access_token !== "string" ||
      typeof antwort.expires_in !== "number"
    ) {
      throw new DienstFehler("OAuth");
    }
    zugang = {
      token: antwort.access_token,
      bisMs: jetzt() + antwort.expires_in * 1000,
    };
    return zugang.token;
  }

  return async (token) => {
    if (token.length > TOKEN_MAX) throw new Error("Token zu lang");
    const bearer = await zugangsToken();
    const { status, text } = await anfrage(
      `${API_BASIS}${encodeURIComponent(paketname)}:decodeIntegrityToken`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ integrity_token: token }),
      },
    );
    // 400: Google lehnt das Token ab (nicht entschlüsselbar, manipuliert, falsche App). 401, 403, 429 und 5xx sind Sache des Dienstes oder der Einrichtung
    if (status === 400) throw new Error("Token abgelehnt");
    if (status !== 200) {
      // Ein abgelaufenes OAuth-Token holt der nächste Aufruf neu
      if (status === 401) zugang = undefined;
      throw new DienstFehler(`Status ${status}`);
    }
    const antwort = JSON.parse(text) as {
      tokenPayloadExternal?: IntegritaetsAntwort;
    };
    if (!antwort.tokenPayloadExternal) throw new Error("Antwort ohne Inhalt");
    return antwort.tokenPayloadExternal;
  };
}
