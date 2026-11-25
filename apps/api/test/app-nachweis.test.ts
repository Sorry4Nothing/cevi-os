import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql as roh } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { bindung, hashVon } from "../src/app-nachweis/bindung.js";
import {
  erstelleAppNachweisDienst,
  erstelleGeraeteablage,
  type AppNachweisDienst,
} from "../src/app-nachweis/dienst.js";
import { beendeUngepruefteAppSitzungen } from "../src/app-nachweis/index.js";
import { erstelleIosPruefer } from "../src/app-nachweis/ios.js";
import type {
  AndroidEingabe,
  NachweisPruefer,
} from "../src/app-nachweis/typen.js";
import { erstelleApp } from "../src/app.js";
import { erstelleAuth } from "../src/auth.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, cookiesAus, zufallsIp } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { BUNDLE, neuePki, TEAM, TestGeraet } from "./hilfen/app-attest.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// App-Nachweis (#785) von der Herausforderung bis zur Anmeldung, in den drei Modi. Die Prüfer von Google und Apple sind teils Attrappen (Android: das Token «ok:<Bindung>» gilt), teils echt gegen erzeugte Fixtures (iOS). Echte Antworten von Google und Apple sind NICHT getestet.
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

const APP_ORIGIN = "cevi-os://";
const WEB_ORIGIN = "https://cevi-os.invalid";
const PAKET = "ch.example.cevios";

// Android-Attrappe: Das Token «ok:<erwartete Bindung>» ist gültig, jedes andere nicht
const androidAttrappe: NachweisPruefer<AndroidEingabe> = {
  pruefe: async ({ nonce, integrityToken }) =>
    integrityToken === `ok:${nonce}`
      ? { ok: true, plattform: "android", geraetOk: true }
      : { ok: false, grund: "token" },
};

const pki = neuePki();
const geraete = erstelleGeraeteablage(db);
const iosPruefer = erstelleIosPruefer({
  teamId: TEAM,
  bundleId: BUNDLE,
  umgebung: "development",
  wurzel: pki.wurzel.pem,
  geraete,
});

function aufbau(modus?: "pruefen" | "pflicht") {
  const dienst = modus
    ? erstelleAppNachweisDienst({
        db,
        modus,
        android: androidAttrappe,
        ios: iosPruefer,
        parameter: {
          android: { plattform: "android", paketname: PAKET },
          ios: {
            plattform: "ios",
            appId: `${TEAM}.${BUNDLE}`,
            umgebung: "development",
          },
        },
      })
    : undefined;
  const auth = erstelleAuth(
    drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    { appNachweis: dienst },
  );
  const app = erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    seiten: ladeSeiten(),
    appNachweis: dienst,
  });
  return { dienst: dienst as AppNachweisDienst, auth, app };
}

const aus = aufbau();
const pruefen = aufbau("pruefen");
const pflicht = aufbau("pflicht");

// Die Konten legt eine Welt mit der Auth der Tests an
let welt: Welt;
beforeAll(async () => {
  welt = await erstelleWelt(db, aus.auth);
});
const neu = (persona: Persona) => legePersonaAn(welt, persona);

type Aufbau = { app: ReturnType<typeof aufbau>["app"] };
const post = (
  { app }: Aufbau,
  pfad: string,
  body: object,
  kopf: Record<string, string> = {},
) =>
  app.request(pfad, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": zufallsIp(),
      ...kopf,
    },
    body: JSON.stringify(body),
  });

const challenge = async (a: Aufbau, plattform: "android" | "ios") => {
  const antwort = await post(a, "/api/v1/app/nachweis/challenge", {
    plattform,
  });
  expect(antwort.status).toBe(200);
  return (await antwort.json()) as { nonce: string; laeuftAb: string };
};

// Android: Challenge holen, Token zur Bindung bilden, Nachweis schicken; liefert das Ticket
async function androidTicket(a: Aufbau, benutzername: string) {
  const { nonce } = await challenge(a, "android");
  const gebunden = bindung(nonce, benutzername).toString("base64url");
  const antwort = await post(a, "/api/v1/app/nachweis", {
    plattform: "android",
    nonce,
    benutzername,
    integrityToken: `ok:${gebunden}`,
  });
  expect(antwort.status).toBe(200);
  return ((await antwort.json()) as { ticket: string }).ticket;
}

