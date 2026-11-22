import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import {
  erstelleZaehler,
  hashVonCode,
  neuerRueckfragecode,
} from "../../src/lager/eingang.js";
import type { Fcm } from "../../src/push.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Zählt jede Abfrage der API (für den Test «Abfragen je Seite»)
let abfragen = 0;
const sql = postgres(API_URL, { debug: () => void abfragen++ });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt firebase-admin: Kein Netz, keine Schlüssel
let gesendet: { token: string; notification?: unknown; data?: unknown }[];
const fcm: Fcm = {
  async sendEach(nachrichten) {
    gesendet.push(...nachrichten);
    return { responses: nachrichten.map(() => ({ success: true })) };
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  fcm,
});
afterAll(() => sql.end());
let logZeilen: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  gesendet = [];
  logZeilen = vi.spyOn(console, "log").mockImplementation(() => {});
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let fremdLagerId: string;

async function neuesLager(
  status: "aktiv" | "abgeschlossen" = "aktiv",
  titel = "Eingangslager",
  abteilungId?: string,
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: abteilungId ?? welt.testabteilungId,
      titel,
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  if (abteilungId) return id;
  // Die Mitgliedszeile der fremden Abteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
  return id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  fremdLagerId = await neuesLager("aktiv", "Fremdlager", welt.demoAbteilungId);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const L = (id: string) => `/api/v1/lager/${id}`;
const meldung = {
  art: "idee",
  text: "Mehr Zeit am See",
  anonym: false,
} as const;
const sende = (
  persona: LagerPersona,
  lagerId: string,
  felder: Record<string, unknown> = {},
) =>
  anfrage(konten[persona], "POST", `${L(lagerId)}/eingang`, {
    ...meldung,
    ...felder,
  });
const lies = (persona: LagerPersona, lagerId: string, abfrage = "") =>
  anfrage(konten[persona], "GET", `${L(lagerId)}/eingang${abfrage}`);

// Eine Sitzung und ein Push-Token für die Person
async function legeToken(userId: string) {
  const [sitzung] = await db
    .insert(schema.session)
    .values({
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date(),
      userId,
    })
    .returning({ id: schema.session.id });
  const token = `fcm-test-${randomUUID()}`;
  await db.insert(schema.pushToken).values({
    userId,
    sessionId: sitzung!.id,
    token,
    plattform: "android",
  });
  return token;
}

// Wie oft kommt eines der Muster in jeder Tabelle der Datenbank vor (Zeilentext, alle Spalten)? Findet eine Person überall, wo sie auftaucht
async function vorkommen(muster: string[]) {
  const tabellen = await sql<
    { table_name: string }[]
  >`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
  const ergebnis: Record<string, number> = {};
  for (const { table_name } of tabellen) {
    const [z] = await sql.unsafe(
      `select count(*)::int as n from "${table_name}" x where ${muster
        .map((_, i) => `x::text ilike '%' || $${i + 1} || '%'`)
        .join(" or ")}`,
      muster,
    );
    ergebnis[table_name] = z!.n as number;
  }
  return ergebnis;
}

describe("Rückfragecode", () => {
  test("20 Zeichen aus 32, in Vierergruppen, und der Hash passt zu jeder Schreibweise", () => {
    const { code, hash } = neuerRueckfragecode();
    expect(code).toMatch(/^([A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/);
    expect(hashVonCode(code)).toBe(hash);
    expect(hashVonCode(code.toLowerCase().replaceAll("-", " "))).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(neuerRueckfragecode().code).not.toBe(code);
  });
  test("was kein Code sein kann, hat keinen Hash", () => {
    for (const falsch of [
      "",
      "ABCD",
      "0000-0000-0000-0000-0000",
      "x".repeat(64),
    ])
      expect(hashVonCode(falsch)).toBeUndefined();
  });
  test("der Zähler sperrt nach dem Limit und gibt nach dem Fenster frei", () => {
    const zuViele = erstelleZaehler(2, 50);
    expect([zuViele("a"), zuViele("a"), zuViele("a"), zuViele("b")]).toEqual([
      false,
      false,
      true,
      false,
    ]);
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    expect(zuViele("a")).toBe(false);
    vi.useRealTimers();
  });
});

describe("Senden und Lesen mit allen Lager-Personas", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test.each([
    ["abteilungsleitung", 201],
    ["lagerleitung", 201],
    ["leitung", 201],
    ["team", 201],
    ["lesen", 403],
    ["ohneMitgliedschaft", 404],
    ["fremdeAbteilung", 404],
    ["ohneLogin", 401],
  ] as const)("%s sendet: %i", async (persona, erwartet) => {
    expect((await sende(persona, lagerId)).status).toBe(erwartet);
  });

  test("lesen: nur die Lagerleitung und die Abteilungsleitung", async () => {
    for (const [persona, erwartet] of [
      ["abteilungsleitung", 200],
      ["lagerleitung", 200],
      ["leitung", 403],
      ["team", 403],
      ["lesen", 403],
      ["ohneMitgliedschaft", 404],
      ["fremdeAbteilung", 404],
      ["ohneLogin", 401],
    ] as const) {
      expect((await lies(persona, lagerId)).status, persona).toBe(erwartet);
    }
  });

  test("ein fremdes Lager gibt es nicht (404), auch für die Lagerleitung dort", async () => {
    expect((await sende("lagerleitung", fremdLagerId)).status).toBe(404);
    expect((await lies("lagerleitung", fremdLagerId)).status).toBe(404);
  });

  test("nicht anonym: die Lagerleitung sieht Absender und Text, die Person ihre eigenen Meldungen", async () => {
    const id = await neuesLager();
    const a = await sende("team", id, {
      art: "frage",
      text: "Wo schlafen wir?",
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      anonym: false,
      art: "frage",
      status: "neu",
    });
    expect(a.body.rueckfragecode).toBeUndefined();
    const liste = await lies("lagerleitung", id);
    expect(liste.body.eintraege).toHaveLength(1);
    expect(liste.body.eintraege[0]).toMatchObject({
      text: "Wo schlafen wir?",
      anonym: false,
      von: { id: konten.team.id },
    });
    expect(JSON.stringify(liste.body)).not.toContain("rueckfragecode");
    // Die Person liest ihre Meldung, andere nicht
    const eigene = await anfrage(konten.team, "GET", `${L(id)}/eingang/eigene`);
    expect(eigene.body.eintraege.map((e: { id: string }) => e.id)).toEqual([
      a.body.id,
    ]);
    const fremde = await anfrage(
      konten.leitung,
      "GET",
      `${L(id)}/eingang/eigene`,
    );
    expect(fremde.status).toBe(200);
    expect(fremde.body.eintraege).toEqual([]);
  });

  test("Ungültiges und Unbekanntes: 400 (auch ein Feld für Gesundheitsdaten oder eine Person)", async () => {
    for (const falsch of [
      { gesundheit: "Allergie" },
      { personId: konten.team.id },
      { art: "beschwerde" },
      { text: "" },
      { text: "   " },
      { text: "x".repeat(5001) },
      { anonym: "ja" },
    ]) {
      expect((await sende("team", lagerId, falsch)).status).toBe(400);
    }
    const ohneAnonym = await anfrage(
      konten.team,
      "POST",
      `${L(lagerId)}/eingang`,
      { art: "idee", text: "Text" },
    );
    expect(ohneAnonym.status).toBe(400);
  });

  test("Seitenwechsel: eine Abfrage mit Cursor, zwei Seiten ohne Doppelte", async () => {
    const id = await neuesLager();
    for (let i = 0; i < 5; i++)
      await sende("team", id, { text: `Meldung ${i}` });
    const eins = await lies("lagerleitung", id, "?limit=3");
    expect(eins.body.eintraege).toHaveLength(3);
    expect(eins.body.naechster).toBeTruthy();
    const zwei = await lies(
      "lagerleitung",
      id,
      `?limit=3&nach=${eins.body.naechster}`,
    );
    expect(zwei.body.eintraege).toHaveLength(2);
    expect(zwei.body.naechster).toBeNull();
    const ids = [...eins.body.eintraege, ...zwei.body.eintraege].map(
      (e: { id: string }) => e.id,
    );
    expect(new Set(ids).size).toBe(5);
    const nurFrage = await lies("lagerleitung", id, "?art=frage");
    expect(nurFrage.body.eintraege).toEqual([]);
  });
});

describe("Anonym heisst: die Person steht nirgends", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager("aktiv", "Anonymlager");
  });

  test("nach einer anonymen Meldung und allem, was die Lagerleitung damit tut, taucht die Person in keiner Tabelle und in keinem Log auf", async () => {
    const hoeck = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/hoecks`,
      {
        titel: "Höck",
        art: "lagerleitung",
        datum: "2027-07-12",
      },
    );
    const ressort = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/ressorts`,
      { kuerzel: "kue", name: "Küche" },
    );
    const [konto] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, konten.team.id!));
    const muster = [konten.team.id!, konto!.email];
    const [lagerVorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    const vorher = await vorkommen(muster);
    expect(vorher.user).toBeGreaterThan(0);
    logZeilen.mockClear();

    // Senden, mehrfach, mit allen Arten
    let code = "";
    for (const art of ["idee", "wunsch", "frage", "feedback"]) {
      const a = await sende("team", lagerId, {
        art,
        text: `Anonym ${art}`,
        anonym: true,
      });
      expect(a.status).toBe(201);
      expect(a.body.anonym).toBe(true);
      expect(a.body.rueckfragecode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
      // Keine ID in der Antwort: Nur der Code verbindet die Person mit der Meldung
      expect(a.body.id).toBeUndefined();
      code = a.body.rueckfragecode;
    }
    const liste = await lies("lagerleitung", lagerId);
    expect(liste.body.eintraege).toHaveLength(4);
    for (const e of liste.body.eintraege) expect(e.von).toBeNull();
    const id = liste.body.eintraege[0].id;

    // Die Lagerleitung antwortet, setzt Status und Zuordnung, macht ein Traktandum daraus
    const e = (
      await anfrage(konten.lagerleitung, "GET", `${L(lagerId)}/eingang/${id}`)
    ).body;
    const patch = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/eingang/${id}`,
      {
        version: e.version,
        antwort: "Machen wir.",
        status: "in_arbeit",
        ressortId: ressort.body.id,
      },
    );
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ antwort: "Machen wir.", von: null });
    const traktandum = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/eingang/${id}/traktandum`,
      {
        version: patch.body.version,
        titel: "Zeit am See",
        hoeckId: hoeck.body.id,
      },
    );
    expect(traktandum.status).toBe(201);

    // Die meldende Person liest Status und Antwort mit dem Code, nicht über die Liste
    const status = await anfrage(
      konten.team,
      "POST",
      `${L(lagerId)}/eingang/status`,
      {
        code,
      },
    );
    expect(status.status).toBe(200);
    expect(
      (await anfrage(konten.team, "GET", `${L(lagerId)}/eingang/eigene`)).body
        .eintraege,
    ).toEqual([]);

    // Keine Person, keine Spur: gleiche Zahl der Zeilen mit ihrer ID oder E-Mail-Adresse wie vorher, in jeder Tabelle
    expect(await vorkommen(muster)).toEqual(vorher);
    // Kein Eintrag im Änderungsfeed, keine Folgenummer, kein Verlauf
    const [lagerNachher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    const eingangFeed = await db
      .select({ n: count() })
      .from(schema.lagerAenderung)
      .where(
        and(
          eq(schema.lagerAenderung.lagerId, lagerId),
          eq(schema.lagerAenderung.tabelle, "eingang"),
        ),
      );
    expect(eingangFeed[0]!.n).toBe(0);
    // Die Folgenummer stieg nur durch Ressort, Höck und Traktandum der Lagerleitung
    expect(lagerNachher!.seq - lagerVorher!.seq).toBeLessThanOrEqual(1);
    // Kein Log nennt die Person
    const logs = JSON.stringify(logZeilen.mock.calls);
    expect(logs).not.toContain(konten.team.id!);
    expect(logs).not.toContain(konto!.email);
    expect(logs).not.toContain("Anonym");
  });

  test("die Zeile hat keine Person, nur den Tag und eine zufällige ID; die Datenbank lässt keine anonyme Meldung mit Person zu", async () => {
    const a = await sende("lagerleitung", lagerId, { anonym: true });
    const hash = hashVonCode(a.body.rueckfragecode)!;
    const [zeile] = await db
      .select()
      .from(schema.eingang)
      .where(eq(schema.eingang.rueckfragecodeHash, hash));
    expect(zeile).toMatchObject({ anonym: true, personId: null });
    // UUID Version 4 (zufällig), nicht Version 7 (ordnet nach Zeit)
    expect(zeile!.id[14]).toBe("4");
    expect(zeile!.erstelltTag).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Der Code selbst steht nirgends in der Zeile
    expect(JSON.stringify(zeile)).not.toContain(a.body.rueckfragecode);
    await expect(
      db.insert(schema.eingang).values({
        lagerId,
        art: "idee",
        text: "x",
        anonym: true,
        personId: konten.team.id!,
        rueckfragecodeHash: "abc",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.eingang).values({
        lagerId,
        art: "idee",
        text: "x",
        anonym: false,
        personId: null,
      }),
    ).rejects.toThrow();
  });

  test("zur Kontrolle: bei einer nicht anonymen Meldung findet die Suche die Person", async () => {
    const [konto] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, konten.team.id!));
    const vorher = await vorkommen([konten.team.id!, konto!.email]);
    await sende("team", lagerId);
    const nachher = await vorkommen([konten.team.id!, konto!.email]);
    expect(nachher.eingang! - vorher.eingang!).toBe(1);
  });

  test("Antwort an die anonyme Person: kein Push, keine Benachrichtigung; mit dem Code liest sie die Antwort, ein falscher Code gibt 404", async () => {
    const t = await legeToken(konten.team.id!);
    const a = await sende("team", lagerId, { anonym: true, art: "frage" });
    const code = a.body.rueckfragecode;
    const [zeile] = await db
      .select()
      .from(schema.eingang)
      .where(eq(schema.eingang.rueckfragecodeHash, hashVonCode(code)!));
    const p = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/eingang/${zeile!.id}`,
      { version: 1, antwort: "Ja, um 8 Uhr.", status: "erledigt" },
    );
    expect(p.status).toBe(200);
    expect(gesendet).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.lagerBenachrichtigung)
        .where(eq(schema.lagerBenachrichtigung.objektId, zeile!.id)),
    ).toEqual([]);
    const s = await anfrage(
      konten.team,
      "POST",
      `${L(lagerId)}/eingang/status`,
      {
        code: code.toLowerCase(),
      },
    );
    expect(s.body).toEqual({
      art: "frage",
      status: "erledigt",
      antwort: "Ja, um 8 Uhr.",
      beantwortetTag: p.body.beantwortetTag,
      erstelltTag: zeile!.erstelltTag,
    });
    // Der Code gilt nur in seinem Lager und nur für Mitglieder mit eingang.senden
    for (const [persona, lager, erwartet] of [
      ["team", "falsch", 404],
      ["lesen", lagerId, 403],
      ["ohneMitgliedschaft", lagerId, 404],
    ] as const) {
      const r = await anfrage(
        konten[persona],
        "POST",
        `${L(lager === "falsch" ? await neuesLager() : lager)}/eingang/status`,
        { code },
      );
      expect(r.status, persona).toBe(erwartet);
    }
    const falsch = await anfrage(
      konten.team,
      "POST",
      `${L(lagerId)}/eingang/status`,
      { code: neuerRueckfragecode().code },
    );
    expect(falsch.status).toBe(404);
    const unsinn = await anfrage(
      konten.team,
      "POST",
      `${L(lagerId)}/eingang/status`,
      { code: "kein code" },
    );
    expect(unsinn.status).toBe(404);
    expect(t).toBeTruthy();
  });

  test("Rate-Limit je Lager und Stunde, ohne Person: die 61. anonyme Meldung im Lager gibt 429, ein anderes Lager ist frei", async () => {
    const id = await neuesLager();
    for (let i = 0; i < 60; i++) {
      // Wechselnde Konten: Das Limit zählt das Lager, nicht die Person
      const persona = (["team", "leitung", "lagerleitung"] as const)[i % 3]!;
      expect(
        (await sende(persona, id, { anonym: true, text: `m${i}` })).status,
      ).toBe(201);
    }
    expect((await sende("team", id, { anonym: true })).status).toBe(429);
    expect((await sende("leitung", id, { anonym: true })).status).toBe(429);
    const anderes = await neuesLager();
    expect((await sende("team", anderes, { anonym: true })).status).toBe(201);
  });

  test("Rate-Limit für Rückfrage-Codes je Lager", async () => {
    const id = await neuesLager();
    let letzte = 0;
    for (let i = 0; i < 121; i++) {
      letzte = (
        await anfrage(konten.team, "POST", `${L(id)}/eingang/status`, {
          code: neuerRueckfragecode().code,
        })
      ).status;
    }
    expect(letzte).toBe(429);
  }, 60_000);
});

