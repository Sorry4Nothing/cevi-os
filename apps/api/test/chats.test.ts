import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
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
import { legeGruppenchatAn } from "../src/chat.js";
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
import { legeProgrammAn } from "./hilfen/programme.js";

bereiteAuthTestsVor();

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

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Eine Welt pro Test: Die Tests lesen ganze Verläufe und zählen Nachrichten, die Chats dürfen sich nicht teilen
let welt: Welt;
beforeEach(async () => {
  welt = await erstelleWelt(db, auth);
});

const aufruf = async (
  konto: PersonaKonto,
  methode: "GET" | "POST",
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

const lies = (konto: PersonaKonto, chatId: string, abfrage = "") =>
  aufruf(konto, "GET", `/api/v1/chats/${chatId}/nachrichten${abfrage}`);
const sende = (konto: PersonaKonto, chatId: string, body: unknown) =>
  aufruf(konto, "POST", `/api/v1/chats/${chatId}/nachrichten`, body);

// Frische Konten: Rate-Limit und Beitrittsdatum gehören der Person
const person = (persona: Persona) => legePersonaAn(welt, persona);

type Nachricht = {
  id: string;
  text: string;
  eigene: boolean;
  autor: { id: string; name: string };
  programm: { id: string; titel: string } | null;
};

describe("GET /api/v1/chats", () => {
  test("Eltern und SL sehen den Gruppenchat ihrer Stufe, andere Stufen und Admins keinen", async () => {
    const [eltern, sl, elternB, admin] = await Promise.all([
      person("elternA"),
      person("slA"),
      person("elternB"),
      person("admin"),
    ]);
    const erwartet = (chatId: string, name: string) => ({
      chats: [
        {
          id: chatId,
          typ: "stufe",
          stufe: { id: expect.any(String), name, kuerzel: expect.any(String) },
        },
      ],
    });
    for (const konto of [eltern, sl]) {
      const antwort = await aufruf(konto, "GET", "/api/v1/chats");
      expect(antwort.status).toBe(200);
      expect(await antwort.json()).toEqual(
        erwartet(welt.gruppenchatAId, "Stufe A"),
      );
    }
    expect(
      await (await aufruf(elternB, "GET", "/api/v1/chats")).json(),
    ).toEqual(erwartet(welt.gruppenchatBId, "Stufe B"));
    expect(await (await aufruf(admin, "GET", "/api/v1/chats")).json()).toEqual({
      chats: [],
    });
  });

  test("Einzelchats stehen noch nicht in der Liste", async () => {
    const eltern = await person("elternA");
    await db.insert(schema.chat).values({
      abteilungId: welt.testabteilungId,
      typ: "direkt",
      stufeId: welt.stufeAId,
      elternUserId: eltern.id as string,
    });
    const { chats } = (await (
      await aufruf(eltern, "GET", "/api/v1/chats")
    ).json()) as { chats: { typ: string }[] };
    expect(chats.map((c) => c.typ)).toEqual(["stufe"]);
  });
});

describe("Nachrichten senden und lesen", () => {
  test("Eltern schreiben, die SL liest den Namen der Eltern, die Eltern die Namen der anderen Eltern", async () => {
    const [eltern, zweite, sl] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("slA"),
    ]);
    const antwort = await sende(eltern, welt.gruppenchatAId, {
      text: "  Wir sind dabei.  ",
    });
    expect(antwort.status).toBe(201);
    expect(await antwort.json()).toEqual({ id: expect.any(String) });
    await sende(sl, welt.gruppenchatAId, { text: "Super, danke!" });

    for (const [leser, eigene] of [
      [sl, "Super, danke!"],
      [zweite, undefined],
    ] as const) {
      const { nachrichten, naechster } = (await (
        await lies(leser, welt.gruppenchatAId)
      ).json()) as { nachrichten: Nachricht[]; naechster: string | null };
      // Neueste zuerst; der Text ist getrimmt
      expect(nachrichten.map((n) => [n.autor.name, n.text])).toEqual([
        ["SL A", "Super, danke!"],
        ["Eltern A", "Wir sind dabei."],
      ]);
      expect(nachrichten.find((n) => n.eigene)?.text).toBe(eigene);
      expect(naechster).toBeNull();
    }
  });

  test("Nachrichten vor dem Beitritt der Eltern sieht nur die SL", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    await db.insert(schema.nachricht).values({
      chatId: welt.gruppenchatAId,
      autorId: sl.id as string,
      text: "Vor deinem Beitritt",
      erstelltAm: new Date(Date.now() - 86_400_000),
    });
    await sende(sl, welt.gruppenchatAId, { text: "Danach" });

    const texte = async (konto: PersonaKonto) =>
      (
        (await (await lies(konto, welt.gruppenchatAId)).json()) as {
          nachrichten: Nachricht[];
        }
      ).nachrichten.map((n) => n.text);
    expect(await texte(eltern)).toEqual(["Danach"]);
    expect(await texte(sl)).toEqual(["Danach", "Vor deinem Beitritt"]);
  });

  test("ausgeblendete Nachrichten erscheinen nicht", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    await db.insert(schema.nachricht).values({
      chatId: welt.gruppenchatAId,
      autorId: sl.id as string,
      text: "Ausgeblendet",
      ausgeblendetAm: new Date(),
    });
    const { nachrichten } = (await (
      await lies(eltern, welt.gruppenchatAId)
    ).json()) as { nachrichten: Nachricht[] };
    expect(nachrichten).toEqual([]);
  });

  test("Cursor: 120 Nachrichten kommen in Seiten zu 50, ohne Lücke und Doppelte", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    // Eigene Stufe, damit andere Tests dieser Datei die Zählung nicht stören
    const [stufe] = await db
      .insert(schema.stufe)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Stufe P",
        kuerzel: "P",
        reihenfolge: 9,
      })
      .returning();
    await legeGruppenchatAn(db, {
      abteilungId: welt.testabteilungId,
      stufeId: stufe.id,
    });
    const [chat] = await db
      .select()
      .from(schema.chat)
      .where(eq(schema.chat.stufeId, stufe.id));
    await db.insert(schema.rolle).values({
      userId: sl.id as string,
      stufeId: stufe.id,
      typ: "stufenleitung",
    });
    await db.insert(schema.nachricht).values(
      Array.from({ length: 120 }, (_, i) => ({
        chatId: chat.id,
        autorId: sl.id as string,
        text: `Nachricht ${i}`,
      })),
    );

    const ids: string[] = [];
    let cursor: string | null = null;
    const groessen: number[] = [];
    do {
      const antwort = await lies(sl, chat.id, cursor ? `?vor=${cursor}` : "");
      const seite = (await antwort.json()) as {
        nachrichten: Nachricht[];
        naechster: string | null;
      };
      groessen.push(seite.nachrichten.length);
      ids.push(...seite.nachrichten.map((n) => n.id));
      cursor = seite.naechster;
    } while (cursor);

    expect(groessen).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
    expect(ids).toEqual([...ids].sort().reverse());
    // Eltern ohne Kind in dieser Stufe sehen den Chat nicht
    expect((await lies(eltern, chat.id)).status).toBe(404);
  });

  test("genau 50 Nachrichten ergeben keinen Cursor", async () => {
    const sl = await person("slA");
    const [stufe] = await db
      .insert(schema.stufe)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Stufe Q",
        kuerzel: "Q",
        reihenfolge: 10,
      })
      .returning();
    await legeGruppenchatAn(db, {
      abteilungId: welt.testabteilungId,
      stufeId: stufe.id,
    });
    const [chat] = await db
      .select()
      .from(schema.chat)
      .where(eq(schema.chat.stufeId, stufe.id));
    await db.insert(schema.rolle).values({
      userId: sl.id as string,
      stufeId: stufe.id,
      typ: "stufenleitung",
    });
    await db.insert(schema.nachricht).values(
      Array.from({ length: 50 }, (_, i) => ({
        chatId: chat.id,
        autorId: sl.id as string,
        text: `Nachricht ${i}`,
      })),
    );
    const seite = (await (await lies(sl, chat.id)).json()) as {
      nachrichten: Nachricht[];
      naechster: string | null;
    };
    expect(seite.nachrichten).toHaveLength(50);
    expect(seite.naechster).toBeNull();
  });
});

