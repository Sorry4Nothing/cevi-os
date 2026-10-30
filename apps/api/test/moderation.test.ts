import { Expo } from "expo-server-sdk";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
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

// Eine Welt pro Test: Die Tests zählen Meldungen und Audit-Einträge
let welt: Welt;
beforeEach(async () => {
  welt = await erstelleWelt(db, auth);
});

const aufruf = (
  konto: PersonaKonto,
  methode: "GET" | "POST" | "PATCH",
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
const ausblenden = (konto: PersonaKonto, nachrichtId: string) =>
  aufruf(konto, "POST", `/api/v1/nachrichten/${nachrichtId}/ausblenden`);
const melden = (konto: PersonaKonto, nachrichtId: string) =>
  aufruf(konto, "POST", `/api/v1/nachrichten/${nachrichtId}/melden`);
const meldungen = (konto: PersonaKonto, abfrage = "") =>
  aufruf(konto, "GET", `/api/v1/admin/meldungen${abfrage}`);
const erledigen = (konto: PersonaKonto, meldungId: string) =>
  aufruf(konto, "PATCH", `/api/v1/admin/meldungen/${meldungId}`, {
    erledigt: true,
  });

const person = (persona: Persona) => legePersonaAn(welt, persona);

type Gelesen = {
  id: string;
  text: string | null;
  ausgeblendet: boolean;
  eigene: boolean;
};
const lies = async (konto: PersonaKonto, chatId: string) =>
  (
    (await (
      await aufruf(konto, "GET", `/api/v1/chats/${chatId}/nachrichten`)
    ).json()) as { nachrichten: Gelesen[] }
  ).nachrichten;

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

// Legt die Meldung direkt an, wie sie die Route anlegt
async function meldeDirekt(
  nachrichtId: string,
  autor: PersonaKonto,
  melder: PersonaKonto,
  text = "Kopie",
) {
  const [zeile] = await db
    .insert(schema.meldung)
    .values({
      abteilungId: welt.testabteilungId,
      nachrichtId,
      textKopie: text,
      autorId: autor.id as string,
      gemeldetVon: melder.id as string,
    })
    .returning({ id: schema.meldung.id });
  return zeile.id;
}

const auditVon = (zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.zielId, zielId))
    .orderBy(asc(schema.auditLog.id));

async function einzelchat(eltern: PersonaKonto, sl: PersonaKonto) {
  const antwort = await aufruf(eltern, "POST", "/api/v1/chats/direkt", {
    stufeId: welt.stufeAId,
  });
  expect(antwort.status).toBe(200);
  expect(sl.id).toBeTruthy();
  return ((await antwort.json()) as { id: string }).id;
}

