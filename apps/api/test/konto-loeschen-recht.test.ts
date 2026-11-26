// Die Antworten sind JSON, die der Test Feld für Feld liest: «any» statt eines Typs je Antwort
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// «Konten löschen» ist ein verteilbares Recht (#771, Entscheid vom 24.11.2026): Eine Plattformrolle mit dem Recht darf löschen, mit zweitem Faktor, auch ohne «Personen verwalten». Geschützt bleibt, wer über dem Löschenden steht (KONTO_GESCHUETZT), und das eigene Konto.

bereiteAuthTestsVor();
vi.setConfig({ hookTimeout: 120_000 });

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
let abteilungsleitung: PersonaKonto;
let zweiteAbteilungsleitung: PersonaKonto;
let entwickler: PersonaKonto;
let zweiterEntwickler: PersonaKonto;
let mitRecht: PersonaKonto;
let mitRechtOhneFaktor: PersonaKonto;
let ohneRecht: PersonaKonto;
let rolleMitRecht: string;

const PERSONEN = "/api/v1/admin/personen";
const json = async <T = any>(a: Response) => (await a.json()) as T;
function anfrage(konto: PersonaKonto, methode: string, pfad: string) {
  return app.request(pfad, { method: methode, headers: konto.headers });
}
const loesche = (aktor: PersonaKonto, zielId: string) =>
  anfrage(aktor, "DELETE", `${PERSONEN}/${zielId}`);

// Eine Person ohne Rechte, die sich löschen lässt
async function neuePerson(): Promise<string> {
  const a = await app.request(PERSONEN, {
    method: "POST",
    headers: {
      ...abteilungsleitung.headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      vorname: "Vreni",
      nachname: "Muster",
      geschlecht: "w",
      benutzername: `person.${randomUUID().slice(0, 8)}`,
      abteilungsleitung: false,
      rollen: [],
      elternteilVon: [],
    }),
  });
  expect(a.status).toBe(201);
  return (await json(a)).id;
}
const existiert = async (id: string) =>
  (
    await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, id))
  ).length === 1;

async function gibRolle(konto: PersonaKonto, rolleId: string) {
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: konto.id!, rolleId });
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const mitFaktor = (persona: Persona) => legePersonaMitFaktorAn(welt, persona);
  [
    abteilungsleitung,
    zweiteAbteilungsleitung,
    entwickler,
    zweiterEntwickler,
    mitRecht,
    ohneRecht,
  ] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "adminOhneZweitenFaktor"),
    mitFaktor("elternA"),
    legePersonaAn(welt, "elternB"),
    mitFaktor("slB"),
    mitFaktor("leitendeA"),
  ]);
  mitRechtOhneFaktor = await legePersonaAn(welt, "leitendeB");
  await db
    .insert(schema.plattformEntwickler)
    .values([{ userId: entwickler.id! }, { userId: zweiterEntwickler.id! }]);
  const rolle = async (name: string, recht: string) => {
    const [r] = await db
      .insert(schema.plattformRolle)
      .values({ abteilungId: welt.testabteilungId, name })
      .returning({ id: schema.plattformRolle.id });
    await db
      .insert(schema.plattformRolleRecht)
      .values({ rolleId: r!.id, recht });
    return r!.id;
  };
  rolleMitRecht = await rolle("Datenschutz", "konto.loeschen");
  const fremdeRolle = await rolle("Lädeli", "laden.ansehen");
  await gibRolle(mitRecht, rolleMitRecht);
  await gibRolle(mitRechtOhneFaktor, rolleMitRecht);
  await gibRolle(ohneRecht, fremdeRolle);
});