describe("Eingabe", () => {
  test.each([
    ["genau 2000 Zeichen", "x".repeat(2000), 201],
    ["2001 Zeichen", "x".repeat(2001), 400],
    ["leer", "", 400],
    ["nur Leerzeichen", "   \n ", 400],
    ["mit NUL-Zeichen", "a\u0000b", 400],
  ])("%s", async (_, text, status) => {
    const eltern = await person("elternA");
    expect((await sende(eltern, welt.gruppenchatAId, { text })).status).toBe(
      status,
    );
  });

  test.each([
    ["ohne Text", {}],
    ["Text keine Zeichenkette", { text: 5 }],
    ["fremdes Feld", { text: "Hallo", autorId: randomUUID() }],
    ["programmId keine UUID", { text: "Hallo", programmId: "x" }],
  ])("%s ist 400", async (_, body) => {
    const eltern = await person("elternA");
    expect((await sende(eltern, welt.gruppenchatAId, body)).status).toBe(400);
  });

  test("Chat-ID und Cursor müssen UUIDs sein", async () => {
    const eltern = await person("elternA");
    expect((await lies(eltern, "x")).status).toBe(400);
    expect((await lies(eltern, welt.gruppenchatAId, "?vor=x")).status).toBe(
      400,
    );
    expect(
      (await lies(eltern, welt.gruppenchatAId, "?vor=" + randomUUID() + "&a=1"))
        .status,
    ).toBe(400);
  });
});