const anmelden = (
  a: Aufbau,
  konto: PersonaKonto,
  kopf: Record<string, string>,
  passwort = konto.passwort,
) =>
  post(
    a,
    "/api/auth/sign-in/username",
    { username: konto.benutzername, password: passwort },
    kopf,
  );

const clientArtVon = async (userId: string) =>
  (
    await db
      .select({ art: schema.session.clientArt })
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
  ).map((z) => z.art);

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

describe("Herausforderung", () => {
  test("liefert Nonce, Ablauf und die Parameter der Plattform; in der Datenbank nur der Hash", async () => {
    const a = await post(pruefen, "/api/v1/app/nachweis/challenge", {
      plattform: "android",
    });
    expect(a.status).toBe(200);
    const body = (await a.json()) as Record<string, string>;
    expect(body).toMatchObject({ plattform: "android", paketname: PAKET });
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const frist = new Date(body.laeuftAb).getTime() - Date.now();
    expect(frist).toBeGreaterThan(4 * 60_000);
    expect(frist).toBeLessThanOrEqual(5 * 60_000 + 5000);
    const zeilen = await db
      .select()
      .from(schema.appNachweisChallenge)
      .where(eq(schema.appNachweisChallenge.plattform, "android"));
    expect(JSON.stringify(zeilen)).not.toContain(body.nonce);

    const ios = await (
      await post(pruefen, "/api/v1/app/nachweis/challenge", {
        plattform: "ios",
      })
    ).json();
    expect(ios).toMatchObject({
      plattform: "ios",
      appId: `${TEAM}.${BUNDLE}`,
      umgebung: "development",
    });
  });

  test("zwei Herausforderungen haben verschiedene Nonces", async () => {
    const [x, y] = [
      await challenge(pruefen, "android"),
      await challenge(pruefen, "android"),
    ];
    expect(x.nonce).not.toBe(y.nonce);
  });

  test("unbekannte Plattform und fremde Felder: 400", async () => {
    for (const body of [
      { plattform: "web" },
      {},
      { plattform: "ios", extra: 1 },
    ]) {
      expect(
        (await post(pruefen, "/api/v1/app/nachweis/challenge", body)).status,
      ).toBe(400);
    }
  });

  test("ohne Nachweis (APP_NACHWEIS=aus) gibt es die Routen nicht", async () => {
    for (const pfad of [
      "/api/v1/app/nachweis/challenge",
      "/api/v1/app/nachweis",
    ]) {
      const antwort = await post(aus, pfad, { plattform: "android" });
      expect(antwort.status).toBe(404);
      expect(await antwort.json()).toEqual({
        code: "NICHT_GEFUNDEN",
        message: "Nicht gefunden",
      });
    }
  });

  test("Body über 64 KiB: 413", async () => {
    const antwort = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce: "x".repeat(70 * 1024),
    });
    expect(antwort.status).toBe(413);
  });

  test("strenges Limit je Adresse: 30 je 15 Minuten, danach 429", async () => {
    const ip = zufallsIp();
    const holen = () =>
      post(
        pruefen,
        "/api/v1/app/nachweis/challenge",
        { plattform: "android" },
        { "x-forwarded-for": ip },
      );
    for (let i = 0; i < 30; i++) expect((await holen()).status).toBe(200);
    const zuviel = await holen();
    expect(zuviel.status).toBe(429);
    expect(await zuviel.json()).toMatchObject({ code: "ZU_VIELE_ANFRAGEN" });
    // Eine andere Adresse ist nicht betroffen
    expect(
      (
        await post(pruefen, "/api/v1/app/nachweis/challenge", {
          plattform: "android",
        })
      ).status,
    ).toBe(200);
  });

  test("zu viele offene Herausforderungen: 429", async () => {
    // Die Obergrenze liegt bei 5000; die Zeilen kommen direkt in die Datenbank
    const vorher = await db
      .select({ n: roh<number>`count(*)::int` })
      .from(schema.appNachweisChallenge)
      .where(roh`laeuft_ab_am > now()`);
    const fehlt = Math.max(0, 5000 - (vorher[0]?.n ?? 0));
    if (fehlt > 0) {
      await db.execute(roh`
        insert into app_nachweis_challenge (nonce_hash, plattform, laeuft_ab_am)
        select 'fuellung-' || g || '-' || gen_random_uuid(), 'android', now() + interval '5 minutes'
        from generate_series(1, ${fehlt}) g`);
    }
    try {
      const antwort = await post(pruefen, "/api/v1/app/nachweis/challenge", {
        plattform: "android",
      });
      expect(antwort.status).toBe(429);
    } finally {
      await db.execute(
        roh`delete from app_nachweis_challenge where nonce_hash like 'fuellung-%'`,
      );
    }
  });
});

