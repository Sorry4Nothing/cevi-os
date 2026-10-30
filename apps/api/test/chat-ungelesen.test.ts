import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { randomUUID } from "node:crypto";
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

const expoAttrappe = bereiteAuthTestsVor();

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

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Eine Welt pro Test: Die Tests zählen Nachrichten und Pushes, die Chats dürfen sich nicht teilen
let welt: Welt;
beforeEach(async () => {
  welt = await erstelleWelt(db, auth);
  expoAttrappe.zuruecksetzen();
});

const person = (persona: Persona) => legePersonaAn(welt, persona);

const aufruf = (
  konto: PersonaKonto,
  methode: "GET" | "POST" | "PUT",
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

const sende = (konto: PersonaKonto, chatId: string, text: string) =>
  aufruf(konto, "POST", `/api/v1/chats/${chatId}/nachrichten`, { text });
const gelesen = (konto: PersonaKonto, chatId: string) =>
  aufruf(konto, "PUT", `/api/v1/chats/${chatId}/gelesen`);

async function ungelesen(konto: PersonaKonto, chatId: string) {
  const antwort = await aufruf(konto, "GET", "/api/v1/chats");
  expect(antwort.status).toBe(200);
  const { chats } = (await antwort.json()) as {
    chats: { id: string; ungelesen: number }[];
  };
  return chats.find((k) => k.id === chatId)?.ungelesen;
}

// Ein Token pro Konto, angemeldet über die Route wie in der App
async function melde(konto: PersonaKonto) {
  const token = `ExponentPushToken[test-${randomUUID()}]`;
  const antwort = await aufruf(konto, "PUT", "/api/v1/push-token", {
    token,
    plattform: "android",
  });
  expect(antwort.status).toBe(204);
  return token;
}

describe("Ungelesen-Zähler", () => {
  test("zählt fremde Nachrichten nach gelesen_bis, nie die eigenen", async () => {
    const [eltern, zweite, sl] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("slA"),
    ]);
    const chat = welt.gruppenchatAId;
    expect(await ungelesen(sl, chat)).toBe(0);

    expect((await sende(eltern, chat, "Eins")).status).toBe(201);
    expect((await sende(eltern, chat, "Zwei")).status).toBe(201);
    expect(await ungelesen(sl, chat)).toBe(2);
    expect(await ungelesen(zweite, chat)).toBe(2);
    // Die eigenen Nachrichten zählen nie
    expect(await ungelesen(eltern, chat)).toBe(0);

    expect((await gelesen(sl, chat)).status).toBe(204);
    expect(await ungelesen(sl, chat)).toBe(0);
    // Der Stand gehört der Person: Die zweite Familie hat noch nichts gelesen
    expect(await ungelesen(zweite, chat)).toBe(2);

    expect((await sende(zweite, chat, "Drei")).status).toBe(201);
    expect(await ungelesen(sl, chat)).toBe(1);
    expect(await ungelesen(eltern, chat)).toBe(1);
  });

  test("Nachrichten vor dem Beitritt der Eltern zählen nicht", async () => {
    const sl = await person("slA");
    await sende(sl, welt.gruppenchatAId, "Von früher");
    const spaeter = await person("elternA");
    expect(await ungelesen(spaeter, welt.gruppenchatAId)).toBe(0);
  });

  test("ausgeblendete Nachrichten zählen für andere nicht mehr", async () => {
    const [eltern, zweite, sl] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("slA"),
    ]);
    const antwort = await sende(eltern, welt.gruppenchatAId, "Unpassend");
    const { id } = (await antwort.json()) as { id: string };
    expect(await ungelesen(zweite, welt.gruppenchatAId)).toBe(1);
    const aus = await aufruf(
      sl,
      "POST",
      `/api/v1/nachrichten/${id}/ausblenden`,
    );
    expect(aus.status).toBe(204);
    expect(await ungelesen(zweite, welt.gruppenchatAId)).toBe(0);
    expect(await ungelesen(eltern, welt.gruppenchatAId)).toBe(0);
  });

  test("Einzelchat: Alle SL der Stufe sehen die Nachricht des Elternteils als ungelesen", async () => {
    const [eltern, sl, zweiteSl] = await Promise.all([
      person("elternA"),
      person("slA"),
      person("slA"),
    ]);
    const antwort = await aufruf(eltern, "POST", "/api/v1/chats/direkt", {
      stufeId: welt.stufeAId,
    });
    const { id } = (await antwort.json()) as { id: string };
    await sende(eltern, id, "Frage");
    expect(await ungelesen(sl, id)).toBe(1);
    expect(await ungelesen(zweiteSl, id)).toBe(1);
    await gelesen(sl, id);
    expect(await ungelesen(sl, id)).toBe(0);
    expect(await ungelesen(zweiteSl, id)).toBe(1);
  });
});

