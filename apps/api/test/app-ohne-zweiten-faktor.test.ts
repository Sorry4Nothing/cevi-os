import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  bereiteAuthTestsVor,
  cookiesAus,
  erstelleTestAuth,
  zufallsIp,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { webmasterRolle as holeWebmasterRolle } from "./hilfen/webmaster.js";
import {
  erstelleWelt,
  legePersonaAn,
  totpCode,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// App-Anmeldung ohne zweiten Faktor, Sitzungen markiert (#721): Die App bekommt auch bei einem Konto mit Faktor eine Sitzung ohne Code. Die Sitzung gilt als «nicht geprüft» und öffnet weder die Verwaltung noch Rechte mit «erweitert». Die Anmeldung im Browser fragt wie bisher nach dem Code.
bereiteAuthTestsVor();
vi.setConfig({ hookTimeout: 120_000 });

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const APP_ORIGIN = "cevi-os://";
// BETTER_AUTH_URL der Tests; so meldet sich die Verwaltung im Browser an
const WEB_ORIGIN = "https://cevi-os.invalid";

let welt: Welt;
let webmasterRolle: string;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  webmasterRolle = await holeWebmasterRolle(db, welt.testabteilungId);
});

const neu = (persona: Persona) => legePersonaAn(welt, persona);

type Kopf = Record<string, string>;

function anfrage(
  methode: string,
  pfad: string,
  { kopf = {}, body }: { kopf?: Kopf; body?: object } = {},
) {
  return app.request(pfad, {
    method: methode,
    headers: {
      "x-forwarded-for": zufallsIp(),
      ...(body && { "content-type": "application/json" }),
      ...kopf,
    },
    body: body && JSON.stringify(body),
  });
}

const anmelden = (konto: PersonaKonto, kopf: Kopf, passwort?: string) =>
  anfrage("POST", "/api/auth/sign-in/username", {
    kopf,
    body: {
      username: konto.benutzername,
      password: passwort ?? konto.passwort,
    },
  });

// Die Anmeldung der App: Origin des App-Schemas, kein Cookie
const alsApp = (konto: PersonaKonto, passwort?: string) =>
  anmelden(konto, { origin: APP_ORIGIN }, passwort);
// Die Anmeldung der Verwaltung im Browser
const alsBrowser = (konto: PersonaKonto) =>
  anmelden(konto, { origin: WEB_ORIGIN });

const mitCookie = (cookie: string, origin: string): Kopf => ({
  cookie,
  origin,
});

const get = (pfad: string, cookie: string, origin = APP_ORIGIN) =>
  anfrage("GET", pfad, { kopf: mitCookie(cookie, origin) });

// Anzahl Sitzungen des Kontos nach Markierung
async function sitzungen(userId: string) {
  const zeilen = await db
    .select({ geprueft: schema.session.zweiterFaktorGeprueft })
    .from(schema.session)
    .where(eq(schema.session.userId, userId));
  return {
    geprueft: zeilen.filter((z) => z.geprueft).length,
    ungeprueft: zeilen.filter((z) => !z.geprueft).length,
  };
}

// Das Konto mit Faktor, wie die Personas es kennen (Abteilungsleitung); die Anmeldung des Anlegens ist die geprüfte Sitzung
const kontoMitFaktor = () => neu("admin");