describe("Nachweis", () => {
  test("gültig: ein Ticket; nur sein Hash in der Datenbank", async () => {
    const konto = await neu("elternA");
    const ticket = await androidTicket(pruefen, konto.benutzername!);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const zeilen = await db.select().from(schema.appNachweisChallenge);
    expect(JSON.stringify(zeilen)).not.toContain(ticket);
  });

  test("Bindung an die Anfrage: ein Token für einen anderen Benutzernamen ist ungültig", async () => {
    const { nonce } = await challenge(pruefen, "android");
    const antwort = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "anna",
      integrityToken: `ok:${bindung(nonce, "berta").toString("base64url")}`,
    });
    expect(antwort.status).toBe(401);
    expect(await antwort.json()).toEqual({
      code: "APP_NACHWEIS_UNGUELTIG",
      message: "Der Nachweis der App ist ungültig.",
    });
  });

  test("Gross- und Kleinschreibung des Benutzernamens ändert die Bindung nicht", async () => {
    const { nonce } = await challenge(pruefen, "android");
    const antwort = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "Anna",
      integrityToken: `ok:${bindung(nonce, "anna").toString("base64url")}`,
    });
    expect(antwort.status).toBe(200);
  });

  test("einmalig: dieselbe Herausforderung gilt nicht zweimal", async () => {
    const { nonce } = await challenge(pruefen, "android");
    const body = {
      plattform: "android",
      nonce,
      benutzername: "anna",
      integrityToken: `ok:${bindung(nonce, "anna").toString("base64url")}`,
    };
    expect((await post(pruefen, "/api/v1/app/nachweis", body)).status).toBe(
      200,
    );
    expect((await post(pruefen, "/api/v1/app/nachweis", body)).status).toBe(
      401,
    );
  });

  test("ein gescheiterter Versuch verbraucht die Herausforderung", async () => {
    const { nonce } = await challenge(pruefen, "android");
    const falsch = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "anna",
      integrityToken: "manipuliert",
    });
    expect(falsch.status).toBe(401);
    const richtig = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "anna",
      integrityToken: `ok:${bindung(nonce, "anna").toString("base64url")}`,
    });
    expect(richtig.status).toBe(401);
  });

  test("abgelaufen: nach 5 Minuten ungültig", async () => {
    const { nonce } = await challenge(pruefen, "android");
    await db.execute(
      roh`update app_nachweis_challenge set laeuft_ab_am = now() - interval '1 second' where nonce_hash = encode(sha256(${nonce}::bytea), 'hex')`,
    );
    const antwort = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "anna",
      integrityToken: `ok:${bindung(nonce, "anna").toString("base64url")}`,
    });
    expect(antwort.status).toBe(401);
  });

  test("Herausforderung einer anderen Plattform und erfundene Nonce: ungültig", async () => {
    const { nonce } = await challenge(pruefen, "ios");
    const ios = new TestGeraet(pki);
    const hashFalsch = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "anna",
      integrityToken: `ok:${bindung(nonce, "anna").toString("base64url")}`,
    });
    expect(hashFalsch.status).toBe(401);
    const erfunden = await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "ios",
      nonce: "A".repeat(43),
      benutzername: "anna",
      schluesselId: ios.schluesselId,
      attestation: ios.attestiere(bindung("A".repeat(43), "anna")),
    });
    expect(erfunden.status).toBe(401);
  });

  test("falsch aufgebaute Eingabe: 400", async () => {
    const { nonce } = await challenge(pruefen, "android");
    for (const body of [
      { plattform: "android", nonce, benutzername: "anna" },
      {
        plattform: "android",
        nonce,
        benutzername: "anna",
        integrityToken: "x",
        attestation: "x",
      },
      { plattform: "ios", nonce, benutzername: "anna", schluesselId: "x" },
      {
        plattform: "android",
        nonce: "kurz",
        benutzername: "a",
        integrityToken: "x",
      },
      {
        plattform: "android",
        nonce,
        benutzername: "anna",
        integrityToken: "x".repeat(16 * 1024 + 1),
      },
    ]) {
      expect((await post(pruefen, "/api/v1/app/nachweis", body)).status).toBe(
        400,
      );
    }
  });

  test("ungültiger Nachweis erscheint im Log ohne Token und Benutzername", async () => {
    const { nonce } = await challenge(pruefen, "android");
    await post(pruefen, "/api/v1/app/nachweis", {
      plattform: "android",
      nonce,
      benutzername: "geheimer-benutzer",
      integrityToken: "geheimes-token",
    });
    const zeilen = ausgabe.mock.calls.map((c) => String(c[0]));
    expect(zeilen.some((z) => z.includes('"ereignis":"app_nachweis"'))).toBe(
      true,
    );
    for (const z of zeilen) {
      expect(z).not.toContain("geheimes-token");
      expect(z).not.toContain("geheimer-benutzer");
      expect(z).not.toContain(nonce);
    }
  });

  test("Limit je Adresse: 30 Nachweise, dann 429", async () => {
    const ip = zufallsIp();
    const senden = () =>
      post(
        pruefen,
        "/api/v1/app/nachweis",
        {
          plattform: "android",
          nonce: "A".repeat(43),
          benutzername: "anna",
          integrityToken: "x",
        },
        { "x-forwarded-for": ip },
      );
    for (let i = 0; i < 30; i++) expect((await senden()).status).toBe(401);
    expect((await senden()).status).toBe(429);
  });
});