describe("PUT /api/v1/chats/:id/gelesen", () => {
  const stand = async (konto: PersonaKonto) => {
    const [zeile] = await db
      .select({ gelesenBis: schema.chatStatus.gelesenBis })
      .from(schema.chatStatus)
      .where(
        and(
          eq(schema.chatStatus.chatId, welt.gruppenchatAId),
          eq(schema.chatStatus.userId, konto.id!),
        ),
      );
    return zeile?.gelesenBis;
  };

  test("legt die Zeile beim ersten Lesen an und schiebt sie nur vor", async () => {
    const sl = await person("slA");
    expect(await stand(sl)).toBeUndefined();
    expect((await gelesen(sl, welt.gruppenchatAId)).status).toBe(204);
    const erster = await stand(sl);
    expect(erster).toBeInstanceOf(Date);
    expect((await gelesen(sl, welt.gruppenchatAId)).status).toBe(204);
    expect((await stand(sl))!.getTime()).toBeGreaterThanOrEqual(
      erster!.getTime(),
    );
  });

  test("ein Nichtmitglied bekommt 404 und schreibt nichts", async () => {
    const [fremde, slB, admin, sl] = await Promise.all([
      person("elternB"),
      person("slB"),
      person("admin"),
      person("slA"),
    ]);
    for (const konto of [fremde, slB, admin]) {
      expect((await gelesen(konto, welt.gruppenchatAId)).status).toBe(404);
      expect(await stand(konto)).toBeUndefined();
    }
    expect((await gelesen(sl, randomUUID())).status).toBe(404);
  });

  test("eine ID, die keine UUID ist, ergibt 400", async () => {
    const sl = await person("slA");
    expect((await gelesen(sl, "kein-uuid")).status).toBe(400);
  });
});

describe("Chat-Push bei neuer Nachricht", () => {
  const texte = (nachrichten: ExpoPushMessage[]) =>
    nachrichten.map((n) => n.to).sort();

  test("geht an Mitglieder mit Chat-Push, ohne Nachrichtentext, nie an den Absender", async () => {
    const [eltern, zweite, sl, fremde, slB] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("slA"),
      person("elternB"),
      person("slB"),
    ]);
    const [tEltern, tZweite, tSl] = await Promise.all(
      [eltern, zweite, sl].map(melde),
    );
    await Promise.all([fremde, slB].map(melde));

    const antwort = await sende(eltern, welt.gruppenchatAId, "Geheimer Text");
    expect(antwort.status).toBe(201);

    expect(texte(expoAttrappe.nachrichten)).toEqual([tZweite, tSl].sort());
    expect(expoAttrappe.nachrichten).toStrictEqual(
      expect.arrayContaining([
        {
          to: tSl,
          title: "Neue Nachricht im Chat Stufe A",
          data: { typ: "chat", id: welt.gruppenchatAId },
          channelId: "chat",
          sound: "default",
        },
      ]),
    );
    expect(JSON.stringify(expoAttrappe.nachrichten)).not.toContain("Geheimer");
    expect(JSON.stringify(expoAttrappe.nachrichten)).not.toContain(tEltern);
  });

  test("Einzelchat: Titel nennt den Einzelchat, Empfänger sind das Elternteil und die SL der Stufe", async () => {
    const [eltern, sl, andereSl, andereEltern] = await Promise.all([
      person("elternA"),
      person("slA"),
      person("slA"),
      person("elternA"),
    ]);
    const antwort = await aufruf(eltern, "POST", "/api/v1/chats/direkt", {
      stufeId: welt.stufeAId,
    });
    const { id } = (await antwort.json()) as { id: string };
    const [tEltern, tSl, tAndereSl] = await Promise.all(
      [eltern, sl, andereSl, andereEltern].map(melde),
    );

    await sende(sl, id, "Antwort");
    expect(texte(expoAttrappe.nachrichten)).toEqual(
      [tEltern, tAndereSl].sort(),
    );
    expect(
      expoAttrappe.nachrichten.every(
        (n) => n.title === "Neue Nachricht im Einzelchat Stufe A",
      ),
    ).toBe(true);
    expect(texte(expoAttrappe.nachrichten)).not.toContain(tSl);
  });

  test("nicht an Personen mit abgeschaltetem Chat-Push, Deaktivierte", async () => {
    const [eltern, still, deaktiviert, sl] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("elternA"),
      person("slA"),
    ]);
    const [, tStill, tDeaktiviert, tSl] = await Promise.all(
      [eltern, still, deaktiviert, sl].map(melde),
    );
    await db
      .update(schema.user)
      .set({ pushChat: false })
      .where(eq(schema.user.id, still.id!));
    await db
      .update(schema.user)
      .set({ banned: true, deaktiviertAm: new Date() })
      .where(eq(schema.user.id, deaktiviert.id!));

    await sende(eltern, welt.gruppenchatAId, "Hallo");
    expect(texte(expoAttrappe.nachrichten)).toEqual([tSl]);
    for (const token of [tStill, tDeaktiviert]) {
      expect(texte(expoAttrappe.nachrichten)).not.toContain(token);
    }
  });

  test("eine abgelehnte Nachricht löst keinen Push aus", async () => {
    const [eltern, sl, fremde] = await Promise.all([
      person("elternA"),
      person("slA"),
      person("elternB"),
    ]);
    await Promise.all([sl, fremde].map(melde));
    expect((await sende(eltern, welt.gruppenchatAId, " ")).status).toBe(400);
    expect((await sende(fremde, welt.gruppenchatAId, "Hallo")).status).toBe(
      404,
    );
    expect(expoAttrappe.nachrichten).toEqual([]);
  });

  test("ein Fehler beim Pushen lässt das Senden nicht scheitern", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    await melde(sl);
    expoAttrappe.ausfall = true;
    const antwort = await sende(eltern, welt.gruppenchatAId, "Hallo");
    expect(antwort.status).toBe(201);
  });
});
