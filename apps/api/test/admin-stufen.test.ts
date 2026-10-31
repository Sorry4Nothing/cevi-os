import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
});

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

const BASIS = "/api/v1/admin/stufen";
const stufenBody = (extra: Record<string, unknown> = {}) => ({
  name: "Neue Stufe",
  kuerzel: "NS",
  ...extra,
});

async function legeStufeAn(konto = admin, extra: Record<string, unknown> = {}) {
  const antwort = await anfrage(konto, "POST", BASIS, stufenBody(extra));
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { id: string }).id;
}

const stufeZeile = async (id: string) =>
  (await db.select().from(schema.stufe).where(eq(schema.stufe.id, id)))[0];

describe("POST /api/v1/admin/stufen", () => {
  test("legt die Stufe in der Abteilung des Admins an, getrimmt", async () => {
    const id = await legeStufeAn(admin, {
      name: "  Pfadi  ",
      kuerzel: " P ",
    });
    expect(await stufeZeile(id)).toEqual({
      id,
      abteilungId: welt.testabteilungId,
      name: "Pfadi",
      kuerzel: "P",
    });
  });

  test("der Demo-Admin legt in der Demo-Abteilung an", async () => {
    const demoAdmin = await legePersonaAn(welt, "demoAdmin");
    const id = await legeStufeAn(demoAdmin);
    expect((await stufeZeile(id)).abteilungId).toBe(welt.demoAbteilungId);
  });

  test("legt in derselben Anfrage genau einen Gruppenchat der Stufe an", async () => {
    const id = await legeStufeAn();
    expect(
      await db
        .select({ typ: schema.chat.typ, abteilungId: schema.chat.abteilungId })
        .from(schema.chat)
        .where(eq(schema.chat.stufeId, id)),
    ).toEqual([{ typ: "stufe", abteilungId: welt.testabteilungId }]);
  });

  test("Eltern und SL der neuen Stufe finden den Chat und die Nummer der SL", async () => {
    const id = await legeStufeAn();
    const sl = await legePersonaAn(welt, "slA");
    const eltern = await legePersonaAn(welt, "elternA");
    const [kind] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Test",
        nachname: "Kind",
        stufeId: id,
      })
      .returning({ id: schema.kind.id });
    await db.insert(schema.kindEltern).values({
      kindId: kind.id,
      userId: eltern.id as string,
    });
    await db.insert(schema.rolle).values({
      userId: sl.id as string,
      stufeId: id,
      typ: "stufenleitung",
    });
    await db
      .update(schema.user)
      .set({ telefon: "+41 79 000 00 00" })
      .where(eq(schema.user.id, sl.id as string));

    for (const konto of [sl, eltern]) {
      const chats = (await (
        await anfrage(konto, "GET", "/api/v1/chats")
      ).json()) as {
        chats: { typ: string; stufe: { id: string } }[];
      };
      expect(
        chats.chats.filter((c) => c.stufe.id === id).map((c) => c.typ),
      ).toEqual(["stufe"]);
    }
    const kontakte = (await (
      await anfrage(eltern, "GET", `/api/v1/stufen/${id}/kontakte`)
    ).json()) as { kontakte: { telefon: string | null }[] };
    expect(kontakte.kontakte.map((k) => k.telefon)).toEqual([
      "+41 79 000 00 00",
    ]);
  });

  test.each([
    ["abteilungId im Body", () => ({ abteilungId: welt.demoAbteilungId })],
    ["leerer Name", () => ({ name: "   " })],
    ["Name mit 101 Zeichen", () => ({ name: "a".repeat(101) })],
    ["leeres Kürzel", () => ({ kuerzel: "" })],
    ["Kürzel mit 21 Zeichen", () => ({ kuerzel: "a".repeat(21) })],
    ["Reihenfolge (entfallen)", () => ({ reihenfolge: 3 })],
  ])("%s gibt 400", async (_titel, extra) => {
    const antwort = await anfrage(admin, "POST", BASIS, stufenBody(extra()));
    expect(antwort.status).toBe(400);
  });

  test.each(["slA", "leitendeA", "elternA"] as Persona[])(
    "%s gibt 403 und schreibt nichts",
    async (persona) => {
      const konto = await legePersonaAn(welt, persona);
      const name = `Verboten ${randomUUID()}`;
      const antwort = await anfrage(konto, "POST", BASIS, stufenBody({ name }));
      expect(antwort.status).toBe(403);
      expect(
        await db
          .select({ id: schema.stufe.id })
          .from(schema.stufe)
          .where(eq(schema.stufe.name, name)),
      ).toEqual([]);
    },
  );
});