describe("Anmeldung der App", () => {
  test("aus: der Origin entscheidet wie bisher, die Sitzung ist «app_ungeprueft»; ein Ticket im Header ändert nichts", async () => {
    const konto = await neu("elternA");
    const antwort = await anmelden(aus, konto, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": "A".repeat(43),
    });
    expect(antwort.status).toBe(200);
    expect(cookiesAus(antwort)).toContain("session_token");
    expect(await clientArtVon(konto.id!)).toContain("app_ungeprueft");
    const web = await neu("elternB");
    expect((await anmelden(aus, web, { origin: WEB_ORIGIN })).status).toBe(200);
    expect(await clientArtVon(web.id!)).not.toContain("app_ungeprueft");
  });

  test("aus, ohne Origin der App und ohne Origin überhaupt: «web»", async () => {
    const konto = await neu("elternA");
    expect((await anmelden(aus, konto, {})).status).toBe(200);
    expect((await clientArtVon(konto.id!)).filter((a) => a !== "web")).toEqual(
      [],
    );
  });

  test("pruefen: mit gültigem Ticket «app_nachgewiesen»", async () => {
    const konto = await neu("elternA");
    const ticket = await androidTicket(pruefen, konto.benutzername!);
    const antwort = await anmelden(pruefen, konto, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": ticket,
    });
    expect(antwort.status).toBe(200);
    expect(await clientArtVon(konto.id!)).toContain("app_nachgewiesen");
    // GET /ich zeigt es
    const cookie = cookiesAus(antwort);
    const ich = await pruefen.app.request("/api/v1/ich", {
      headers: { cookie, origin: APP_ORIGIN },
    });
    expect(await ich.json()).toMatchObject({ clientArt: "app_nachgewiesen" });
  });

  test("pruefen: ohne oder mit ungültigem Ticket meldet sich die App an, die Sitzung ist «app_ungeprueft»", async () => {
    const konto = await neu("elternA");
    const koepfe: Record<string, string>[] = [
      { origin: APP_ORIGIN },
      { origin: APP_ORIGIN, "x-cevi-nachweis": "A".repeat(43) },
      { origin: APP_ORIGIN, "x-cevi-nachweis": "kein ticket" },
    ];
    for (const kopf of koepfe) {
      expect((await anmelden(pruefen, konto, kopf)).status).toBe(200);
    }
    const arten = await clientArtVon(konto.id!);
    expect(arten.filter((a) => a === "app_ungeprueft")).toHaveLength(3);
    // Das Ergebnis steht im Log, ohne das Ticket
    const zeilen = ausgabe.mock.calls.map((c) => String(c[0]));
    expect(
      zeilen.some(
        (z) => z.includes('"schritt":"anmeldung"') && z.includes('"fehlt"'),
      ),
    ).toBe(true);
    expect(zeilen.some((z) => z.includes("kein ticket"))).toBe(false);
  });

  test("pruefen: die Anmeldung im Browser bleibt «web» (mit Faktor: Umleitung zum Code)", async () => {
    const konto = await neu("admin");
    const antwort = await anmelden(pruefen, konto, { origin: WEB_ORIGIN });
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({ twoFactorRedirect: true });
  });

  test("pflicht: ohne Ticket 401 APP_NACHWEIS_FEHLT, auch mit richtigem Passwort", async () => {
    const konto = await neu("elternA");
    const antwort = await anmelden(pflicht, konto, { origin: APP_ORIGIN });
    expect(antwort.status).toBe(401);
    expect(await antwort.json()).toEqual({
      code: "APP_NACHWEIS_FEHLT",
      message: "Die Anmeldung der App braucht den Nachweis des Geräts.",
    });
    expect(cookiesAus(antwort)).toBe("");
    expect(await clientArtVon(konto.id!)).not.toContain("app_ungeprueft");
  });

  test("pflicht: ein erfundener oder kaputter Ticket-Header 401 APP_NACHWEIS_UNGUELTIG", async () => {
    const konto = await neu("elternA");
    for (const ticket of ["A".repeat(43), "kurz", "x".repeat(5000)]) {
      const antwort = await anmelden(pflicht, konto, {
        origin: APP_ORIGIN,
        "x-cevi-nachweis": ticket,
      });
      expect(antwort.status).toBe(401);
      expect(await antwort.json()).toMatchObject({
        code: "APP_NACHWEIS_UNGUELTIG",
      });
    }
  });

  test("pflicht: gültiges Ticket, Sitzung «app_nachgewiesen», ohne zweiten Faktor wie heute", async () => {
    const konto = await neu("admin");
    const ticket = await androidTicket(pflicht, konto.benutzername!);
    const antwort = await anmelden(pflicht, konto, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": ticket,
    });
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBeUndefined();
    const sitzungen = await db
      .select({
        art: schema.session.clientArt,
        geprueft: schema.session.zweiterFaktorGeprueft,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, konto.id!));
    expect(sitzungen.filter((s) => s.art === "app_nachgewiesen")).toEqual([
      { art: "app_nachgewiesen", geprueft: false },
    ]);
    // Die Verwaltung bleibt der Sitzung der App verschlossen
    const verwaltung = await pflicht.app.request("/api/v1/admin/personen", {
      headers: { cookie: cookiesAus(antwort), origin: APP_ORIGIN },
    });
    expect(verwaltung.status).toBe(403);
    expect(await verwaltung.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_SITZUNG",
    });
  });

  test("pflicht: das Ticket gilt einmal", async () => {
    const konto = await neu("elternA");
    const ticket = await androidTicket(pflicht, konto.benutzername!);
    const kopf = { origin: APP_ORIGIN, "x-cevi-nachweis": ticket };
    expect((await anmelden(pflicht, konto, kopf)).status).toBe(200);
    const zweites = await anmelden(pflicht, konto, kopf);
    expect(zweites.status).toBe(401);
    expect(await zweites.json()).toMatchObject({
      code: "APP_NACHWEIS_UNGUELTIG",
    });
  });

  test("pflicht: das Ticket gilt nur für den Benutzernamen, an den es gebunden wurde", async () => {
    const [anna, berta] = [await neu("elternA"), await neu("elternB")];
    const ticket = await androidTicket(pflicht, anna.benutzername!);
    const antwort = await anmelden(pflicht, berta, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": ticket,
    });
    expect(antwort.status).toBe(401);
    expect(await antwort.json()).toMatchObject({
      code: "APP_NACHWEIS_UNGUELTIG",
    });
    // Ein fremder Name löst es nicht ein: Anna kann es noch einmal brauchen
    const nochmal = await anmelden(pflicht, anna, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": ticket,
    });
    expect(nochmal.status).toBe(200);
  });

  test("pflicht: ein abgelaufenes Ticket (2 Minuten) ist ungültig", async () => {
    const konto = await neu("elternA");
    const ticket = await androidTicket(pflicht, konto.benutzername!);
    await db.execute(
      roh`update app_nachweis_challenge set ticket_laeuft_ab_am = now() - interval '1 second' where ticket_hash = encode(sha256(${ticket}::bytea), 'hex')`,
    );
    const antwort = await anmelden(pflicht, konto, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": ticket,
    });
    expect(antwort.status).toBe(401);
  });

  test("pflicht: falsches Passwort mit gültigem Ticket gibt die übliche Meldung, nicht den Code des Nachweises", async () => {
    const konto = await neu("elternA");
    const ticket = await androidTicket(pflicht, konto.benutzername!);
    const antwort = await anmelden(
      pflicht,
      konto,
      { origin: APP_ORIGIN, "x-cevi-nachweis": ticket },
      "falsches-passwort-1234",
    );
    expect(antwort.status).toBe(401);
    expect(await antwort.json()).toMatchObject({
      code: "ANMELDUNG_FEHLGESCHLAGEN",
    });
  });

  test("pflicht: ein unbekannter Benutzername verrät sich nicht (Nachweis wird vor dem Passwort geprüft)", async () => {
    const fehlt = await post(
      pflicht,
      "/api/auth/sign-in/username",
      { username: "gibt.es.nicht", password: "irgendwas-langes-1" },
      { origin: APP_ORIGIN },
    );
    expect(fehlt.status).toBe(401);
    expect(await fehlt.json()).toMatchObject({ code: "APP_NACHWEIS_FEHLT" });
    // Mit gültigem Ticket auf den erfundenen Namen: dieselbe Meldung wie bei falschem Passwort
    const ticket = await androidTicket(pflicht, "gibt.es.nicht");
    const mitTicket = await post(
      pflicht,
      "/api/auth/sign-in/username",
      { username: "gibt.es.nicht", password: "irgendwas-langes-1" },
      { origin: APP_ORIGIN, "x-cevi-nachweis": ticket },
    );
    expect(await mitTicket.json()).toMatchObject({
      code: "ANMELDUNG_FEHLGESCHLAGEN",
    });
  });

  test("pflicht: der Origin allein genügt nie, auch nicht als expo-origin", async () => {
    const konto = await neu("elternA");
    const antwort = await anmelden(pflicht, konto, {
      "expo-origin": APP_ORIGIN,
    });
    expect(antwort.status).toBe(401);
    expect(await antwort.json()).toMatchObject({ code: "APP_NACHWEIS_FEHLT" });
  });

  test("pflicht: die Anmeldung im Browser ändert sich nicht", async () => {
    const konto = await neu("elternA");
    expect(
      (await anmelden(pflicht, konto, { origin: WEB_ORIGIN })).status,
    ).toBe(200);
    const ohneOrigin = await anmelden(pflicht, konto, {});
    expect(ohneOrigin.status).toBe(200);
  });

  test("die Sitzung erbt «app_nachgewiesen» beim Passwortwechsel", async () => {
    const konto = await neu("elternA");
    const ticket = await androidTicket(pflicht, konto.benutzername!);
    const anmeldung = await anmelden(pflicht, konto, {
      origin: APP_ORIGIN,
      "x-cevi-nachweis": ticket,
    });
    const cookie = cookiesAus(anmeldung);
    const wechsel = await post(
      pflicht,
      "/api/auth/change-password",
      {
        currentPassword: konto.passwort,
        newPassword: "ein-ganz-neues-passwort-2",
      },
      { cookie, origin: APP_ORIGIN },
    );
    expect(wechsel.status).toBe(200);
    expect(await clientArtVon(konto.id!)).toEqual(["app_nachgewiesen"]);
  });

  test("Sitzungen von «app_ungeprueft» enden beim Umschalten auf «pflicht»", async () => {
    const konto = await neu("elternB");
    await anmelden(pruefen, konto, { origin: APP_ORIGIN });
    const web = await neu("elternA");
    await anmelden(pruefen, web, { origin: WEB_ORIGIN });
    const beendet = await beendeUngepruefteAppSitzungen(db);
    expect(beendet).toBeGreaterThanOrEqual(1);
    expect(await clientArtVon(konto.id!)).not.toContain("app_ungeprueft");
    expect(await clientArtVon(web.id!)).toContain("web");
  });
});