describe("Bezug auf ein Programm", () => {
  test("ein Elternprogramm der Stufe geht durch und zeigt seinen Titel", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    const programm = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      titel: "Waldtag",
    });
    const antwort = await sende(eltern, welt.gruppenchatAId, {
      text: "Wir kommen",
      programmId: programm.id,
    });
    expect(antwort.status).toBe(201);

    for (const konto of [eltern, sl]) {
      const { nachrichten } = (await (
        await lies(konto, welt.gruppenchatAId)
      ).json()) as { nachrichten: Nachricht[] };
      expect(
        nachrichten.find((n) => n.text === "Wir kommen")?.programm,
      ).toEqual({ id: programm.id, titel: "Waldtag" });
    }

    // Wird das Programm später intern, verschwindet sein Titel aus dem Chat
    await db
      .update(schema.programm)
      .set({ sichtbarkeit: "intern" })
      .where(eq(schema.programm.id, programm.id));
    const { nachrichten } = (await (
      await lies(eltern, welt.gruppenchatAId)
    ).json()) as { nachrichten: Nachricht[] };
    expect(
      nachrichten.find((n) => n.text === "Wir kommen")?.programm,
    ).toBeNull();
  });

  test("interne und Leitenden-Programme, Programme anderer Stufen und Abteilungen und unbekannte IDs sind 400", async () => {
    const eltern = await person("elternA");
    const programme = {
      intern: await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        sichtbarkeit: "intern",
        stufen: [welt.stufeAId],
      }),
      leitende: await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        sichtbarkeit: "leitende",
        stufen: [welt.stufeAId],
      }),
      andereStufe: await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        sichtbarkeit: "eltern",
        stufen: [welt.stufeBId],
      }),
      ohneStufe: await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        sichtbarkeit: "eltern",
      }),
      fremdeAbteilung: await legeProgrammAn(db, {
        abteilungId: welt.demoAbteilungId,
        sichtbarkeit: "eltern",
        stufen: [welt.demoStufeId],
      }),
    };
    const ids = [...Object.values(programme).map((p) => p.id), randomUUID()];
    for (const programmId of ids) {
      const antwort = await sende(eltern, welt.gruppenchatAId, {
        text: "Hallo",
        programmId,
      });
      expect(antwort.status, programmId).toBe(400);
    }
    // Nichts wurde gespeichert
    const { nachrichten } = (await (
      await lies(eltern, welt.gruppenchatAId)
    ).json()) as { nachrichten: Nachricht[] };
    expect(nachrichten).toEqual([]);
  });
});

describe("fremde Chats", () => {
  test("andere Stufe, andere Abteilung und unbekannte ID sind 404, lesen wie schreiben", async () => {
    const [elternB, demo, leitende] = await Promise.all([
      person("elternB"),
      person("demoEltern"),
      person("leitendeA"),
    ]);
    for (const [konto, chatId] of [
      [elternB, welt.gruppenchatAId],
      [demo, welt.gruppenchatAId],
      [leitende, welt.gruppenchatAId],
      [elternB, welt.demoGruppenchatId],
      [elternB, randomUUID()],
    ] as const) {
      expect((await lies(konto, chatId)).status).toBe(404);
      expect((await sende(konto, chatId, { text: "Hallo" })).status).toBe(404);
    }
    const sl = await person("slA");
    // Zugang endet mit dem Konto
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, sl.id as string));
    expect((await lies(sl, welt.gruppenchatAId)).status).toBe(404);
  });
});

