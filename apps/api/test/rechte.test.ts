import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
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
import { hatRolle, type Person } from "../src/rechte.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

// Testrouten wie eine spätere Objekt-Route: erst der Abteilungsfilter in SQL (404), dann das Recht (403)
const app = erstelleApp({ appMinVersion: "1.2.0", sql, db, auth })
  .get("/api/v1/test/stufen/:id", async (c) => {
    const person = c.get("person");
    const [stufe] = await db
      .select({ id: schema.stufe.id })
      .from(schema.stufe)
      .where(
        and(
          eq(schema.stufe.id, c.req.param("id")),
          eq(schema.stufe.abteilungId, person.abteilungId),
        ),
      );
    if (!stufe) throw new HTTPException(404);
    if (!hatRolle(person, stufe.id, "leitung")) throw new HTTPException(403);
    return c.json({ id: stufe.id });
  })
  .get("/api/v1/test/person", (c) => c.json(c.get("person")));

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
});

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// 200 nur für Leitung oder SL der Stufe; Admins haben keine Stufenrolle (403), Demo-Personas sehen fremde Objekte nicht (404)
const ERWARTET: Record<Persona, { a: number; b: number }> = {
  admin: { a: 403, b: 403 },
  adminOhneZweitenFaktor: { a: 403, b: 403 },
  slA: { a: 200, b: 403 },
  slB: { a: 403, b: 200 },
  leitendeA: { a: 200, b: 403 },
  leitendeB: { a: 403, b: 200 },
  leitendeAElternB: { a: 200, b: 403 },
  elternA: { a: 403, b: 403 },
  elternB: { a: 403, b: 403 },
  mussPasswortAendern: { a: 403, b: 403 },
  deaktiviert: { a: 401, b: 401 },
  ohneLogin: { a: 401, b: 401 },
  demoAdmin: { a: 404, b: 404 },
  demoEltern: { a: 404, b: 404 },
};

describe("GET /api/v1/test/stufen/:id für Stufe A und B", () => {
  test.each(PERSONAS)("%s", async (persona) => {
    const { headers } = konten[persona];
    const [a, b] = await Promise.all([
      app.request(`/api/v1/test/stufen/${welt.stufeAId}`, { headers }),
      app.request(`/api/v1/test/stufen/${welt.stufeBId}`, { headers }),
    ]);
    expect({ a: a.status, b: b.status }).toEqual(ERWARTET[persona]);
  });

  test("401, 403 und 404 im einheitlichen Fehlerformat", async () => {
    const faelle = [
      [
        konten.ohneLogin,
        { code: "NICHT_ANGEMELDET", message: "Nicht angemeldet" },
      ],
      [
        konten.elternA,
        { code: "KEINE_BERECHTIGUNG", message: "Keine Berechtigung" },
      ],
      [
        konten.demoEltern,
        { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" },
      ],
    ] as const;
    for (const [konto, body] of faelle) {
      const res = await app.request(`/api/v1/test/stufen/${welt.stufeAId}`, {
        headers: konto.headers,
      });
      expect(await res.json()).toEqual(body);
    }
  });
});

describe("person aus der Sitzung", () => {
  test("slA: id, Abteilung, admin und Rollen wie angelegt", async () => {
    const konto = konten.slA;
    const res = await app.request("/api/v1/test/person", {
      headers: konto.headers,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: konto.id,
      abteilungId: welt.testabteilungId,
      admin: false,
      rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }],
    });
  });

  test("eine Rolle in einer Stufe der fremden Abteilung fehlt in den Rollen", async () => {
    // Eigene Persona: Die Datei teilt sich eine Welt, die Zeile bliebe sonst stehen
    const konto = await legePersonaAn(welt, "slA");
    await db.insert(schema.rolle).values({
      userId: konto.id as string,
      stufeId: welt.demoStufeId,
      typ: "stufenleitung",
    });
    const res = await app.request("/api/v1/test/person", {
      headers: konto.headers,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Person).rollen).toEqual([
      { stufeId: welt.stufeAId, typ: "stufenleitung" },
    ]);
  });

  test("banned mit noch bestehender Sitzung: 401", async () => {
    const konto = await legePersonaAn(welt, "elternA");
    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.id, konto.id as string));
    const res = await app.request("/api/v1/test/person", {
      headers: konto.headers,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "NICHT_ANGEMELDET",
      message: "Nicht angemeldet",
    });
  });
});

describe("hatRolle", () => {
  const person: Person = {
    id: "person-1",
    abteilungId: "abteilung-1",
    admin: false,
    rollen: [
      { stufeId: "a", typ: "leitung" },
      { stufeId: "b", typ: "stufenleitung" },
    ],
  };
  test.each([
    ["a", "leitung", true],
    ["a", "stufenleitung", false],
    ["b", "leitung", true],
    ["b", "stufenleitung", true],
    ["c", "leitung", false],
    ["c", "stufenleitung", false],
  ] as const)("Stufe %s, verlangt %s: %s", (stufeId, typ, erwartet) => {
    expect(hatRolle(person, stufeId, typ)).toBe(erwartet);
  });
});