describe("Anmeldung der App bei einem Konto mit zweitem Faktor", () => {
  test("Origin des App-Schemas: Sitzung ohne Umleitung, markiert als nicht geprüft", async () => {
    const konto = await kontoMitFaktor();
    const vorher = await sitzungen(konto.id!);
    expect(vorher).toEqual({ geprueft: 1, ungeprueft: 0 });

    const antwort = await alsApp(konto);
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as Record<string, unknown>;
    expect(body.twoFactorRedirect).toBeUndefined();
    expect(body.token).toEqual(expect.any(String));
    expect(cookiesAus(antwort)).toContain("session_token");
    expect(await sitzungen(konto.id!)).toEqual({ geprueft: 1, ungeprueft: 1 });
  });

  test("expo-origin des Expo-Clients zählt wie Origin", async () => {
    const konto = await kontoMitFaktor();
    const antwort = await anmelden(konto, { "expo-origin": APP_ORIGIN });
    expect(antwort.status).toBe(200);
    expect(
      ((await antwort.json()) as { twoFactorRedirect?: boolean })
        .twoFactorRedirect,
    ).toBeUndefined();
    expect((await sitzungen(konto.id!)).ungeprueft).toBe(1);
  });

  test("ein Dev-Build meldet cevi-os://host:port: auch das ist die App", async () => {
    const konto = await kontoMitFaktor();
    const antwort = await anmelden(konto, {
      origin: "cevi-os://10.0.2.2:8081",
    });
    expect(antwort.status).toBe(200);
    expect((await sitzungen(konto.id!)).ungeprueft).toBe(1);
  });

  test("falsches Passwort: weiter 401, keine Sitzung (das Passwort bleibt Pflicht)", async () => {
    const konto = await kontoMitFaktor();
    const antwort = await alsApp(konto, "falsches-passwort-123");
    expect(antwort.status).toBe(401);
    expect(await antwort.json()).toMatchObject({
      code: "ANMELDUNG_FEHLGESCHLAGEN",
    });
    expect((await sitzungen(konto.id!)).ungeprueft).toBe(0);
  });

  test("ein Konto ohne zweiten Faktor meldet sich wie bisher an", async () => {
    const konto = await neu("elternA");
    const antwort = await alsApp(konto);
    expect(antwort.status).toBe(200);
    expect(((await antwort.json()) as { token?: string }).token).toBeTruthy();
  });
});

describe("Was die App-Sitzung darf", () => {
  let konto: PersonaKonto;
  let cookie: string;
  beforeAll(async () => {
    konto = await kontoMitFaktor();
    cookie = cookiesAus(await alsApp(konto));
  });

  test.each([
    "/api/v1/ich",
    "/api/v1/programme?von=2026-01-01&bis=2026-02-01",
    "/api/v1/chats",
  ])("GET %s: 200", async (pfad) => {
    expect((await get(pfad, cookie)).status).toBe(200);
  });

  test("/api/v1/ich zeigt das Konto: zweiterFaktor ist wahr, auch wenn die Sitzung ihn nicht geprüft hat", async () => {
    const antwort = await get("/api/v1/ich", cookie);
    expect(
      ((await antwort.json()) as { zweiterFaktor: boolean }).zweiterFaktor,
    ).toBe(true);
  });

  test("/api/v1/admin/*: 403 ZWEITER_FAKTOR_SITZUNG, nicht ZWEITER_FAKTOR_FEHLT", async () => {
    for (const pfad of [
      "/api/v1/admin/personen",
      "/api/v1/admin/plattform/rollen",
    ]) {
      const antwort = await get(pfad, cookie);
      expect(antwort.status, pfad).toBe(403);
      expect(await antwort.json(), pfad).toMatchObject({
        code: "ZWEITER_FAKTOR_SITZUNG",
      });
    }
  });

  test("dasselbe Konto mit dem Cookie einer geprüften Sitzung: 200", async () => {
    // Wie die Verwaltung: Anmeldung im Browser, Code, neue Sitzung
    const antwort = await alsBrowser(konto);
    const geprueft = await anfrage("POST", "/api/auth/two-factor/verify-totp", {
      kopf: mitCookie(cookiesAus(antwort), WEB_ORIGIN),
      body: { code: await totpCode(welt, konto.id!) },
    });
    expect(geprueft.status).toBe(200);
    const verwaltung = await get(
      "/api/v1/admin/personen",
      cookiesAus(geprueft),
      WEB_ORIGIN,
    );
    expect(verwaltung.status).toBe(200);
  });

  test("ein Recht mit «erweitert» (Webmaster-Rolle): 403 ZWEITER_FAKTOR_SITZUNG", async () => {
    const eltern = await neu("elternA");
    // Konto mit Faktor: über die Anmeldung im Browser (Code), dann die Rolle
    await db
      .insert(schema.personPlattformRolle)
      .values({ userId: eltern.id!, rolleId: webmasterRolle });
    const faktor = await richteFaktorEin(eltern);
    const appCookie = cookiesAus(await alsApp(faktor));
    const antwort = await get("/api/v1/redaktion/ich", appCookie);
    expect(antwort.status).toBe(403);
    expect(await antwort.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_SITZUNG",
    });
    // Dasselbe Konto mit geprüfter Sitzung (nach dem Einrichten): erlaubt
    const geprueft = await get(
      "/api/v1/redaktion/ich",
      faktor.headers.cookie,
      WEB_ORIGIN,
    );
    expect(geprueft.status).toBe(200);
  });

  test("ein Konto ohne Faktor mit «erweitert» sieht weiter ZWEITER_FAKTOR_FEHLT (Einrichtung)", async () => {
    const eltern = await neu("elternA");
    await db
      .insert(schema.personPlattformRolle)
      .values({ userId: eltern.id!, rolleId: webmasterRolle });
    const appCookie = cookiesAus(await alsApp(eltern));
    const antwort = await get("/api/v1/redaktion/ich", appCookie);
    expect(antwort.status).toBe(403);
    expect(await antwort.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
  });
});

