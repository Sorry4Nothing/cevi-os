import { Expo } from "expo-server-sdk";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  expo: new Expo({ accessToken: "test-zugang" }),
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Eine Welt pro Test: Die Tests lesen ganze Verläufe
let welt: Welt;
beforeEach(async () => {
  welt = await erstelleWelt(db, auth);
});

const UNBEKANNT = "0199a5c0-0000-7000-8000-000000000000";

const aufruf = (
  konto: PersonaKonto,
  methode: "GET" | "PUT" | "DELETE" | "POST",
  pfad: string,
  body?: unknown,
) =>
  app.request(pfad, {
    method: methode,
    headers:
      body === undefined
        ? konto.headers
        : { ...konto.headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const blockieren = (konto: PersonaKonto, ziel: string) =>
  aufruf(konto, "PUT", `/api/v1/blockierungen/${ziel}`);
const entblocken = (konto: PersonaKonto, ziel: string) =>
  aufruf(konto, "DELETE", `/api/v1/blockierungen/${ziel}`);
const liste = async (konto: PersonaKonto) =>
  (await (await aufruf(konto, "GET", "/api/v1/blockierungen")).json()) as {
    blockiert: { id: string; name: string }[];
  };

const person = (persona: Persona) => legePersonaAn(welt, persona);

const lies = async (konto: PersonaKonto, chatId: string) =>
  (
    (await (
      await aufruf(konto, "GET", `/api/v1/chats/${chatId}/nachrichten`)
    ).json()) as { nachrichten: { id: string; text: string | null }[] }
  ).nachrichten;
const idsVon = async (konto: PersonaKonto, chatId: string) =>
  (await lies(konto, chatId)).map((n) => n.id);

async function schreibe(
  autor: PersonaKonto,
  chatId: string,
  text = "Ein Text",
) {
  const [zeile] = await db
    .insert(schema.nachricht)
    .values({ chatId, autorId: autor.id as string, text })
    .returning({ id: schema.nachricht.id });
  return zeile.id;
}

const zeilen = (konto: PersonaKonto) =>
  db
    .select()
    .from(schema.blockierung)
    .where(eq(schema.blockierung.userId, konto.id as string));

describe("PUT /api/v1/blockierungen/:userId", () => {
  test("Eltern blockieren andere Eltern: deren Nachrichten fehlen nur für sie", async () => {
    const [ich, stoerer, dritte] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("elternA"),
    ]);
    const vorher = await schreibe(stoerer, welt.gruppenchatAId, "Vorher");
    const andere = await schreibe(dritte, welt.gruppenchatAId, "Normal");
    expect(await idsVon(ich, welt.gruppenchatAId)).toEqual([andere, vorher]);

    expect((await blockieren(ich, stoerer.id as string)).status).toBe(204);
    const nachher = await schreibe(stoerer, welt.gruppenchatAId, "Nachher");

    // Alte und neue Nachrichten verschwinden, die der anderen bleiben
    expect(await idsVon(ich, welt.gruppenchatAId)).toEqual([andere]);
    // Für alle anderen und die blockierte Person ändert sich nichts
    expect(await idsVon(dritte, welt.gruppenchatAId)).toEqual([
      nachher,
      andere,
      vorher,
    ]);
    expect(await idsVon(stoerer, welt.gruppenchatAId)).toEqual([
      nachher,
      andere,
      vorher,
    ]);
    // Die blockierte Person hat keine Spur der Blockierung
    expect(await zeilen(stoerer)).toEqual([]);
    expect((await liste(stoerer)).blockiert).toEqual([]);
  });

  test("ist idempotent und lässt sich mit DELETE aufheben, auch ein zweites Mal", async () => {
    const [ich, stoerer] = await Promise.all([
      person("elternA"),
      person("elternA"),
    ]);
    const id = await schreibe(stoerer, welt.gruppenchatAId);
    expect((await blockieren(ich, stoerer.id as string)).status).toBe(204);
    expect((await blockieren(ich, stoerer.id as string)).status).toBe(204);
    expect(await zeilen(ich)).toHaveLength(1);
    expect(await lies(ich, welt.gruppenchatAId)).toEqual([]);

    expect((await entblocken(ich, stoerer.id as string)).status).toBe(204);
    expect((await entblocken(ich, stoerer.id as string)).status).toBe(204);
    expect(await zeilen(ich)).toEqual([]);
    expect(await idsVon(ich, welt.gruppenchatAId)).toEqual([id]);
  });

  test("SL lassen sich nicht blockieren und bleiben sichtbar", async () => {
    const [ich, sl, slB] = await Promise.all([
      person("elternA"),
      person("slA"),
      person("slB"),
    ]);
    const id = await schreibe(sl, welt.gruppenchatAId);
    expect((await blockieren(ich, sl.id as string)).status).toBe(403);
    // Die SL der Stufe B teilt keinen Gruppenchat mit dieser Person
    expect((await blockieren(ich, slB.id as string)).status).toBe(404);
    expect(await zeilen(ich)).toEqual([]);
    expect(await idsVon(ich, welt.gruppenchatAId)).toEqual([id]);
  });

  test("SL blockieren nicht", async () => {
    const [sl, eltern] = await Promise.all([person("slA"), person("elternA")]);
    expect((await blockieren(sl, eltern.id as string)).status).toBe(403);
    expect(await zeilen(sl)).toEqual([]);
  });

  test("wird ein blockiertes Elternteil später SL der Stufe, bleibt es sichtbar", async () => {
    const [ich, spaeter] = await Promise.all([
      person("elternA"),
      person("elternA"),
    ]);
    expect((await blockieren(ich, spaeter.id as string)).status).toBe(204);
    const id = await schreibe(spaeter, welt.gruppenchatAId);
    expect(await lies(ich, welt.gruppenchatAId)).toEqual([]);

    // Der Kontakt zur Stufenleitung geht vor
    await db.insert(schema.rolle).values({
      userId: spaeter.id as string,
      stufeId: welt.stufeAId,
      typ: "stufenleitung",
    });
    expect(await idsVon(ich, welt.gruppenchatAId)).toEqual([id]);
  });

  test("der Einzelchat bleibt unberührt", async () => {
    const [ich, sl, stoerer] = await Promise.all([
      person("elternA"),
      person("slA"),
      person("elternA"),
    ]);
    const antwort = await aufruf(ich, "POST", "/api/v1/chats/direkt", {
      stufeId: welt.stufeAId,
    });
    const { id: chatId } = (await antwort.json()) as { id: string };
    const eigene = await schreibe(ich, chatId);
    const vonSl = await schreibe(sl, chatId);
    await blockieren(ich, stoerer.id as string);
    expect(await idsVon(ich, chatId)).toEqual([vonSl, eigene]);
  });

  test("Sich selbst, Fremde, Unbekannte und andere Abteilungen: 400 oder 404, nichts wird gespeichert", async () => {
    const [ich, elternB, demo, leitende] = await Promise.all([
      person("elternA"),
      person("elternB"),
      person("demoEltern"),
      person("leitendeA"),
    ]);
    expect((await blockieren(ich, ich.id as string)).status).toBe(400);
    // Andere Stufe, andere Abteilung, Leitende ohne Elternrolle, unbekannte ID: nie ein gemeinsamer Gruppenchat
    for (const ziel of [
      elternB.id as string,
      demo.id as string,
      leitende.id as string,
      UNBEKANNT,
    ]) {
      expect((await blockieren(ich, ziel)).status).toBe(404);
    }
    expect((await blockieren(ich, "kein-uuid")).status).toBe(400);
    expect(await zeilen(ich)).toEqual([]);
  });

  test("Admins und Leitende ohne Elternrolle sind in keinem Gruppenchat: 404", async () => {
    const [admin, leitende, eltern] = await Promise.all([
      person("admin"),
      person("leitendeA"),
      person("elternA"),
    ]);
    expect((await blockieren(admin, eltern.id as string)).status).toBe(404);
    expect((await blockieren(leitende, eltern.id as string)).status).toBe(404);
  });

  test("ein deaktiviertes Elternteil ist kein Mitglied mehr: 404", async () => {
    const [ich, weg] = await Promise.all([
      person("elternA"),
      person("elternA"),
    ]);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date(), banned: true })
      .where(eq(schema.user.id, weg.id as string));
    expect((await blockieren(ich, weg.id as string)).status).toBe(404);
  });
});

