import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { inArray } from "drizzle-orm";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
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
} from "vitest";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { sendePush } from "../src/push.js";
import { API_URL } from "./hilfen/datenbank.js";

const SENDEN = "https://exp.host/--/api/v2/push/send";
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const expo = new Expo({ accessToken: "test-zugang" });
const { pushToken } = schema;

type Anfrage = { authorization: string | null; nachrichten: ExpoPushMessage[] };
let anfragen: Anfrage[];
// Antwort pro Anfrage; die Anfrage steht schon in `anfragen`
let antwort: (nachrichten: ExpoPushMessage[]) => Response;
let ticketFuer: Record<string, object>;
let logZeilen: Record<string, unknown>[];

const json = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), {
    status,
    headers: { "content-type": "application/json" },
  });

let max: string;
let erika: string;
let sitzungen: string[];

beforeAll(async () => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    if (String(url) !== SENDEN) throw new Error(`Kein Netz im Test: ${url}`);
    const kopf = new Headers(init.headers);
    // Das SDK komprimiert JSON über 1024 Zeichen
    const koerper =
      kopf.get("content-encoding") === "gzip"
        ? gunzipSync(init.body as Buffer)
        : (init.body as string);
    const nachrichten = JSON.parse(String(koerper)) as ExpoPushMessage[];
    anfragen.push({ authorization: kopf.get("authorization"), nachrichten });
    return antwort(nachrichten);
  });

  const [abteilung] = await db
    .insert(schema.abteilung)
    .values({ name: "Push-Test" })
    .returning();
  const personen = await db
    .insert(schema.user)
    .values(
      ["Max Muster", "Erika Beispiel"].map((name) => ({
        name,
        email: `${randomUUID()}@example.org`,
        abteilungId: abteilung!.id,
      })),
    )
    .returning();
  max = personen[0]!.id;
  erika = personen[1]!.id;
  const jetzt = new Date();
  const ablauf = new Date(jetzt.getTime() + 3_600_000);
  // Eine Sitzung pro Token: 201 für Max, eine für Erika
  const zeilen = await db
    .insert(schema.session)
    .values(
      Array.from({ length: 202 }, (_, i) => ({
        token: randomUUID(),
        expiresAt: ablauf,
        updatedAt: jetzt,
        userId: i < 201 ? max : erika,
      })),
    )
    .returning({ id: schema.session.id });
  sitzungen = zeilen.map((z) => z.id);
});