describe("Der Entwickler braucht für die Verwaltung den zweiten Faktor wie die Abteilungsleitung (#735)", () => {
  const entwickler = async (persona: Persona) => {
    const konto = await neu(persona);
    await db.insert(schema.plattformEntwickler).values({ userId: konto.id! });
    return konto;
  };

  test("ohne Faktor: 403 ZWEITER_FAKTOR_FEHLT unter /api/v1/admin/* und /api/v1/redaktion", async () => {
    const konto = await entwickler("elternA");
    const cookie = cookiesAus(await alsBrowser(konto));
    for (const pfad of ["/api/v1/admin/personen", "/api/v1/redaktion/ich"]) {
      const antwort = await get(pfad, cookie, WEB_ORIGIN);
      expect(antwort.status, pfad).toBe(403);
      expect(await antwort.json(), pfad).toMatchObject({
        code: "ZWEITER_FAKTOR_FEHLT",
      });
    }
  });

  test("mit Faktor und geprüfter Sitzung: 200; in der App-Sitzung ZWEITER_FAKTOR_SITZUNG", async () => {
    const konto = await richteFaktorEin(await entwickler("elternA"));
    const geprueft = await get(
      "/api/v1/admin/personen",
      konto.headers.cookie,
      WEB_ORIGIN,
    );
    expect(geprueft.status).toBe(200);
    const app = await get(
      "/api/v1/admin/personen",
      cookiesAus(await alsApp(konto)),
    );
    expect(app.status).toBe(403);
    expect(await app.json()).toMatchObject({ code: "ZWEITER_FAKTOR_SITZUNG" });
  });
});

// Einrichten wie die Verwaltung (enable, erster Code): das Cookie der neuen, geprüften Sitzung
async function richteFaktorEin(konto: PersonaKonto): Promise<PersonaKonto> {
  const anmeldung = await alsBrowser(konto);
  const cookie = cookiesAus(anmeldung);
  const kopf = mitCookie(cookie, WEB_ORIGIN);
  const einrichten = await anfrage("POST", "/api/auth/two-factor/enable", {
    kopf,
    body: { password: konto.passwort },
  });
  expect(einrichten.status).toBe(200);
  const bestaetigt = await anfrage("POST", "/api/auth/two-factor/verify-totp", {
    kopf,
    body: { code: await totpCode(welt, konto.id!) },
  });
  expect(bestaetigt.status).toBe(200);
  return {
    ...konto,
    headers: { ...konto.headers, cookie: cookiesAus(bestaetigt) },
  };
}