describe("Benannte Rückfragen: Antwort per Push", () => {
  let lagerId: string;
  let teamToken: string;
  beforeAll(async () => {
    lagerId = await neuesLager("aktiv", "Seelager");
    // Frisch: Ein Token aus einem früheren Test würde mitzählen
    await db
      .delete(schema.pushToken)
      .where(eq(schema.pushToken.userId, konten.team.id!));
    teamToken = await legeToken(konten.team.id!);
  });

  test("die Antwort geht an die Person, ohne Text, mit Titel der Art und Lagertitel; eine Zeile in der Glocke", async () => {
    const a = await sende("team", lagerId, {
      art: "frage",
      text: "Geheime Frage",
    });
    const p = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/eingang/${a.body.id}`,
      { version: 1, antwort: "Geheime Antwort" },
    );
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({
      antwort: "Geheime Antwort",
      version: 2,
      von: { id: konten.team.id },
    });
    expect(gesendet.map((g) => g.token)).toEqual([teamToken]);
    expect(gesendet[0]!.notification).toEqual({
      title: "Antwort auf deine Nachricht",
      body: "Seelager",
    });
    expect(gesendet[0]!.data).toEqual({ typ: "lager_eingang", id: a.body.id });
    const roh = JSON.stringify(gesendet);
    expect(roh).not.toContain("Geheime");
    const zeilen = await db
      .select()
      .from(schema.lagerBenachrichtigung)
      .where(eq(schema.lagerBenachrichtigung.objektId, a.body.id));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      personId: konten.team.id,
      art: "eingang_antwort",
      objektTyp: "eingang",
    });
    // Die App öffnet das Ziel; die Person liest die Antwort unter «eigene»
    const auf = await anfrage(
      konten.team,
      "GET",
      `/api/v1/lager/aufloesen/lager_eingang/${a.body.id}`,
    );
    expect(auf.status).toBe(200);
    const eigene = await anfrage(
      konten.team,
      "GET",
      `${L(lagerId)}/eingang/eigene`,
    );
    expect(eigene.body.eintraege[0]).toMatchObject({
      id: a.body.id,
      antwort: "Geheime Antwort",
    });
    // Eine zweite Änderung ohne neue Antwort (nur Status) löst nichts aus
    gesendet = [];
    const s = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/eingang/${a.body.id}`,
      { version: 2, status: "erledigt" },
    );
    expect(s.status).toBe(200);
    expect(gesendet).toEqual([]);
  });

  test("wer die Art abgeschaltet hat, bekommt weder Push noch Zeile", async () => {
    await db.insert(schema.lagerBenachrichtigungEinstellung).values({
      personId: konten.team.id!,
      art: "eingang_antwort",
      aktiv: false,
    });
    const a = await sende("team", lagerId, { art: "frage" });
    await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/eingang/${a.body.id}`,
      { version: 1, antwort: "Antwort" },
    );
    expect(gesendet).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.lagerBenachrichtigung)
        .where(eq(schema.lagerBenachrichtigung.objektId, a.body.id)),
    ).toEqual([]);
    await db
      .delete(schema.lagerBenachrichtigungEinstellung)
      .where(
        eq(schema.lagerBenachrichtigungEinstellung.personId, konten.team.id!),
      );
  });

  test("antwortet die Absenderin selbst, bekommt sie keinen Push", async () => {
    const a = await sende("lagerleitung", lagerId, { art: "frage" });
    await legeToken(konten.lagerleitung.id!);
    gesendet = [];
    await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/eingang/${a.body.id}`,
      {
        version: 1,
        antwort: "Selbst",
      },
    );
    expect(gesendet).toEqual([]);
  });
});

