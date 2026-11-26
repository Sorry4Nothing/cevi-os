import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql as roh } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { loescheAlteIdempotenz } from "../src/idempotenz.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

// Idempotenz-Schlüssel der Direktanlagen (#873): das Verhalten am privaten To-do, die Verdrahtung an allen sechs Routen
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
let leitung: PersonaKonto;
let andere: PersonaKonto;
let lagerId: string;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  leitung = await legePersonaAn(welt, "elternB");
  andere = await legePersonaAn(welt, "slB");
  const [lager] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Idempotenz-Lager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status: "aktiv",
    })
    .returning({ id: schema.lager.id });
  lagerId = lager!.id;
  await db.insert(schema.lagerMitglied).values([
    { lagerId, personId: leitung.id!, rolle: "lagerleitung" },
    { lagerId, personId: andere.id!, rolle: "leitung" },
  ]);
});

async function sende(
  konto: PersonaKonto,
  pfad: string,
  body: unknown,
  schluessel?: string,
) {
  const res = await app.request(pfad, {
    method: "POST",
    headers: {
      ...konto.headers,
      "content-type": "application/json",
      ...(schluessel ? { "Idempotency-Key": schluessel } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
}
const todos = () => `/api/v1/lager/${lagerId}/todos`;
const zahl = async (konto: PersonaKonto, text: string) =>
  (
    await db
      .select()
      .from(schema.todoPrivat)
      .where(
        and(
          eq(schema.todoPrivat.personId, konto.id!),
          eq(schema.todoPrivat.text, text),
        ),
      )
  ).length;

describe("Idempotency-Key am privaten To-do", () => {
  test("Wiederholung gibt dieselbe Antwort und legt nicht doppelt an", async () => {
    const k = randomUUID();
    const erste = await sende(leitung, todos(), { text: "Zelt" }, k);
    const zweite = await sende(leitung, todos(), { text: "Zelt" }, k);
    expect(erste.status).toBe(201);
    expect(zweite).toEqual(erste);
    expect(await zahl(leitung, "Zelt")).toBe(1);
  });

  test("gleicher Schlüssel mit anderem Körper ist 422 IDEMPOTENZ_KONFLIKT", async () => {
    const k = "schluessel_mit_text_1";
    expect((await sende(leitung, todos(), { text: "A" }, k)).status).toBe(201);
    const konflikt = await sende(leitung, todos(), { text: "B" }, k);
    expect(konflikt.status).toBe(422);
    expect(konflikt.body.code).toBe("IDEMPOTENZ_KONFLIKT");
    expect(await zahl(leitung, "B")).toBe(0);
  });

  test("eine andere Person mit demselben Schlüssel ist unabhängig", async () => {
    const k = randomUUID();
    const eins = await sende(leitung, todos(), { text: "Plane" }, k);
    const zwei = await sende(andere, todos(), { text: "Plane" }, k);
    expect(zwei.status).toBe(201);
    expect(zwei.body.id).not.toBe(eins.body.id);
    expect(await zahl(andere, "Plane")).toBe(1);
  });

  test("ohne Kopf legt jeder Aufruf an, wie bisher", async () => {
    await sende(leitung, todos(), { text: "Seil" });
    await sende(leitung, todos(), { text: "Seil" });
    expect(await zahl(leitung, "Seil")).toBe(2);
  });

  test("ungültiger Schlüssel ist 400 und legt nichts an", async () => {
    const r = await sende(leitung, todos(), { text: "Kurz" }, "zu-kurz");
    expect(r.status).toBe(400);
    expect(await zahl(leitung, "Kurz")).toBe(0);
  });

  test("eine Antwort ausserhalb 2xx bleibt nicht stehen", async () => {
    const k = randomUUID();
    expect((await sende(leitung, todos(), { text: "" }, k)).status).toBe(400);
    // Derselbe Schlüssel mit gültigem Körper ist kein Konflikt: Der Anspruch fiel weg
    expect((await sende(leitung, todos(), { text: "Leer" }, k)).status).toBe(
      201,
    );
  });

  test("solange die erste Anfrage läuft, ist eine Wiederholung 409 IN_BEARBEITUNG", async () => {
    const k = randomUUID();
    const body = { text: "Laufend" };
    await db.insert(schema.idempotenz).values({
      personId: leitung.id!,
      route: `POST ${todos()}`,
      schluessel: k,
      hash: hashVon(body),
    });
    const r = await sende(leitung, todos(), body, k);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("IN_BEARBEITUNG");
    expect(await zahl(leitung, "Laufend")).toBe(0);
  });

  test("nach 24 Stunden gilt der Schlüssel als neu, der tägliche Lauf löscht ihn", async () => {
    const k = randomUUID();
    await sende(leitung, todos(), { text: "Alt" }, k);
    const wo = and(
      eq(schema.idempotenz.personId, leitung.id!),
      eq(schema.idempotenz.schluessel, k),
    );
    await db
      .update(schema.idempotenz)
      .set({ erstelltAm: roh`now() - interval '25 hours'` })
      .where(wo);
    expect((await sende(leitung, todos(), { text: "Alt" }, k)).status).toBe(
      201,
    );
    expect(await zahl(leitung, "Alt")).toBe(2);
    await db
      .update(schema.idempotenz)
      .set({ erstelltAm: roh`now() - interval '25 hours'` })
      .where(wo);
    expect(await loescheAlteIdempotenz(db)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(schema.idempotenz).where(wo)).toEqual([]);
  });
});

const hashVon = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");

// Jede der sechs Routen hängt am Mechanismus: Ein laufender Anspruch für Pfad und Körper ergibt 409 IN_BEARBEITUNG, bevor die Route etwas tut
describe("Verdrahtung an allen Routen", () => {
  const body = { egal: true };
  test.each([
    () => `/api/v1/lager/${lagerId}/hoecks`,
    () => `/api/v1/lager/${lagerId}/pinnwand`,
    () => `/api/v1/lager/${lagerId}/todos`,
    () => `/api/v1/lager/${lagerId}/check/punkte`,
    () => `/api/v1/raeume/anfragen/${randomUUID()}/entscheid`,
    () => `/api/v1/laden/bestellungen`,
  ])("%#", async (pfad) => {
    const p = pfad();
    const k = randomUUID();
    await db.insert(schema.idempotenz).values({
      personId: leitung.id!,
      route: `POST ${p}`,
      schluessel: k,
      hash: hashVon(body),
    });
    const r = await sende(leitung, p, body, k);
    expect(r.status, p).toBe(409);
    expect(r.body.code, p).toBe("IN_BEARBEITUNG");
  });
});