beforeEach(() => {
  anfragen = [];
  ticketFuer = {};
  antwort = (nachrichten) =>
    json({
      data: nachrichten.map(
        (n) => ticketFuer[String(n.to)] ?? { status: "ok", id: randomUUID() },
      ),
    });
  logZeilen = [];
  vi.spyOn(console, "log").mockImplementation((zeile: string) => {
    const eintrag = JSON.parse(zeile) as Record<string, unknown>;
    if (eintrag.ereignis === "push") logZeilen.push(eintrag);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(pushToken).where(inArray(pushToken.userId, [max, erika]));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.delete(schema.user).where(inArray(schema.user.id, [max, erika]));
  await sql.end();
});

// Max' Sitzungen der Reihe nach; Erikas steht als letzte
async function legeTokens(anzahl: number, userId = max) {
  const zeilen = Array.from({ length: anzahl }, (_, i) => ({
    sessionId: userId === max ? sitzungen[i]! : sitzungen[201]!,
    token: `ExponentPushToken[test-${randomUUID()}]`,
    userId,
    plattform: "ios" as const,
  }));
  await db.insert(pushToken).values(zeilen);
  return zeilen.map((z) => z.token);
}

const vorhanden = async (tokens: string[]) =>
  (
    await db
      .select({ token: pushToken.token })
      .from(pushToken)
      .where(inArray(pushToken.token, tokens))
  ).map((z) => z.token);

const PUSH = { typ: "chat", id: "chat-1", titel: "Neue Nachricht" } as const;

test("201 Tokens gehen in Chunks zu 100, 100 und 1, jedes Token einmal und mit Access Token", async () => {
  const tokens = await legeTokens(201);
  await sendePush({ db, expo }, [max], PUSH);
  expect(anfragen.map((a) => a.nachrichten.length)).toEqual([100, 100, 1]);
  expect(
    anfragen.flatMap((a) => a.nachrichten.map((n) => n.to)).sort(),
  ).toEqual([...tokens].sort());
  expect(anfragen.map((a) => a.authorization)).toEqual(
    Array(3).fill("Bearer test-zugang"),
  );
  expect(logZeilen).toEqual([]);
});

test("nur DeviceNotRegistered löscht das Token; jedes Fehlerticket wird ohne Token geloggt", async () => {
  const [ok, tot, limit] = await legeTokens(3);
  ticketFuer = {
    [tot!]: {
      status: "error",
      message: `"${tot}" is not a registered push notification recipient`,
      details: { error: "DeviceNotRegistered", expoPushToken: tot },
    },
    [limit!]: {
      status: "error",
      message: `Zu viele Pushes an ${limit}`,
      details: { error: "MessageRateExceeded", expoPushToken: limit },
    },
  };
  await sendePush({ db, expo }, [max], PUSH);
  expect((await vorhanden([ok!, tot!, limit!])).sort()).toEqual(
    [ok!, limit!].sort(),
  );
  expect(logZeilen.map((z) => z.code).sort()).toEqual([
    "DeviceNotRegistered",
    "MessageRateExceeded",
  ]);
  const zeilen = JSON.stringify(logZeilen);
  for (const token of [ok!, tot!, limit!]) expect(zeilen).not.toContain(token);
});

describe("Inhalt", () => {
  test("genau Titel, Typ und ID, Kanal und Ton; keine Personendaten", async () => {
    const [chat] = await legeTokens(1);
    await sendePush({ db, expo }, [max], {
      typ: "chat",
      id: "chat-1",
      titel: "Neue Nachricht im Chat Jungschi",
    });
    await sendePush({ db, expo }, [max], {
      typ: "programm",
      id: "programm-1",
      titel: "Waldtag am Sa 31.10. wurde verschoben",
    });
    expect(anfragen.flatMap((a) => a.nachrichten)).toEqual([
      {
        to: chat,
        title: "Neue Nachricht im Chat Jungschi",
        data: { typ: "chat", id: "chat-1" },
        channelId: "chat",
        sound: "default",
      },
      {
        to: chat,
        title: "Waldtag am Sa 31.10. wurde verschoben",
        data: { typ: "programm", id: "programm-1" },
        channelId: "programme",
        sound: "default",
      },
    ]);
    // Namen und E-Mail-Adressen der Personen stehen in den Zeilen, aber in keiner Anfrage
    const anfrage = JSON.stringify(anfragen);
    for (const geheim of ["Muster", "Beispiel", "example.org", max, erika])
      expect(anfrage).not.toContain(geheim);
  });

  test("ein zusätzliches Feld im Push erreicht Expo nicht", async () => {
    await legeTokens(1);
    await sendePush({ db, expo }, [max], {
      ...PUSH,
      // @ts-expect-error Push hat kein Textfeld
      text: "Geheimer Nachrichtentext",
      daten: { kind: "Kindername" },
    });
    const [nachricht] = anfragen[0]!.nachrichten;
    expect(Object.keys(nachricht!).sort()).toEqual([
      "channelId",
      "data",
      "sound",
      "title",
      "to",
    ]);
    expect(nachricht!.data).toEqual({ typ: "chat", id: "chat-1" });
    expect(JSON.stringify(anfragen)).not.toMatch(/Geheimer|Kindername/);
  });
});

test("ohne Token der Empfänger geht keine Anfrage hinaus", async () => {
  await legeTokens(1, erika);
  await sendePush({ db, expo }, [], PUSH);
  // Max hat kein Token; Erikas Token gehört nicht zu den Empfängern
  await sendePush({ db, expo }, [max], PUSH);
  expect(anfragen).toEqual([]);
});

test("Expo antwortet 401: Die Funktion kehrt zurück, loggt den Code und lässt die Token stehen", async () => {
  const tokens = await legeTokens(2);
  antwort = () =>
    json(
      {
        errors: [
          { code: "UNAUTHORIZED", message: `Kein Zugriff ${tokens[0]}` },
        ],
      },
      401,
    );
  await sendePush({ db, expo }, [max], PUSH);
  expect(logZeilen).toEqual([
    expect.objectContaining({
      ereignis: "push",
      code: "UNAUTHORIZED",
      status: 401,
    }),
  ]);
  expect(JSON.stringify(logZeilen)).not.toContain(tokens[0]);
  expect((await vorhanden(tokens)).sort()).toEqual([...tokens].sort());
});

test("scheitert der erste Chunk, geht der zweite trotzdem hinaus", async () => {
  await legeTokens(101);
  const ersteAntwort = antwort;
  antwort = (nachrichten) => {
    if (anfragen.length > 1) return ersteAntwort(nachrichten);
    throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  };
  await sendePush({ db, expo }, [max], PUSH);
  expect(anfragen.map((a) => a.nachrichten.length).sort()).toEqual([1, 100]);
  expect(logZeilen).toEqual([
    expect.objectContaining({ ereignis: "push", code: "ECONNRESET" }),
  ]);
});

test("beendete Datenbankverbindung: Die Funktion kehrt zurück, ohne Anfrage und mit einer Logzeile", async () => {
  const beendet = postgres(API_URL);
  await beendet.end();
  await sendePush({ db: erstelleDb(beendet), expo }, [max], PUSH);
  expect(anfragen).toEqual([]);
  expect(logZeilen).toEqual([
    expect.objectContaining({ ereignis: "push", code: "CONNECTION_ENDED" }),
  ]);
});
