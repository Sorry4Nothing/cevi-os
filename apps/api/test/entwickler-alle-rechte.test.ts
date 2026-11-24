// Die Antworten sind JSON, die der Test Feld für Feld liest: «any» statt eines Typs je Antwort
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Der Entwickler hat jedes Recht, auch an Personen-, Kinder- und Lagerdaten (Entscheid vom 24.11.2026, #722). Jede Zeile hier ist ein Fall, der vorher 403 war. Der zweite Faktor bleibt Pflicht; wer kein Entwickler ist, behält, was er hatte.

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
let entwickler: PersonaKonto;
let entwicklerOhneFaktor: PersonaKonto;
let keinEntwickler: PersonaKonto;
let abteilungsleitung: PersonaKonto;
let abteilungsleitungZwei: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  // Der Entwickler ist eine Person ohne jede Rolle: Alles, was er darf, kommt aus der Rolle «Entwickler»
  [entwicklerOhneFaktor, abteilungsleitung, abteilungsleitungZwei] =
    await Promise.all([
      legePersonaAn(welt, "leitendeB"),
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "adminOhneZweitenFaktor"),
    ]);
  [entwickler, keinEntwickler] = await Promise.all([
    legePersonaMitFaktorAn(welt, "elternA"),
    legePersonaMitFaktorAn(welt, "slB"),
  ]);
  await db
    .insert(schema.plattformEntwickler)
    .values([{ userId: entwickler.id! }, { userId: entwicklerOhneFaktor.id! }]);
});

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
const json = async <T = any>(a: Response) => (await a.json()) as T;

const PERSONEN = "/api/v1/admin/personen";
const KINDER = "/api/v1/admin/kinder";
const LAGER = "/api/v1/admin/lager";
const neuePerson = () => ({
  vorname: "Vreni",
  nachname: "Muster",
  benutzername: `person.${randomUUID().slice(0, 8)}`,
  abteilungsleitung: false,
  rollen: [],
  elternteilVon: [],
});

describe("Personendaten", () => {
  test("er liest die Personen und legt eine an", async () => {
    expect((await anfrage(entwickler, "GET", PERSONEN)).status).toBe(200);
    const neu = await anfrage(entwickler, "POST", PERSONEN, neuePerson());
    expect(neu.status).toBe(201);
  });
});

describe("Kinderdaten", () => {
  test("er liest die Kinder, legt eines an und ändert es", async () => {
    expect((await anfrage(entwickler, "GET", KINDER)).status).toBe(200);
    const neu = await anfrage(entwickler, "POST", KINDER, {
      vorname: "Neues",
      nachname: "Kind",
      stufeId: welt.stufeAId,
    });
    expect(neu.status).toBe(201);
    const { id } = await json(neu);
    const patch = await anfrage(entwickler, "PATCH", `${KINDER}/${id}`, {
      vorname: "Geändert",
    });
    expect(patch.status).toBe(204);
  });
});

describe("Lagerdaten", () => {
  test("er liest die Lager und legt eines an", async () => {
    expect((await anfrage(entwickler, "GET", LAGER)).status).toBe(200);
    const neu = await anfrage(entwickler, "POST", LAGER, {
      titel: "Entwickler-Lager",
      von: "2027-07-10",
      bis: "2027-07-24",
    });
    expect(neu.status).toBe(201);
  });
});

describe("Konten löschen", () => {
  test("er löscht ein Konto, auch das einer Abteilungsleitung; das eigene nie", async () => {
    const angelegt = await json(
      await anfrage(entwickler, "POST", PERSONEN, neuePerson()),
    );
    expect(
      (await anfrage(entwickler, "DELETE", `${PERSONEN}/${angelegt.id}`))
        .status,
    ).toBe(204);
    // Die Abteilungsleitung ohne zweiten Faktor ist nicht die letzte: Die zweite bleibt
    expect(
      (
        await anfrage(
          entwickler,
          "DELETE",
          `${PERSONEN}/${abteilungsleitungZwei.id}`,
        )
      ).status,
    ).toBe(204);
    const eigenes = await anfrage(
      entwickler,
      "DELETE",
      `${PERSONEN}/${entwickler.id}`,
    );
    expect(eigenes.status).toBe(409);
    expect(await json(eigenes)).toMatchObject({ code: "EIGENES_KONTO" });
    const [noch] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, entwickler.id!));
    expect(noch).toBeDefined();
  });

  test("er ändert das Konto einer Abteilungsleitung (sonst nur sie selbst)", async () => {
    const antwort = await anfrage(
      entwickler,
      "PATCH",
      `${PERSONEN}/${abteilungsleitung.id}`,
      { name: "Geändert" },
    );
    expect(antwort.status).toBe(204);
  });
});

describe("Zweiter Faktor und Nicht-Entwickler", () => {
  test("ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT, auch bei Personen-, Kinder- und Lagerdaten", async () => {
    for (const pfad of [PERSONEN, KINDER, LAGER]) {
      const a = await anfrage(entwicklerOhneFaktor, "GET", pfad);
      expect(a.status, pfad).toBe(403);
      expect(await json(a), pfad).toMatchObject({
        code: "ZWEITER_FAKTOR_FEHLT",
      });
    }
  });

  test("eine Person ohne diese Rolle bekommt weiter 403", async () => {
    for (const pfad of [PERSONEN, KINDER, LAGER]) {
      const a = await anfrage(keinEntwickler, "GET", pfad);
      expect(a.status, pfad).toBe(403);
    }
  });
});