describe("Bearbeiten, Zuordnen, Löschen", () => {
  let lagerId: string;
  let ressortId: string;
  beforeAll(async () => {
    lagerId = await neuesLager("aktiv", "Bearbeitungslager");
    ressortId = (
      await anfrage(konten.lagerleitung, "POST", `${L(lagerId)}/ressorts`, {
        kuerzel: "kue",
        name: "Küche",
      })
    ).body.id;
  });
  // Eine frische anonyme Meldung, gefunden über ihren Text (die Reihenfolge am selben Tag ist zufällig)
  const neu = async () => {
    const text = `neu-${randomUUID()}`;
    expect((await sende("team", lagerId, { anonym: true, text })).status).toBe(
      201,
    );
    const liste = await lies("lagerleitung", lagerId, "?limit=100");
    return liste.body.eintraege.find((e: { text: string }) => e.text === text);
  };
  const patch = (
    id: string,
    body: Record<string, unknown>,
    persona: LagerPersona = "lagerleitung",
  ) => anfrage(konten[persona], "PATCH", `${L(lagerId)}/eingang/${id}`, body);

  test("Status, Antwort zurücknehmen, Ressort und Traktandum zuordnen und lösen", async () => {
    const e = await neu();
    const a = await patch(e.id, {
      version: 1,
      ressortId,
      status: "in_arbeit",
      antwort: "Bald",
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      ressortId,
      status: "in_arbeit",
      version: 2,
    });
    expect(a.body.beantwortetTag).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const b = await patch(e.id, { version: 2, antwort: null, ressortId: null });
    expect(b.body).toMatchObject({
      antwort: null,
      beantwortetTag: null,
      ressortId: null,
    });
  });

  test("Ressort oder Traktandum aus einem anderen Lager, unbekannt oder gelöscht: 400", async () => {
    const e = await neu();
    const fremdesLager = await neuesLager();
    const fremdesRessort = (
      await anfrage(
        konten.lagerleitung,
        "POST",
        `${L(fremdesLager)}/ressorts`,
        {
          kuerzel: "xy",
          name: "Fremd",
        },
      )
    ).body.id;
    expect(
      (await patch(e.id, { version: 1, ressortId: fremdesRessort })).status,
    ).toBe(400);
    expect(
      (await patch(e.id, { version: 1, ressortId: randomUUID() })).status,
    ).toBe(400);
    const fremdesTraktandum = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(fremdesLager)}/traktanden`,
      { titel: "Fremd" },
    );
    const t = await patch(e.id, {
      version: 1,
      traktandumId: fremdesTraktandum.body.id ?? randomUUID(),
    });
    expect(t.status).toBe(400);
    expect(t.body.code).toBe("TRAKTANDUM_UNBEKANNT");
  });

  test("Versionskonflikt: 409 mit dem Stand, ohne Person und ohne Code-Hash", async () => {
    const e = await neu();
    expect(
      (await patch(e.id, { version: 1, status: "in_arbeit" })).status,
    ).toBe(200);
    const k = await patch(e.id, { version: 1, status: "erledigt" });
    expect(k.status).toBe(409);
    expect(k.body).toMatchObject({
      code: "VERSION_KONFLIKT",
      aktuell: { id: e.id, version: 2, status: "in_arbeit" },
      abweichend: ["status"],
    });
    const roh = JSON.stringify(k.body);
    expect(roh).not.toContain("personId");
    expect(roh).not.toContain("rueckfragecode");
  });

  test("Traktandum aus einer Meldung: Titel der Lagerleitung, nie der Text; verknüpft; ohne Recht für Höcks 403", async () => {
    const e = await neu();
    const hoeck = (
      await anfrage(konten.lagerleitung, "POST", `${L(lagerId)}/hoecks`, {
        titel: "Höck 1",
        art: "lagerleitung",
        datum: "2027-07-12",
      })
    ).body;
    const t = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/eingang/${e.id}/traktandum`,
      { version: e.version, titel: "Zeit am See", hoeckId: hoeck.id },
    );
    expect(t.status).toBe(201);
    expect(t.body.traktandumId).toBeTruthy();
    const [z] = await db
      .select()
      .from(schema.traktandum)
      .where(eq(schema.traktandum.id, t.body.traktandumId));
    expect(z).toMatchObject({
      titel: "Zeit am See",
      hoeckId: hoeck.id,
      text: null,
    });
    expect(JSON.stringify(z)).not.toContain(e.text);
    // Unbekannter Höck: 400, und nichts bleibt zurück
    const e2 = await neu();
    const vorher = await db
      .select({ n: count() })
      .from(schema.traktandum)
      .where(eq(schema.traktandum.lagerId, lagerId));
    const falsch = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/eingang/${e2.id}/traktandum`,
      { version: e2.version, titel: "X", hoeckId: randomUUID() },
    );
    expect(falsch.status).toBe(400);
    // Veraltete Version: 409, das Traktandum wird zurückgerollt
    const alt = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/eingang/${e2.id}/traktandum`,
      { version: 99, titel: "Y" },
    );
    expect(alt.status).toBe(409);
    const nachher = await db
      .select({ n: count() })
      .from(schema.traktandum)
      .where(eq(schema.traktandum.lagerId, lagerId));
    expect(nachher[0]!.n).toBe(vorher[0]!.n);
    // Wer Höcks nicht bearbeiten darf, aber antworten und lesen
    await db.insert(schema.lagerRolleRecht).values([
      { lagerId, rolle: "leitung", recht: "eingang.lesen", erlaubt: true },
      { lagerId, rolle: "leitung", recht: "eingang.antworten", erlaubt: true },
      { lagerId, rolle: "leitung", recht: "hoecks.bearbeiten", erlaubt: false },
    ]);
    const kein = await anfrage(
      konten.leitung,
      "POST",
      `${L(lagerId)}/eingang/${e2.id}/traktandum`,
      { version: e2.version, titel: "Z" },
    );
    expect(kein.status).toBe(403);
    await db
      .delete(schema.lagerRolleRecht)
      .where(eq(schema.lagerRolleRecht.lagerId, lagerId));
  });

  test("Rechte je Lager: Lesen und Antworten sind getrennt; ohne Lesen kein Antworten; ohne «senden» kein Senden", async () => {
    const id = await neuesLager();
    await sende("team", id, { anonym: true });
    const e = (await lies("lagerleitung", id)).body.eintraege[0];
    expect((await lies("leitung", id)).status).toBe(403);
    await db.insert(schema.lagerRolleRecht).values([
      {
        lagerId: id,
        rolle: "leitung",
        recht: "eingang.antworten",
        erlaubt: true,
      },
    ]);
    // Antworten ohne Lesen: 403
    expect(
      (
        await anfrage(konten.leitung, "PATCH", `${L(id)}/eingang/${e.id}`, {
          version: 1,
          status: "erledigt",
        })
      ).status,
    ).toBe(403);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "leitung",
      recht: "eingang.lesen",
      erlaubt: true,
    });
    const liste = await lies("leitung", id);
    expect(liste.status).toBe(200);
    expect(liste.body.eintraege[0].von).toBeNull();
    expect(
      (
        await anfrage(konten.leitung, "PATCH", `${L(id)}/eingang/${e.id}`, {
          version: 1,
          status: "erledigt",
        })
      ).status,
    ).toBe(200);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "team",
      recht: "eingang.senden",
      erlaubt: false,
    });
    expect((await sende("team", id)).status).toBe(403);
  });

  test("Löschen: endgültig, mit Version; danach 404", async () => {
    const e = await neu();
    const alt = await anfrage(
      konten.lagerleitung,
      "DELETE",
      `${L(lagerId)}/eingang/${e.id}?version=7`,
    );
    expect(alt.status).toBe(409);
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "DELETE",
          `${L(lagerId)}/eingang/${e.id}?version=1`,
        )
      ).status,
    ).toBe(204);
    expect(
      await db.select().from(schema.eingang).where(eq(schema.eingang.id, e.id)),
    ).toEqual([]);
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "GET",
          `${L(lagerId)}/eingang/${e.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "DELETE",
          `${L(lagerId)}/eingang/${e.id}?version=1`,
        )
      ).status,
    ).toBe(404);
  });

  test("ein anderes Lager: Meldungen sind dort unbekannt (404)", async () => {
    const e = await neu();
    const anderes = await neuesLager();
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "GET",
          `${L(anderes)}/eingang/${e.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "PATCH",
          `${L(anderes)}/eingang/${e.id}`,
          {
            version: 1,
            status: "erledigt",
          },
        )
      ).status,
    ).toBe(404);
  });
});

