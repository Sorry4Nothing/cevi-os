import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { erstelleAuth } from "../src/auth.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";

// Wie in auth.test.ts: Anlegen und Anmelden rechnen scrypt mit 32 MiB; auf einem ausgelasteten Rechner braucht ein Test so ein Vielfaches der 5 s von Vitest
vi.setConfig({ testTimeout: 120_000 });

// Wie in auth.test.ts: erfundene Adresse und erfundenes App-Schema
vi.stubEnv("BETTER_AUTH_URL", "https://cevi-os.invalid");
vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "testapp://");

// Kein Netz im Test: HIBP findet kein Passwort, jeder andere Zugriff lässt den Test scheitern
const fremdeZugriffe: string[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL) => {
    if (
      !/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/.test(
        String(url),
      )
    ) {
      fremdeZugriffe.push(String(url));
      throw new Error(`Kein Netz im Test: ${url}`);
    }
    return new Response("", { headers: { "content-type": "text/plain" } });
  }),
);
afterEach(() => expect(fremdeZugriffe.splice(0)).toEqual([]));

const PASSWORT = "nur-fuer-tests-1";
const TAG = 86_400_000;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const url =
  process.env.DATABASE_URL ?? "postgres://cevi_os_api@localhost:5432/cevi_os";
const sql = postgres(url);
// Eigener Client für Drizzle: drizzle() liefert Zeitpunkte seines Clients danach als Text
const db = erstelleDb(postgres(url));
const auth = erstelleAuth(
  drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
);

let abteilungId: string;
beforeAll(async () => {
  [{ id: abteilungId }] =
    await sql`insert into abteilung (name) values ('Testabteilung') returning id`;
});
afterAll(async () => {
  await sql`delete from "user" where abteilung_id = ${abteilungId}`;
  await sql`delete from abteilung where id = ${abteilungId}`;
  await Promise.all([sql.end(), db.$client.end()]);
});

// Ohne mussPasswortAendern: Es gilt der Standardwert der Datenbank, darum ein künftiges Ablaufdatum
async function legeAn() {
  const benutzername = `test${randomUUID().slice(0, 8)}`;
  const { user } = await auth.api.createUser({
    body: {
      email: `${randomUUID()}@benutzer.invalid`,
      password: PASSWORT,
      name: "Testperson",
      data: {
        username: benutzername,
        abteilungId,
        startpasswortGueltigBis: new Date(Date.now() + 7 * TAG),
      },
    },
  });
  return { id: user.id, benutzername };
}

function anmelden(benutzername: string) {
  return auth.handler(
    new Request("https://cevi-os.invalid/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Testgeraet/1.0",
        // Dokumentationsadresse aus RFC 5737
        "x-forwarded-for": "203.0.113.7",
      },
      body: JSON.stringify({ username: benutzername, password: PASSWORT }),
    }),
  );
}

test("auth.api.createUser legt die Person mit den Standardwerten der Datenbank und einer UUIDv7 an", async () => {
  const { id } = await legeAn();
  expect(id).toMatch(UUID_V7);
  expect(
    await sql`
      select abteilung_id, muss_passwort_aendern, startpasswort_gueltig_bis, fehlversuche,
        naechster_versuch_ab, deaktiviert_am, telefon, push_chat, push_programme, datenschutz_gelesen_am
      from "user" where id = ${id}`,
  ).toEqual([
    {
      abteilung_id: abteilungId,
      muss_passwort_aendern: true,
      startpasswort_gueltig_bis: expect.any(Date),
      fehlversuche: 0,
      naechster_versuch_ab: null,
      deaktiviert_am: null,
      telefon: null,
      push_chat: true,
      push_programme: true,
      datenschutz_gelesen_am: null,
    },
  ]);
});

test("Anmeldung mit User-Agent und X-Forwarded-For: 200, die Sitzung speichert beides nicht", async () => {
  const { id, benutzername } = await legeAn();
  expect((await anmelden(benutzername)).status).toBe(200);
  expect(
    await sql`select ip_address, user_agent from session where user_id = ${id}`,
  ).toEqual([{ ip_address: null, user_agent: null }]);
});

test("ist das Startpasswort laut Datenbank abgelaufen, liefert die Anmeldung 403 STARTPASSWORT_ABGELAUFEN, ohne Sitzung", async () => {
  const { id, benutzername } = await legeAn();
  await sql`
    update "user" set startpasswort_gueltig_bis = now() - interval '1 minute'
    where id = ${id}`;
  const antwort = await anmelden(benutzername);
  expect(antwort.status).toBe(403);
  expect((await antwort.json()).code).toBe("STARTPASSWORT_ABGELAUFEN");
  expect(await sql`select id from session where user_id = ${id}`).toEqual([]);
});

test("sechs parallele get-session mit einem Cookie, während die Verlängerung fällig ist: alle 200, gleiches Token, eine Sitzung", async () => {
  const { id, benutzername } = await legeAn();
  const cookie = (await anmelden(benutzername)).headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { updateAge } = (await auth.$context).sessionConfig;
  const [{ token, expires_at: faellig }] = await sql`
    update session set expires_at = expires_at - make_interval(secs => ${updateAge + 60})
    where user_id = ${id}
    returning token, expires_at`;

  const antworten = await Promise.all(
    Array.from({ length: 6 }, () =>
      auth.handler(
        new Request("https://cevi-os.invalid/api/auth/get-session", {
          headers: { cookie },
        }),
      ),
    ),
  );
  for (const antwort of antworten) {
    expect(antwort.status).toBe(200);
    expect((await antwort.json()).session.token).toBe(token);
  }
  const sitzungen =
    await sql`select expires_at from session where user_id = ${id}`;
  expect(sitzungen).toHaveLength(1);
  expect(sitzungen[0].expires_at.getTime()).toBeGreaterThan(faellig.getTime());
});