describe("Rate-Limit", () => {
  test("die 21. Nachricht in einer Minute ist 429, andere Personen schreiben weiter", async () => {
    const [eltern, sl] = await Promise.all([person("elternA"), person("slA")]);
    for (let i = 0; i < 20; i++) {
      const antwort = await sende(eltern, welt.gruppenchatAId, {
        text: `Nachricht ${i}`,
      });
      expect(antwort.status, String(i)).toBe(201);
    }
    const zuViele = await sende(eltern, welt.gruppenchatAId, { text: "21" });
    expect(zuViele.status).toBe(429);
    expect(await zuViele.json()).toEqual({
      code: "ZU_VIELE_ANFRAGEN",
      message: "Zu viele Anfragen",
    });
    expect((await sende(sl, welt.gruppenchatAId, { text: "Ich" })).status).toBe(
      201,
    );

    // Nach einer Minute geht es wieder: Die älteren Nachrichten rücken aus dem Fenster
    await db
      .update(schema.nachricht)
      .set({ erstelltAm: new Date(Date.now() - 61_000) })
      .where(eq(schema.nachricht.autorId, eltern.id as string));
    expect(
      (await sende(eltern, welt.gruppenchatAId, { text: "22" })).status,
    ).toBe(201);
  });

  test("gleichzeitige Anfragen überschreiten die Grenze nicht", async () => {
    const eltern = await person("elternA");
    const stati = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        sende(eltern, welt.gruppenchatAId, { text: `Parallel ${i}` }).then(
          (a) => a.status,
        ),
      ),
    );
    expect(stati.filter((s) => s === 201)).toHaveLength(20);
    expect(stati.filter((s) => s === 429)).toHaveLength(10);
  });
});

describe("Gruppenchat anlegen", () => {
  const neueStufe = async (name: string) => {
    const [stufe] = await db
      .insert(schema.stufe)
      .values({
        abteilungId: welt.testabteilungId,
        name,
        kuerzel: name,
        reihenfolge: 20,
      })
      .returning();
    return stufe.id;
  };
  const anzahl = async (stufeId: string) =>
    (
      await db
        .select()
        .from(schema.chat)
        .where(eq(schema.chat.stufeId, stufeId))
    ).length;

  test("legt genau einen Gruppenchat an, auch bei wiederholtem Aufruf", async () => {
    const stufeId = await neueStufe("Stufe H");
    const ziel = { abteilungId: welt.testabteilungId, stufeId };
    await legeGruppenchatAn(db, ziel);
    await legeGruppenchatAn(db, ziel);
    expect(await anzahl(stufeId)).toBe(1);
  });

  test("läuft in einer Transaktion mit der Stufe", async () => {
    const stufeId = await neueStufe("Stufe T");
    await db.transaction((tx) =>
      legeGruppenchatAn(tx, { abteilungId: welt.testabteilungId, stufeId }),
    );
    expect(await anzahl(stufeId)).toBe(1);
  });
});

describe("Datenmigration 0007", () => {
  test("ergänzt den Gruppenchat für bestehende Stufen und lässt sich wiederholen", async () => {
    const migration = readFileSync(
      new URL("../drizzle/0007_gruppenchats.sql", import.meta.url),
      "utf8",
    );
    const Zurueck = new Error("zurückrollen");
    let typen: string[] = [];
    await sql
      .begin(async (tx) => {
        const [abteilung] = await tx<{ id: string }[]>`
          insert into abteilung (name) values ('Migrationstest') returning id`;
        const [stufe] = await tx<{ id: string }[]>`
          insert into stufe (abteilung_id, name, kuerzel, reihenfolge)
          values (${abteilung.id}, 'M', 'M', 1) returning id`;
        await tx.unsafe(migration);
        await tx.unsafe(migration);
        typen = (
          await tx<{ typ: string }[]>`
            select typ from chat where stufe_id = ${stufe.id}`
        ).map((z) => z.typ);
        // Nichts davon bleibt in der geteilten Testdatenbank
        throw Zurueck;
      })
      .catch((fehler: unknown) => {
        if (fehler !== Zurueck) throw fehler;
      });
    expect(typen).toEqual(["stufe"]);
  });
});