describe("POST /api/v1/nachrichten/:id/ausblenden", () => {
  test("die SL blendet im Gruppenchat der eigenen Stufe aus: Autorin sieht den Hinweis, andere Eltern nichts, ein Audit-Eintrag", async () => {
    const [sl, autorin, andere] = await Promise.all([
      person("slA"),
      person("elternA"),
      person("elternA"),
    ]);
    const id = await schreibe(autorin, welt.gruppenchatAId, "Heikler Text");

    const antwort = await ausblenden(sl, id);
    expect(antwort.status).toBe(204);

    // Die Autorin bekommt keinen Text mehr, nur das Kennzeichen
    expect(await lies(autorin, welt.gruppenchatAId)).toEqual([
      expect.objectContaining({
        id,
        text: null,
        ausgeblendet: true,
        eigene: true,
      }),
    ]);
    expect(await lies(andere, welt.gruppenchatAId)).toEqual([]);
    expect(await lies(sl, welt.gruppenchatAId)).toEqual([]);

    const eintraege = await auditVon(id);
    expect(eintraege).toEqual([
      expect.objectContaining({
        abteilungId: welt.testabteilungId,
        akteurId: sl.id,
        aktion: "nachricht_ausgeblendet",
        zielTyp: "nachricht",
        details: { chatId: welt.gruppenchatAId, durch: "stufenleitung" },
      }),
    ]);
    // Weder Text noch Namen im Eintrag
    expect(JSON.stringify(eintraege)).not.toContain("Heikler Text");

    // Danach ist die Nachricht für die SL wie für alle anderen nicht mehr sichtbar
    expect((await ausblenden(sl, id)).status).toBe(404);
    expect(await auditVon(id)).toHaveLength(1);
  });

  test("SL können im Einzelchat nicht ausblenden", async () => {
    const [sl, eltern] = await Promise.all([person("slA"), person("elternA")]);
    const chatId = await einzelchat(eltern, sl);
    const id = await schreibe(eltern, chatId);

    // Die SL ist Mitglied und sieht die Nachricht, darf sie aber nicht ausblenden
    expect(await lies(sl, chatId)).toHaveLength(1);
    expect((await ausblenden(sl, id)).status).toBe(403);
    expect(await lies(sl, chatId)).toHaveLength(1);
    expect(await auditVon(id)).toEqual([]);
  });

  test("Eltern, SL anderer Stufen, Leitende und Admins ohne Meldung blenden nicht aus", async () => {
    const [autorin, eltern, slB, leitende, admin] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("slB"),
      person("leitendeA"),
      person("admin"),
    ]);
    const id = await schreibe(autorin, welt.gruppenchatAId);
    // Mitglied ohne Recht: 403; wer die Nachricht nicht sieht: 404
    expect((await ausblenden(eltern, id)).status).toBe(403);
    expect((await ausblenden(autorin, id)).status).toBe(403);
    expect((await ausblenden(slB, id)).status).toBe(404);
    expect((await ausblenden(leitende, id)).status).toBe(404);
    expect((await ausblenden(admin, id)).status).toBe(404);
    expect((await ausblenden(admin, randomUUID())).status).toBe(404);
    expect(
      (await aufruf(admin, "POST", "/api/v1/nachrichten/x/ausblenden")).status,
    ).toBe(400);
    expect(await auditVon(id)).toEqual([]);
  });

  test("Admins blenden gemeldete Nachrichten aus, auch im Einzelchat, mit einem Audit-Eintrag", async () => {
    const [sl, eltern, admin] = await Promise.all([
      person("slA"),
      person("elternA"),
      person("admin"),
    ]);
    const chatId = await einzelchat(eltern, sl);
    const id = await schreibe(eltern, chatId);
    expect((await ausblenden(admin, id)).status).toBe(404);

    await meldeDirekt(id, eltern, sl);
    expect((await ausblenden(admin, id)).status).toBe(204);

    expect(await auditVon(id)).toEqual([
      expect.objectContaining({
        akteurId: admin.id,
        aktion: "nachricht_ausgeblendet",
        details: { chatId, durch: "admin" },
      }),
    ]);
    expect(await lies(eltern, chatId)).toEqual([
      expect.objectContaining({ text: null, ausgeblendet: true }),
    ]);
    // Wiederholt ist es ein No-op und schreibt keinen zweiten Eintrag
    expect((await ausblenden(admin, id)).status).toBe(204);
    expect(await auditVon(id)).toHaveLength(1);
  });

  test("ein Admin blendet keine Nachricht aus, die er selbst geschrieben hat und über die gemeldet wurde", async () => {
    const [admin, sl] = await Promise.all([person("admin"), person("slA")]);
    const id = await schreibe(admin, welt.gruppenchatAId);
    await meldeDirekt(id, admin, sl);
    expect((await ausblenden(admin, id)).status).toBe(404);
  });

  test("eine erledigte Meldung öffnet Admins die Nachricht nicht mehr", async () => {
    const [sl, eltern, admin] = await Promise.all([
      person("slA"),
      person("elternA"),
      person("admin"),
    ]);
    const id = await schreibe(eltern, welt.gruppenchatAId);
    const meldungId = await meldeDirekt(id, eltern, sl);
    expect((await erledigen(admin, meldungId)).status).toBe(204);
    expect((await ausblenden(admin, id)).status).toBe(404);
  });
});