describe("DELETE /api/v1/blockierungen/:userId", () => {
  test("hebt nur die eigene Blockierung auf", async () => {
    const [a, b, stoerer] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("elternA"),
    ]);
    await blockieren(a, stoerer.id as string);
    await blockieren(b, stoerer.id as string);
    await entblocken(a, stoerer.id as string);
    expect(await zeilen(a)).toEqual([]);
    expect(await zeilen(b)).toHaveLength(1);
  });

  test("unbekannte IDs und andere Abteilungen sind 404, eine ungültige ID 400", async () => {
    const [ich, demo] = await Promise.all([
      person("elternA"),
      person("demoEltern"),
    ]);
    expect((await entblocken(ich, demo.id as string)).status).toBe(404);
    expect((await entblocken(ich, UNBEKANNT)).status).toBe(404);
    expect((await entblocken(ich, "x")).status).toBe(400);
  });

  test("geht auch, wenn die blockierte Person den Chat verlassen hat", async () => {
    const [ich, weg] = await Promise.all([
      person("elternA"),
      person("elternA"),
    ]);
    await blockieren(ich, weg.id as string);
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date(), banned: true })
      .where(eq(schema.user.id, weg.id as string));
    expect((await entblocken(ich, weg.id as string)).status).toBe(204);
    expect(await zeilen(ich)).toEqual([]);
  });
});

describe("GET /api/v1/blockierungen", () => {
  test("liefert Kennung und Name der eigenen Blockierungen, nie die anderer", async () => {
    const [ich, stoerer, fremde] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("elternA"),
    ]);
    expect((await liste(ich)).blockiert).toEqual([]);
    await blockieren(ich, stoerer.id as string);
    await blockieren(fremde, ich.id as string);
    expect(await liste(ich)).toEqual({
      blockiert: [{ id: stoerer.id, name: expect.any(String) }],
    });
  });
});

test("beim Löschen eines Kontos verschwinden die Blockierungen mit", async () => {
  const [ich, stoerer] = await Promise.all([
    person("elternA"),
    person("elternA"),
  ]);
  await blockieren(ich, stoerer.id as string);
  await db.delete(schema.user).where(eq(schema.user.id, stoerer.id as string));
  expect(
    await db
      .select()
      .from(schema.blockierung)
      .where(
        and(
          eq(schema.blockierung.userId, ich.id as string),
          eq(schema.blockierung.blockiertId, stoerer.id as string),
        ),
      ),
  ).toEqual([]);
});
