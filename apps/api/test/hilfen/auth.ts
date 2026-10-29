import { createHash } from "node:crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterEach, expect, vi } from "vitest";
import { erstelleAuth } from "../../src/auth.js";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";

// Erfundenes App-Schema; das echte legt die App fest
export const APP = "testapp://";
export const PASSWORT = "nur-fuer-tests-1";
export const GELEAKT = "nur-fuer-tests-geleakt";

// Im Modul-Scope aufrufen, vor dem Bau der Auth-Instanz: better-auth liest beide Umgebungsvariablen beim Erstellen, Vitest friert die Zeitgrenze beim Definieren eines Tests ein, und vi.setConfig gilt nur für die eigene Datei
export function bereiteAuthTestsVor() {
  // Jedes Passwort, das better-auth prüft oder speichert, rechnet scrypt mit 32 MiB; auf einem ausgelasteten Rechner wurden bis 19 s pro Test gemessen, ein Vielfaches der 5 s von Vitest
  vi.setConfig({ testTimeout: 120_000 });
  vi.stubEnv("BETTER_AUTH_URL", "https://cevi-os.invalid");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", APP);

  // Kein Netz im Test: HIBP antwortet aus dieser Attrappe, jeder andere Zugriff lässt den Test scheitern
  const fremdeZugriffe: string[] = [];
  const sha1 = (text: string) =>
    createHash("sha1").update(text).digest("hex").toUpperCase();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
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