describe("POST /api/v1/nachrichten/:id/melden", () => {
  test("jede Person im Chat meldet; die Meldung speichert eine Kopie des Textes, nur einmal pro Person", async () => {
    const [autorin, eltern, sl] = await Promise.all([
      person("elternA"),
      person("elternA"),
      person("slA"),
    ]);
    const id = await schreibe(autorin, welt.gruppenchatAId, "Der Text");

    expect((await melden(eltern, id)).status).toBe(204);
    expect((await melden(eltern, id)).status).toBe(204);
    expect((await melden(sl, id)).status).toBe(204);

    const zeilen = await db
      .select()
      .from(schema.meldung)
      .where(eq(schema.meldung.nachrichtId, id));
    expect(zeilen.map((z) => z.gemeldetVon).sort()).toEqual(
      [eltern.id, sl.id].sort(),
    );
    expect(zeilen[0]).toEqual(
      expect.objectContaining({
        abteilungId: welt.testabteilungId,
        textKopie: "Der Text",
        autorId: autorin.id,
        erledigtAm: null,
      }),
    );
  });

  test("die Kopie bleibt, wenn die Nachricht gelöscht wird", async () => {
    const [autorin, eltern] = await Promise.all([
      person("elternA"),
      person("elternA"),
    ]);
    const id = await schreibe(autorin, welt.gruppenchatAId, "Beleg");
    await melden(eltern, id);
    await db.delete(schema.nachricht).where(eq(schema.nachricht.id, id));
    const [zeile] = await db
      .select()
      .from(schema.meldung)
      .where(eq(schema.meldung.gemeldetVon, eltern.id as string));
    expect(zeile).toEqual(
      expect.objectContaining({ nachrichtId: null, textKopie: "Beleg" }),
    );
  });

  test("nur wer die Nachricht sieht, meldet sie: andere Stufen, Admins und Eltern vor ihrem Beitritt bekommen 404", async () => {
    const [sl, elternB, admin] = await Promise.all([
      person("slA"),
      person("elternB"),
      person("admin"),
    ]);
    const id = await schreibe(sl, welt.gruppenchatAId);
    expect((await melden(elternB, id)).status).toBe(404);
    expect((await melden(admin, id)).status).toBe(404);
    expect((await melden(sl, randomUUID())).status).toBe(404);
    // Ein Admin, dem eine Meldung die Nachricht zeigt, ist deswegen kein Mitglied
    await meldeDirekt(id, sl, await person("elternA"));
    expect((await melden(admin, id)).status).toBe(404);

    const alt = randomUUID();
    await db.insert(schema.nachricht).values({
      id: alt,
      chatId: welt.gruppenchatAId,
      autorId: sl.id as string,
      text: "Vor dem Beitritt",
      erstelltAm: new Date(Date.now() - 86_400_000),
    });
    const neueEltern = await person("elternA");
    expect((await melden(neueEltern, alt)).status).toBe(404);
  });

  test("die eigene Nachricht lässt sich nur melden, wenn sie ausgeblendet wurde", async () => {
    const [sl, autorin] = await Promise.all([person("slA"), person("elternA")]);
    const id = await schreibe(autorin, welt.gruppenchatAId);
    expect((await melden(autorin, id)).status).toBe(400);
    await ausblenden(sl, id);
    expect((await melden(autorin, id)).status).toBe(204);
    // Andere Eltern sehen die ausgeblendete Nachricht nicht und melden sie nicht
    expect((await melden(await person("elternA"), id)).status).toBe(404);
  });

  test("Missbrauch ist begrenzt: höchstens 10 Meldungen pro Stunde und Person", async () => {
    const [sl, eltern] = await Promise.all([person("slA"), person("elternA")]);
    const ids = await Promise.all(
      Array.from({ length: 11 }, () => schreibe(sl, welt.gruppenchatAId)),
    );
    const status: number[] = [];
    for (const id of ids) status.push((await melden(eltern, id)).status);
    expect(status).toEqual([...Array(10).fill(204), 429]);
    expect(
      await db
        .select()
        .from(schema.meldung)
        .where(eq(schema.meldung.gemeldetVon, eltern.id as string)),
    ).toHaveLength(10);
  });

  test("ungültige ID ist 400", async () => {
    const eltern = await person("elternA");
    expect(
      (await aufruf(eltern, "POST", "/api/v1/nachrichten/x/melden")).status,
    ).toBe(400);
  });
});