describe("Eine Rolle mit dem Recht", () => {
  test("löscht ein Konto, auch ohne «Personen verwalten»", async () => {
    // Die Rolle gibt nur dieses Recht: Die Personenliste bleibt 403
    expect((await anfrage(mitRecht, "GET", PERSONEN)).status).toBe(403);
    const id = await neuePerson();
    expect((await loesche(mitRecht, id)).status).toBe(204);
    expect(await existiert(id)).toBe(false);
  });

  test("ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT, das Konto bleibt", async () => {
    const id = await neuePerson();
    const a = await loesche(mitRechtOhneFaktor, id);
    expect(a.status).toBe(403);
    expect(await json(a)).toMatchObject({ code: "ZWEITER_FAKTOR_FEHLT" });
    expect(await existiert(id)).toBe(true);
  });

  test("das eigene Konto nie: 409 EIGENES_KONTO", async () => {
    const a = await loesche(mitRecht, mitRecht.id!);
    expect(a.status).toBe(409);
    expect(await json(a)).toMatchObject({ code: "EIGENES_KONTO" });
    expect(await existiert(mitRecht.id!)).toBe(true);
  });

  test("Konten von Entwicklern löscht nur ein Entwickler: 403 KONTO_GESCHUETZT", async () => {
    const a = await loesche(mitRecht, zweiterEntwickler.id!);
    expect(a.status).toBe(403);
    expect(await json(a)).toMatchObject({ code: "KONTO_GESCHUETZT" });
    expect(await existiert(zweiterEntwickler.id!)).toBe(true);
  });

  test("Konten der Abteilungsleitung löscht nur Abteilungsleitung oder Entwickler: 403 KONTO_GESCHUETZT", async () => {
    const a = await loesche(mitRecht, zweiteAbteilungsleitung.id!);
    expect(a.status).toBe(403);
    expect(await json(a)).toMatchObject({ code: "KONTO_GESCHUETZT" });
    expect(await existiert(zweiteAbteilungsleitung.id!)).toBe(true);
  });

  test("ein Konto einer anderen Abteilung ist 404", async () => {
    const fremd = await legePersonaAn(welt, "demoEltern");
    const id = fremd.id!;
    expect((await loesche(mitRecht, id)).status).toBe(404);
  });

  test("verliert die Rolle das Recht, ist die nächste Löschung 403", async () => {
    const id = await neuePerson();
    await db
      .delete(schema.plattformRolleRecht)
      .where(eq(schema.plattformRolleRecht.rolleId, rolleMitRecht));
    try {
      expect((await loesche(mitRecht, id)).status).toBe(403);
      expect(await existiert(id)).toBe(true);
    } finally {
      await db
        .insert(schema.plattformRolleRecht)
        .values({ rolleId: rolleMitRecht, recht: "konto.loeschen" });
    }
    expect((await loesche(mitRecht, id)).status).toBe(204);
  });
});

describe("Rechte-Editor: Recht geben und entziehen", () => {
  test("die Abteilungsleitung legt eine Rolle mit dem Recht an, ordnet sie zu und nimmt sie wieder weg", async () => {
    const person = await legePersonaMitFaktorAn(welt, "leitendeAElternB");
    const rolle = await app.request("/api/v1/admin/rechte/rollen", {
      method: "POST",
      headers: {
        ...abteilungsleitung.headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: `Löschen ${randomUUID().slice(0, 6)}`,
        rechte: ["konto.loeschen"],
      }),
    });
    expect(rolle.status).toBe(201);
    const { id } = await json<{ id: string }>(rolle);
    const zuordnung = `/api/v1/admin/plattform/rollen/${id}/personen/${person.id}`;
    // Ohne Rolle: 403
    const ziel = await neuePerson();
    expect((await loesche(person, ziel)).status).toBe(403);
    expect((await anfrage(abteilungsleitung, "PUT", zuordnung)).ok).toBe(true);
    expect((await loesche(person, ziel)).status).toBe(204);
    // Entzogen: wieder 403
    const zweites = await neuePerson();
    expect((await anfrage(abteilungsleitung, "DELETE", zuordnung)).ok).toBe(
      true,
    );
    expect((await loesche(person, zweites)).status).toBe(403);
    expect(await existiert(zweites)).toBe(true);
  });
});

describe("Eine Rolle ohne das Recht", () => {
  test("403, das Konto bleibt", async () => {
    const id = await neuePerson();
    expect((await loesche(ohneRecht, id)).status).toBe(403);
    expect(await existiert(id)).toBe(true);
  });
});

describe("Abteilungsleitung und Entwickler", () => {
  test("die Abteilungsleitung hat das Recht von Haus aus und löscht auch eine andere Abteilungsleitung", async () => {
    const id = await neuePerson();
    expect((await loesche(abteilungsleitung, id)).status).toBe(204);
  });

  test("die Abteilungsleitung löscht keinen Entwickler: 403 KONTO_GESCHUETZT", async () => {
    const a = await loesche(abteilungsleitung, zweiterEntwickler.id!);
    expect(a.status).toBe(403);
    expect(await json(a)).toMatchObject({ code: "KONTO_GESCHUETZT" });
  });

  test("nimmt der Entwickler der Abteilungsleitung das Recht, ist sie 403; er selbst darf weiter", async () => {
    await db.insert(schema.abteilungsleitungRecht).values({
      abteilungId: welt.testabteilungId,
      ohne: ["konto.loeschen"],
      version: 2,
    });
    try {
      const id = await neuePerson();
      expect((await loesche(abteilungsleitung, id)).status).toBe(403);
      expect((await loesche(entwickler, id)).status).toBe(204);
    } finally {
      await db
        .delete(schema.abteilungsleitungRecht)
        .where(
          eq(schema.abteilungsleitungRecht.abteilungId, welt.testabteilungId),
        );
    }
  });

  test("ein Entwickler löscht auch einen Entwickler und eine Abteilungsleitung", async () => {
    expect((await loesche(entwickler, zweiterEntwickler.id!)).status).toBe(204);
    expect(
      (await loesche(entwickler, zweiteAbteilungsleitung.id!)).status,
    ).toBe(204);
  });
});