describe("Anmeldung im Browser (Verwaltung)", () => {
  test("verlangt den Code: Umleitung, keine Sitzung; verify-totp legt eine geprüfte an", async () => {
    const konto = await kontoMitFaktor();
    const antwort = await alsBrowser(konto);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({ twoFactorRedirect: true });
    expect(cookiesAus(antwort)).not.toContain("session_token");
    expect(await sitzungen(konto.id!)).toEqual({ geprueft: 1, ungeprueft: 0 });

    const geprueft = await anfrage("POST", "/api/auth/two-factor/verify-totp", {
      kopf: mitCookie(cookiesAus(antwort), WEB_ORIGIN),
      body: { code: await totpCode(welt, konto.id!) },
    });
    expect(geprueft.status).toBe(200);
    expect(await sitzungen(konto.id!)).toEqual({ geprueft: 2, ungeprueft: 0 });
    expect(
      (await get("/api/v1/admin/personen", cookiesAus(geprueft), WEB_ORIGIN))
        .status,
    ).toBe(200);
  });

  test("get-session zeigt die Markierung, die die Verwaltung liest", async () => {
    const konto = await kontoMitFaktor();
    const appCookie = cookiesAus(await alsApp(konto));
    const app1 = await get("/api/auth/get-session", appCookie);
    expect(await app1.json()).toMatchObject({
      session: { zweiterFaktorGeprueft: false },
      user: { twoFactorEnabled: true },
    });
    const web = await get("/api/auth/get-session", konto.headers.cookie);
    expect(await web.json()).toMatchObject({
      session: { zweiterFaktorGeprueft: true },
    });
  });

  test("ohne Origin (kein App-Schema): ebenfalls Umleitung", async () => {
    const konto = await kontoMitFaktor();
    const antwort = await anmelden(konto, {});
    expect(await antwort.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await sitzungen(konto.id!)).ungeprueft).toBe(0);
  });

  test("fremdes Schema oder Webseite als Origin: keine App-Anmeldung (Umleitung oder 403 der Herkunftsprüfung)", async () => {
    const konto = await kontoMitFaktor();
    for (const origin of ["https://fremd.invalid", "cevi-os.evil://", "null"]) {
      const antwort = await anmelden(konto, { origin });
      // Entweder die Herkunftsprüfung lehnt ab, oder es gilt der Weg mit Code: eine Sitzung ohne Code gibt es nie
      expect([200, 401, 403], origin).toContain(antwort.status);
      if (antwort.status === 200) {
        expect(await antwort.json(), origin).toMatchObject({
          twoFactorRedirect: true,
        });
      }
    }
    expect((await sitzungen(konto.id!)).ungeprueft).toBe(0);
  });

  test("backup-Code in der Anmeldung: auch das ergibt eine geprüfte Sitzung", async () => {
    const eltern = await neu("elternA");
    const anmeldung = await alsBrowser(eltern);
    expect(anmeldung.status).toBe(200);
    const kopf = mitCookie(cookiesAus(anmeldung), WEB_ORIGIN);
    const einrichten = await anfrage("POST", "/api/auth/two-factor/enable", {
      kopf,
      body: { password: eltern.passwort },
    });
    const { backupCodes } = (await einrichten.json()) as {
      backupCodes: string[];
    };
    const aktiv = await anfrage("POST", "/api/auth/two-factor/verify-totp", {
      kopf,
      body: { code: await totpCode(welt, eltern.id!) },
    });
    expect(aktiv.status).toBe(200);

    const neueAnmeldung = await alsBrowser(eltern);
    expect(await neueAnmeldung.json()).toMatchObject({
      twoFactorRedirect: true,
    });
    const vorher = (await sitzungen(eltern.id!)).geprueft;
    const geprueft = await anfrage(
      "POST",
      "/api/auth/two-factor/verify-backup-code",
      {
        kopf: mitCookie(cookiesAus(neueAnmeldung), WEB_ORIGIN),
        body: { code: backupCodes[0] },
      },
    );
    expect(geprueft.status).toBe(200);
    expect(await sitzungen(eltern.id!)).toEqual({
      geprueft: vorher + 1,
      ungeprueft: 0,
    });
  });
});