describe("GET und PATCH /api/v1/admin/meldungen", () => {
  test("Kein Admin sieht eine Meldung über sich selbst, alle anderen Admins schon", async () => {
    const [gemeldet, anderer, sl, eltern] = await Promise.all([
      person("admin"),
      person("admin"),
      person("slA"),
      person("elternA"),
    ]);
    // Der Admin schreibt im Gruppenchat, weil er zugleich SL ist
    await db.insert(schema.rolle).values({
      userId: gemeldet.id as string,
      stufeId: welt.stufeAId,
      typ: "stufenleitung",
    });
    const eigene = await schreibe(
      gemeldet,
      welt.gruppenchatAId,
      "Eigener Text",
    );
    const fremde = await schreibe(eltern, welt.gruppenchatAId, "Fremder Text");
    const ueberAdmin = await meldeDirekt(eigene, gemeldet, sl, "Eigener Text");
    const ueberEltern = await meldeDirekt(fremde, eltern, sl, "Fremder Text");

    const idsVon = async (konto: PersonaKonto) =>
      (
        (await (await meldungen(konto)).json()) as {
          meldungen: { id: string }[];
        }
      ).meldungen.map((m) => m.id);
    expect(await idsVon(gemeldet)).toEqual([ueberEltern]);
    expect((await idsVon(anderer)).sort()).toEqual(
      [ueberAdmin, ueberEltern].sort(),
    );

    // Auch Erledigen: für die gemeldete Person existiert die Meldung nicht
    expect((await erledigen(gemeldet, ueberAdmin)).status).toBe(404);
    expect((await erledigen(anderer, ueberAdmin)).status).toBe(204);
  });

  test("die Antwort nennt Text, Chat, Autorin und Melderin, aber keine Kontodaten", async () => {
    const [admin, sl, autorin] = await Promise.all([
      person("admin"),
      person("slA"),
      person("elternA"),
    ]);
    const id = await schreibe(autorin, welt.gruppenchatAId, "Der Text");
    const meldungId = await meldeDirekt(id, autorin, sl, "Der Text");
    await ausblenden(sl, id);

    const antwort = await meldungen(admin);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({
      meldungen: [
        {
          id: meldungId,
          erstelltAm: expect.any(String),
          text: "Der Text",
          nachrichtId: id,
          ausgeblendet: true,
          chat: {
            typ: "stufe",
            stufe: { id: welt.stufeAId, name: "Stufe A", kuerzel: "A" },
          },
          autor: { id: autorin.id, name: "Eltern A", deaktiviert: false },
          gemeldetVon: "SL A",
        },
      ],
      naechster: null,
    });
  });

  test("nur Admins der eigenen Abteilung; andere bekommen 403 oder 404", async () => {
    const [sl, eltern, demoAdmin, admin] = await Promise.all([
      person("slA"),
      person("elternA"),
      person("demoAdmin"),
      person("admin"),
    ]);
    const id = await schreibe(eltern, welt.gruppenchatAId);
    const meldungId = await meldeDirekt(id, eltern, sl);

    for (const konto of [sl, eltern]) {
      expect((await meldungen(konto)).status).toBe(403);
    }
    expect((await erledigen(sl, meldungId)).status).toBe(403);
    // Die gemeldete Person kennt die Meldung nicht, auch ohne Admin-Rolle
    expect((await erledigen(eltern, meldungId)).status).toBe(404);
    // Der Admin einer anderen Abteilung sieht nichts und erledigt nichts
    expect(await (await meldungen(demoAdmin)).json()).toEqual({
      meldungen: [],
      naechster: null,
    });
    expect((await erledigen(demoAdmin, meldungId)).status).toBe(404);
    expect((await erledigen(admin, randomUUID())).status).toBe(404);
  });

  test("Erledigen leert die Kopie, schreibt einen Audit-Eintrag ohne Personendaten und ist wiederholt ein No-op", async () => {
    const [admin, sl, autorin] = await Promise.all([
      person("admin"),
      person("slA"),
      person("elternA"),
    ]);
    const id = await schreibe(autorin, welt.gruppenchatAId, "Der Text");
    const meldungId = await meldeDirekt(id, autorin, sl, "Der Text");

    expect((await erledigen(admin, meldungId)).status).toBe(204);
    expect((await erledigen(admin, meldungId)).status).toBe(204);

    const [zeile] = await db
      .select()
      .from(schema.meldung)
      .where(eq(schema.meldung.id, meldungId));
    expect(zeile).toEqual(
      expect.objectContaining({
        textKopie: null,
        erledigtVon: admin.id,
        erledigtAm: expect.any(Date),
      }),
    );
    expect(await auditVon(meldungId)).toEqual([
      expect.objectContaining({
        abteilungId: welt.testabteilungId,
        akteurId: admin.id,
        aktion: "meldung_erledigt",
        zielTyp: "meldung",
        details: null,
      }),
    ]);
    // Erledigte Meldungen stehen nicht mehr im Eingang
    expect((await (await meldungen(admin)).json()).meldungen).toEqual([]);
  });

  test("ungültiger Body, Cursor und ID sind 400", async () => {
    const admin = await person("admin");
    const id = randomUUID();
    for (const body of [{}, { erledigt: false }, { erledigt: true, x: 1 }]) {
      expect(
        (await aufruf(admin, "PATCH", `/api/v1/admin/meldungen/${id}`, body))
          .status,
      ).toBe(400);
    }
    expect((await erledigen(admin, "x")).status).toBe(400);
    expect((await meldungen(admin, "?vor=x")).status).toBe(400);
    expect((await meldungen(admin, `?vor=${id}&a=1`)).status).toBe(400);
  });

  test("Seiten zu 50 mit Cursor, ohne Lücke und Doppelte", async () => {
    const [admin, sl, autorin] = await Promise.all([
      person("admin"),
      person("slA"),
      person("elternA"),
    ]);
    // Ohne Nachricht-ID: Der Teilindex erlaubt eine offene Meldung pro Person und Nachricht, NULL zählt als verschieden
    await db.insert(schema.meldung).values(
      Array.from({ length: 51 }, () => ({
        abteilungId: welt.testabteilungId,
        nachrichtId: null,
        textKopie: "Kopie",
        autorId: autorin.id as string,
        gemeldetVon: sl.id as string,
      })),
    );
    const erste = (await (await meldungen(admin)).json()) as {
      meldungen: { id: string }[];
      naechster: string | null;
    };
    expect(erste.meldungen).toHaveLength(50);
    const zweite = (await (
      await meldungen(admin, `?vor=${erste.naechster}`)
    ).json()) as { meldungen: { id: string }[]; naechster: string | null };
    expect(zweite.meldungen).toHaveLength(1);
    expect(zweite.naechster).toBeNull();
    const alle = [...erste.meldungen, ...zweite.meldungen].map((m) => m.id);
    expect(new Set(alle).size).toBe(51);
  });
});

describe("Textkopien", () => {
  test("eine erledigte Meldung mit Kopie ist für die Datenbank unzulässig", async () => {
    const sl = await person("slA");
    await expect(
      db.insert(schema.meldung).values({
        abteilungId: welt.testabteilungId,
        textKopie: "bleibt",
        gemeldetVon: sl.id as string,
        erledigtAm: new Date(),
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(schema.meldung)
        .where(
          and(
            eq(schema.meldung.abteilungId, welt.testabteilungId),
            eq(schema.meldung.textKopie, "bleibt"),
          ),
        ),
    ).toEqual([]);
  });
});
