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

const fcmAttrappe = bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  fcm: fcmAttrappe,
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
  fcmAttrappe.zuruecksetzen();
});

const person = (persona: Persona) => legePersonaAn(welt, persona);

const aufruf = (
  konto: PersonaKonto,
  methode: "GET" | "POST" | "PUT" | "PATCH",
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

interface Letzte {
  text: string;
  erstelltAm: string;
  eigene: boolean;
  autor: { id: string; name: string };
}

async function letzte(konto: PersonaKonto, chatId: string) {
  const antwort = await aufruf(konto, "GET", "/api/v1/chats");
  expect(antwort.status).toBe(200);
  const { chats } = (await antwort.json()) as {
    chats: { id: string; letzteNachricht: Letzte | null }[];
  };
  return chats.find((k) => k.id === chatId)?.letzteNachricht;
}

describe("letzteNachricht in der Chatliste", () => {
  test("ist null ohne Nachricht, danach die neueste mit Autor und eigene", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    const chat = welt.gruppenchatAId;
    expect(await letzte(eltern, chat)).toBeNull();

    await sende(eltern, chat, "Eins");
    await sende(sl, chat, "Zwei");
    expect(await letzte(eltern, chat)).toEqual({
      text: "Zwei",
      erstelltAm: expect.stringMatching(/Z$/),
      eigene: false,
      autor: { id: sl.id, name: "SL A" },
    });
    expect((await letzte(sl, chat))?.eigene).toBe(true);
  });

  test("der Text ist auf 120 Zeichen gekürzt", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    const lang = "ä".repeat(300);
    await sende(eltern, welt.gruppenchatAId, lang);
    expect((await letzte(sl, welt.gruppenchatAId))?.text).toBe("ä".repeat(120));
    await sende(eltern, welt.gruppenchatAId, "b".repeat(120));
    expect((await letzte(sl, welt.gruppenchatAId))?.text).toBe("b".repeat(120));
  });

  test("ausgeblendete Nachrichten zählen nicht, dann gilt die letzte sichtbare, auch für die Autorin", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    const chat = welt.gruppenchatAId;
    await sende(sl, chat, "Sichtbar");
    const antwort = await sende(eltern, chat, "Unpassend");
    const { id } = (await antwort.json()) as { id: string };
    expect((await letzte(sl, chat))?.text).toBe("Unpassend");
    const aus = await aufruf(
      sl,
      "POST",
      `/api/v1/nachrichten/${id}/ausblenden`,
    );
    expect(aus.status).toBe(204);
    for (const konto of [sl, eltern]) {
      expect((await letzte(konto, chat))?.text).toBe("Sichtbar");
    }
  });

  test("ist nur eine Nachricht da und ausgeblendet, bleibt null", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    const { id } = (await (
      await sende(eltern, welt.gruppenchatAId, "Unpassend")
    ).json()) as { id: string };
    await aufruf(sl, "POST", `/api/v1/nachrichten/${id}/ausblenden`);
    expect(await letzte(eltern, welt.gruppenchatAId)).toBeNull();
    expect(await letzte(sl, welt.gruppenchatAId)).toBeNull();
  });

  test("Nachrichten vor dem Beitritt der Eltern erscheinen nicht", async () => {
    const sl = await person("slA");
    await sende(sl, welt.gruppenchatAId, "Von früher");
    const spaeter = await person("elternA");
    expect(await letzte(spaeter, welt.gruppenchatAId)).toBeNull();
    expect((await letzte(sl, welt.gruppenchatAId))?.text).toBe("Von früher");
  });

  test("Eltern sehen die letzte Nachricht nur in ihren Chats", async () => {
    const [elternA, elternB, sl] = await Promise.all([
      person("elternA"),
      person("elternB"),
      person("slA"),
    ]);
    const antwort = await aufruf(elternA, "POST", "/api/v1/chats/direkt", {
      stufeId: welt.stufeAId,
    });
    const { id: direkt } = (await antwort.json()) as { id: string };
    await sende(elternA, direkt, "Nur für die SL");
    await sende(sl, welt.gruppenchatAId, "Für Stufe A");

    expect((await letzte(sl, direkt))?.text).toBe("Nur für die SL");
    expect((await letzte(elternA, welt.gruppenchatAId))?.text).toBe(
      "Für Stufe A",
    );
    expect(await letzte(elternB, welt.gruppenchatBId)).toBeNull();
    const listeB = (await (
      await aufruf(elternB, "GET", "/api/v1/chats")
    ).text()) as string;
    expect(listeB).not.toContain("Für Stufe A");
    expect(listeB).not.toContain("Nur für die SL");
  });

  test("die Antwort enthält nur die benötigten Felder (SR-74)", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    await sende(eltern, welt.gruppenchatAId, "Hallo");
    const letzteNachricht = await letzte(sl, welt.gruppenchatAId);
    expect(Object.keys(letzteNachricht!).sort()).toEqual([
      "autor",
      "eigene",
      "erstelltAm",
      "text",
    ]);
    expect(Object.keys(letzteNachricht!.autor).sort()).toEqual(["id", "name"]);
  });
});