describe("Die Markierung lässt sich nicht umgehen", () => {
  test.each(["verify-totp", "verify-backup-code"])(
    "eine App-Sitzung holt den Code nicht nach (%s): 403 ZWEITER_FAKTOR_SITZUNG, die Sitzung bleibt nicht geprüft",
    async (pfad) => {
      const konto = await kontoMitFaktor();
      const cookie = cookiesAus(await alsApp(konto));
      const antwort = await anfrage("POST", `/api/auth/two-factor/${pfad}`, {
        kopf: mitCookie(cookie, APP_ORIGIN),
        body: {
          code:
            pfad === "verify-totp"
              ? await totpCode(welt, konto.id!)
              : "aaaaa-bbbbb",
        },
      });
      expect(antwort.status).toBe(403);
      expect(await antwort.json()).toMatchObject({
        code: "ZWEITER_FAKTOR_SITZUNG",
      });
      expect((await sitzungen(konto.id!)).ungeprueft).toBe(1);
      expect(
        (await get("/api/v1/admin/personen", cookie, WEB_ORIGIN)).status,
      ).toBe(403);
    },
  );

  test("ein Skript mit Origin des App-Schemas und gestohlenem Passwort bekommt eine Sitzung, aber keinen Weg in die Verwaltung", async () => {
    const konto = await kontoMitFaktor();
    const cookie = cookiesAus(await alsApp(konto));
    // Auch mit Origin einer Webseite im Aufruf: Die Sitzung entscheidet, nicht der Header
    for (const origin of [APP_ORIGIN, WEB_ORIGIN]) {
      const antwort = await get("/api/v1/admin/personen", cookie, origin);
      expect(antwort.status, origin).toBe(403);
      expect(await antwort.json(), origin).toMatchObject({
        code: "ZWEITER_FAKTOR_SITZUNG",
      });
    }
  });

  test("zweiten Faktor neu einrichten (enable) aus der App-Sitzung geht nicht: TOTP_ALREADY_ENABLED", async () => {
    const konto = await kontoMitFaktor();
    const cookie = cookiesAus(await alsApp(konto));
    const antwort = await anfrage("POST", "/api/auth/two-factor/enable", {
      kopf: mitCookie(cookie, APP_ORIGIN),
      body: { password: konto.passwort },
    });
    expect(antwort.status).toBe(400);
    expect(await antwort.json()).toMatchObject({
      code: "TOTP_ALREADY_ENABLED",
    });
  });

  test("Passwort ändern: die neue Sitzung erbt den Stand (geprüft bleibt geprüft, nicht geprüft bleibt nicht geprüft)", async () => {
    const neuesPasswort = "ein-ganz-anderes-passwort-9";
    const web = await kontoMitFaktor();
    const aendern = await anfrage("POST", "/api/auth/change-password", {
      kopf: mitCookie(web.headers.cookie, WEB_ORIGIN),
      body: {
        currentPassword: web.passwort,
        newPassword: neuesPasswort,
      },
    });
    expect(aendern.status).toBe(200);
    expect(await sitzungen(web.id!)).toEqual({ geprueft: 1, ungeprueft: 0 });

    const appKonto = await kontoMitFaktor();
    const appCookie = cookiesAus(await alsApp(appKonto));
    const appAendern = await anfrage("POST", "/api/auth/change-password", {
      kopf: mitCookie(appCookie, APP_ORIGIN),
      body: {
        currentPassword: appKonto.passwort,
        newPassword: neuesPasswort,
      },
    });
    expect(appAendern.status).toBe(200);
    // Alle anderen Sitzungen sind beendet; übrig bleibt die der App, weiter nicht geprüft
    expect(await sitzungen(appKonto.id!)).toEqual({
      geprueft: 0,
      ungeprueft: 1,
    });
  });

  test("Einschalten des Faktors beendet die anderen Sitzungen; die neue ist geprüft", async () => {
    const eltern = await neu("elternA");
    const appCookie = cookiesAus(await alsApp(eltern));
    expect(appCookie).toContain("session_token");
    const faktor = await richteFaktorEin(eltern);
    expect(await sitzungen(faktor.id!)).toEqual({ geprueft: 1, ungeprueft: 0 });
    expect(
      await db
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(
          and(
            eq(schema.session.userId, faktor.id!),
            eq(schema.session.zweiterFaktorGeprueft, false),
          ),
        ),
    ).toHaveLength(0);
  });
});