describe("Anmeldung mit Apple App Attest (Attestation, dann Assertions)", () => {
  async function iosTicket(
    a: Aufbau,
    geraet: TestGeraet,
    benutzername: string,
    art: "attestation" | "assertion",
    assertionZaehler?: number,
  ) {
    const { nonce } = await challenge(a, "ios");
    const hash = bindung(nonce, benutzername);
    const antwort = await post(a, "/api/v1/app/nachweis", {
      plattform: "ios",
      nonce,
      benutzername,
      schluesselId: geraet.schluesselId,
      ...(art === "attestation"
        ? { attestation: geraet.attestiere(hash) }
        : {
            assertion: geraet.assertiere(hash, { zaehler: assertionZaehler }),
          }),
    });
    return antwort;
  }

  test("Ablauf: Attestation, Anmeldung, Schlüssel gehört dem Konto; danach Assertion mit steigendem Zähler", async () => {
    const konto = await neu("elternA");
    const geraet = new TestGeraet(pki);
    const erste = await iosTicket(
      pflicht,
      geraet,
      konto.benutzername!,
      "attestation",
    );
    expect(erste.status).toBe(200);
    const { ticket } = (await erste.json()) as { ticket: string };
    expect(
      (
        await anmelden(pflicht, konto, {
          origin: APP_ORIGIN,
          "x-cevi-nachweis": ticket,
        })
      ).status,
    ).toBe(200);
    const [zeile] = await db
      .select()
      .from(schema.appNachweisGeraet)
      .where(eq(schema.appNachweisGeraet.schluesselId, geraet.schluesselId));
    expect(zeile).toMatchObject({ userId: konto.id, zaehler: 0 });
    expect(zeile?.oeffentlicherSchluessel).toBeTruthy();

    const zweite = await iosTicket(
      pflicht,
      geraet,
      konto.benutzername!,
      "assertion",
      1,
    );
    expect(zweite.status).toBe(200);
    const [nachher] = await db
      .select({ zaehler: schema.appNachweisGeraet.zaehler })
      .from(schema.appNachweisGeraet)
      .where(eq(schema.appNachweisGeraet.schluesselId, geraet.schluesselId));
    expect(nachher?.zaehler).toBe(1);
    // Dieselbe Assertion noch einmal (Zähler 1) wird abgelehnt
    const wiederholt = await iosTicket(
      pflicht,
      geraet,
      konto.benutzername!,
      "assertion",
      1,
    );
    expect(wiederholt.status).toBe(401);
  });

  test("Attestation einer fremden Kette gibt kein Ticket", async () => {
    const fremd = new TestGeraet(neuePki());
    const antwort = await iosTicket(pflicht, fremd, "anna", "attestation");
    expect(antwort.status).toBe(401);
  });

  test("zwei Geräte desselben Kontos und ein Gerät mit zwei Konten sind möglich", async () => {
    const [anna, berta] = [await neu("elternA"), await neu("elternB")];
    const geraet = new TestGeraet(pki);
    const a1 = await iosTicket(
      pflicht,
      geraet,
      anna.benutzername!,
      "attestation",
    );
    expect(a1.status).toBe(200);
    const b1 = await iosTicket(
      pflicht,
      geraet,
      berta.benutzername!,
      "assertion",
      1,
    );
    expect(b1.status).toBe(200);
  });
});

describe("Aufräumen", () => {
  test("löscht Herausforderungen, die seit über einer Stunde abgelaufen sind, und nur diese", async () => {
    const alt = await challenge(pruefen, "android");
    const frisch = await challenge(pruefen, "android");
    await db.execute(
      roh`update app_nachweis_challenge set laeuft_ab_am = now() - interval '2 hours' where nonce_hash = encode(sha256(${alt.nonce}::bytea), 'hex')`,
    );
    const anzahl = await pruefen.dienst.raeumeAuf();
    expect(anzahl).toBeGreaterThanOrEqual(1);
    const uebrig = await db
      .select({ h: schema.appNachweisChallenge.nonceHash })
      .from(schema.appNachweisChallenge);
    expect(uebrig.length).toBeGreaterThan(0);
    const hashes = uebrig.map((z) => z.h);
    expect(hashes).toContain(hashVon(frisch.nonce));
    expect(hashes).not.toContain(hashVon(alt.nonce));
  });
});