describe("Abgeschlossenes Lager, Feed und Last", () => {
  test("Senden und Antworten sind gesperrt (409), den Code lesen geht weiter", async () => {
    const id = await neuesLager();
    const a = await sende("team", id, { anonym: true });
    await db
      .update(schema.lager)
      .set({ status: "abgeschlossen" })
      .where(eq(schema.lager.id, id));
    expect((await sende("team", id)).status).toBe(409);
    const [z] = await db
      .select()
      .from(schema.eingang)
      .where(eq(schema.eingang.lagerId, id));
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "PATCH",
          `${L(id)}/eingang/${z!.id}`,
          {
            version: 1,
            status: "erledigt",
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await anfrage(konten.team, "POST", `${L(id)}/eingang/status`, {
          code: a.body.rueckfragecode,
        })
      ).status,
    ).toBe(200);
    expect((await lies("lagerleitung", id)).status).toBe(200);
  });

  test("der Änderungsfeed kennt den Eingang nicht", async () => {
    const id = await neuesLager();
    const vorher = await anfrage(
      konten.lagerleitung,
      "GET",
      `${L(id)}/aenderungen`,
    );
    await sende("team", id);
    await sende("team", id, { anonym: true });
    const nachher = await anfrage(
      konten.lagerleitung,
      "GET",
      `${L(id)}/aenderungen?seit=${vorher.body.seq}`,
    );
    expect(nachher.status).toBe(200);
    expect(nachher.body.eintraege).toEqual([]);
    expect(vorher.body.objekttypen).not.toContain("eingang");
  });

  test("die Zahl der Abfragen hängt nicht von der Zahl der Meldungen ab", async () => {
    const id = await neuesLager();
    const zaehle = async () => {
      await lies("lagerleitung", id);
      const vorher = abfragen;
      const a = await lies("lagerleitung", id);
      expect(a.status).toBe(200);
      return { n: abfragen - vorher, meldungen: a.body.eintraege.length };
    };
    await sende("team", id, { anonym: true });
    const klein = await zaehle();
    for (let i = 0; i < 11; i++) await sende("team", id, { anonym: true });
    const gross = await zaehle();
    expect(klein.meldungen).toBe(1);
    expect(gross.meldungen).toBe(12);
    expect(gross.n).toBe(klein.n);
  });
});