describe("PATCH /api/v1/admin/stufen/:id", () => {
  test("benennt um und ändert das Kürzel einzeln", async () => {
    const id = await legeStufeAn();
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${id}`, { name: " Biber " }))
        .status,
    ).toBe(204);
    expect(await stufeZeile(id)).toMatchObject({
      name: "Biber",
      kuerzel: "NS",
    });
    await anfrage(admin, "PATCH", `${BASIS}/${id}`, { kuerzel: "B" });
    expect(await stufeZeile(id)).toMatchObject({ name: "Biber", kuerzel: "B" });
  });

  test("ein leerer Body ist ein No-op mit 204", async () => {
    const id = await legeStufeAn();
    const vorher = await stufeZeile(id);
    expect((await anfrage(admin, "PATCH", `${BASIS}/${id}`, {})).status).toBe(
      204,
    );
    expect(await stufeZeile(id)).toEqual(vorher);
  });

  test.each([
    ["abteilungId", { abteilungId: randomUUID() }],
    ["leerer Name", { name: " " }],
    ["Reihenfolge (entfallen)", { reihenfolge: 3 }],
  ])("%s gibt 400", async (_titel, body) => {
    const id = await legeStufeAn();
    expect((await anfrage(admin, "PATCH", `${BASIS}/${id}`, body)).status).toBe(
      400,
    );
  });

  test("eine ID, die keine UUID ist, gibt 400", async () => {
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/gibt-es-nicht`, { name: "X" }))
        .status,
    ).toBe(400);
  });

  test("unbekannte Stufe 404; der Demo-Admin auf eine Stufe der Testabteilung 404, ohne sie zu ändern", async () => {
    const demoAdmin = await legePersonaAn(welt, "demoAdmin");
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${randomUUID()}`, { name: "X" }))
        .status,
    ).toBe(404);
    expect(
      (
        await anfrage(demoAdmin, "PATCH", `${BASIS}/${welt.stufeAId}`, {
          name: "Fremd",
        })
      ).status,
    ).toBe(404);
    expect((await stufeZeile(welt.stufeAId)).name).toBe("Stufe A");
  });

  test("kein Admin: 403 ohne Änderung", async () => {
    const sl = await legePersonaAn(welt, "slA");
    const id = await legeStufeAn();
    expect(
      (await anfrage(sl, "PATCH", `${BASIS}/${id}`, { name: "Verboten" }))
        .status,
    ).toBe(403);
    expect((await stufeZeile(id)).name).toBe("Neue Stufe");
  });
});

describe("DELETE /api/v1/admin/stufen/:id", () => {
  test("gibt es nicht: 404 NICHT_GEFUNDEN, die Stufe bleibt", async () => {
    const id = await legeStufeAn();
    const antwort = await anfrage(admin, "DELETE", `${BASIS}/${id}`);
    expect(antwort.status).toBe(404);
    expect(await antwort.json()).toEqual({
      code: "NICHT_GEFUNDEN",
      message: "Nicht gefunden",
    });
    expect(await stufeZeile(id)).toBeDefined();
  });
});

describe("GET /api/v1/stufen", () => {
  type Eintrag = {
    id: string;
    name: string;
    kuerzel: string;
  };
  const liste = async (konto: PersonaKonto) => {
    const antwort = await anfrage(konto, "GET", "/api/v1/stufen");
    expect(antwort.status).toBe(200);
    return ((await antwort.json()) as { stufen: Eintrag[] }).stufen;
  };

  test("liefert Eltern und Admin dieselben Stufen der eigenen Abteilung: id, name, kuerzel, logoUrl", async () => {
    const eltern = await legePersonaAn(welt, "elternA");
    const [fuerEltern, fuerAdmin] = [await liste(eltern), await liste(admin)];
    expect(fuerEltern).toEqual(fuerAdmin);
    expect(
      fuerEltern.filter((s) => [welt.stufeAId, welt.stufeBId].includes(s.id)),
    ).toEqual([
      {
        id: welt.stufeAId,
        name: "Stufe A",
        kuerzel: "A",
        logoUrl: null,
      },
      {
        id: welt.stufeBId,
        name: "Stufe B",
        kuerzel: "B",
        logoUrl: null,
      },
    ]);
    expect(fuerEltern.map((s) => s.id)).not.toContain(welt.demoStufeId);
  });

  test("die Demo-Abteilung sieht nur Stufen der Demo-Abteilung", async () => {
    const demoEltern = await legePersonaAn(welt, "demoEltern");
    const ids = (await liste(demoEltern)).map((s) => s.id);
    expect(ids).toContain(welt.demoStufeId);
    expect(ids).not.toContain(welt.stufeAId);
    expect(ids).not.toContain(welt.stufeBId);
  });

  test("sortiert nach Name, ohne Feld «reihenfolge»", async () => {
    const z = randomUUID();
    await legeStufeAn(admin, { name: `Zz ${z}` });
    await legeStufeAn(admin, { name: `Aa ${z}` });
    await legeStufeAn(admin, { name: `Mm ${z}` });
    const stufen = await liste(admin);
    expect(stufen.map((s) => s.name).filter((n) => n.endsWith(z))).toEqual([
      `Aa ${z}`,
      `Mm ${z}`,
      `Zz ${z}`,
    ]);
    expect(stufen.every((s) => !("reihenfolge" in s))).toBe(true);
  });
});
