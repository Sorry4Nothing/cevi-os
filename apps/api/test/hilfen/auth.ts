import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { ExpoPushMessage } from "expo-server-sdk";
import { afterEach, expect, vi } from "vitest";
import { erstelleAuth } from "../../src/auth.js";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";

// Erfundenes App-Schema; das echte legt die App fest
export const APP = "testapp://";
export const PASSWORT = "nur-fuer-tests-1";
export const GELEAKT = "nur-fuer-tests-geleakt";

const EXPO_SENDEN = "https://exp.host/--/api/v2/push/send";

// Im Modul-Scope aufrufen, vor dem Bau der Auth-Instanz: better-auth liest beide Umgebungsvariablen beim Erstellen, Vitest friert die Zeitgrenze beim Definieren eines Tests ein, und vi.setConfig gilt nur für die eigene Datei
// Gibt die Expo-Attrappe zurück: Die Push-Tests lesen `nachrichten` und schalten `ausfall` ein, alle anderen Dateien ignorieren sie
export function bereiteAuthTestsVor() {
  // Jedes Passwort, das better-auth prüft oder speichert, rechnet scrypt mit 32 MiB; auf einem ausgelasteten Rechner wurden bis 19 s pro Test gemessen, ein Vielfaches der 5 s von Vitest. hookTimeout gleich: beforeAll der Rechte-Tests legt 14 Personas an
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
  vi.stubEnv("BETTER_AUTH_URL", "https://cevi-os.invalid");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", APP);

  // Kein Netz im Test: HIBP und Expo antworten aus dieser Attrappe, jeder andere Zugriff lässt den Test scheitern
  const fremdeZugriffe: string[] = [];
  const sha1 = (text: string) =>
    createHash("sha1").update(text).digest("hex").toUpperCase();
  const expo = {
    nachrichten: [] as ExpoPushMessage[],
    ausfall: false,
    zuruecksetzen() {
      this.nachrichten.length = 0;
      this.ausfall = false;
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url) === EXPO_SENDEN) {
        // Das SDK komprimiert JSON über 1024 Zeichen
        const kopf = new Headers(init?.headers);
        const koerper =
          kopf.get("content-encoding") === "gzip"
            ? gunzipSync(init?.body as Buffer)
            : (init?.body as string);
        const nachrichten = JSON.parse(String(koerper)) as ExpoPushMessage[];
        expo.nachrichten.push(...nachrichten);
        if (expo.ausfall) return new Response("Fehler", { status: 500 });
        return new Response(
          JSON.stringify({
            data: nachrichten.map(() => ({ status: "ok", id: randomUUID() })),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      const praefix =
        /^https:\/\/api\.pwnedpasswords\.com\/range\/([0-9A-F]{5})$/.exec(
          String(url),
        )?.[1];
      if (!praefix) {
        fremdeZugriffe.push(String(url));
        throw new Error(`Kein Netz im Test: ${url}`);
      }
      const geleakt = sha1(GELEAKT);
      const zeilen = geleakt.startsWith(praefix) ? `${geleakt.slice(5)}:3` : "";
      return new Response(zeilen, {
        headers: { "content-type": "text/plain" },
      });
    }),
  );
  afterEach(() => expect(fremdeZugriffe.splice(0)).toEqual([]));
  return expo;
}

// Eigene IP pro Persona oder Anfrage, damit die Testdateien eines Laufs sich kein Rate-Limit-Budget teilen (ohne Header zählen alle als 127.0.0.1). RFC-3849-Dokumentationsnetz, schon in better-auths normalisierter /64-Form: Der Schlüssel in rate_limit ist `${ip}|${pfad}`
export function zufallsIp() {
  const block = () =>
    Math.floor(Math.random() * 0x1_0000)
      .toString(16)
      .padStart(4, "0");
  return `2001:0db8:${block()}:${block()}:0000:0000:0000:0000`;
}

// Wie der Cookie-Speicher des Expo-Clients: Was mit Max-Age=0 kommt, fällt weg; nimmt eine Response oder ein returnHeaders-Ergebnis
export function cookiesAus({ headers }: { headers: Headers }) {
  return headers
    .getSetCookie()
    .filter((c) => !/max-age=0(;|$)/i.test(c))
    .map((c) => c.split(";")[0])
    .join("; ");
}

// Auth wie auf dem Server, aber mit dem Drizzle-Client der Tests
export function erstelleTestAuth(db: Db) {
  return erstelleAuth(
    drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  );
}

// GET und POST jedes Pfads, den better-auth mit diesen Plugins kennt, ohne die offenen Einträge; so treffen die Tests auch Pfade, die ein Update dazubringt
export function geschlossenePfade(offen: readonly string[]) {
  const pfade = new Set(
    Object.values(erstelleAuth(memoryAdapter({})).api).flatMap((e) =>
      e.path ? [e.path] : [],
    ),
  );
  return [...pfade]
    .flatMap((pfad) => [`GET /api/auth${pfad}`, `POST /api/auth${pfad}`])
    .filter((eintrag) => !offen.includes(eintrag));
}
