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
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Konten über dem Handelnden verändert er nie (#777, SR-10): Konten von Entwicklern nur ein Entwickler, Konten der Abteilungsleitung nur Abteilungsleitung oder Entwickler, an jeder Route der Personen und bei der Zuordnung von Plattformrollen. Gilt unabhängig vom Recht.

bereiteAuthTestsVor();
vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

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

const PERSONEN = "/api/v1/admin/personen";
const ROLLEN = "/api/v1/admin/plattform/rollen";

let welt: Welt;
let abteilungsleitung: PersonaKonto;
let entwickler: PersonaKonto;
// Eine Rolle mit «Personen verwalten», «Profilbilder entfernen» und «Konten löschen», aber ohne Abteilungsleitung und ohne Entwickler
let verwalter: PersonaKonto;
let rolleId: string;

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

// Ein Entwickler mit zweitem Faktor, damit auch das Zurücksetzen etwas findet
async function neuerEntwickler() {
  const konto = await legePersonaMitFaktorAn(welt, "elternA");
  await db.insert(schema.plattformEntwickler).values({ userId: konto.id! });
  return konto;
}

// Eine weitere Person der Abteilungsleitung (die Persona hat den zweiten Faktor schon)
const neueAbteilungsleitung = () => legePersonaAn(welt, "admin");

const ROUTEN = [
  ["Startpasswort", "POST", "/startpasswort", undefined, 200],
  ["Deaktivieren", "POST", "/deaktivieren", undefined, 204],
  ["Aktivieren", "POST", "/aktivieren", undefined, 200],
  [
    "Zweiten Faktor zurücksetzen",
    "POST",
    "/zweiter-faktor-zuruecksetzen",
    undefined,
    204,
  ],
  ["Ändern", "PATCH", "", { name: "Neuer Name" }, 204],
  ["Profilbild entfernen", "DELETE", "/bild", undefined, 204],
  ["Löschen", "DELETE", "", undefined, 204],
] as const;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [abteilungsleitung, entwickler, verwalter] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "elternB"),
    legePersonaMitFaktorAn(welt, "slB"),
  ]);
  await db
    .insert(schema.plattformEntwickler)
    .values({ userId: entwickler.id! });
  const [rolle] = await db
    .insert(schema.plattformRolle)
    .values({ abteilungId: welt.testabteilungId, name: "Verwalter" })
    .returning({ id: schema.plattformRolle.id });
  rolleId = rolle!.id;
  await db
    .insert(schema.plattformRolleRecht)
    .values(
      ["personen.verwalten", "profilbild.entfernen", "konto.loeschen"].map(
        (recht) => ({ rolleId, recht }),
      ),
    );
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: verwalter.id!, rolleId });
});

describe.each(ROUTEN)("%s", (_name, methode, pfad, body, erfolg) => {
  const ziel = (z: PersonaKonto) => `${PERSONEN}/${z.id}${pfad}`;

  test("die Abteilungsleitung an einem Entwickler: 403 KONTO_GESCHUETZT, nichts geändert", async () => {
    const dev = await neuerEntwickler();
    const a = await anfrage(abteilungsleitung, methode, ziel(dev), body);
    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({ code: "KONTO_GESCHUETZT" });
    const [zeile] = await db
      .select({ deaktiviert: schema.user.deaktiviertAm })
      .from(schema.user)
      .where(eq(schema.user.id, dev.id!));
    expect(zeile?.deaktiviert).toBeNull();
  });

  test("eine Rolle mit dem Recht an einem Entwickler: 403 KONTO_GESCHUETZT", async () => {
    const dev = await neuerEntwickler();
    const a = await anfrage(verwalter, methode, ziel(dev), body);
    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({ code: "KONTO_GESCHUETZT" });
  });

  test("eine Rolle mit dem Recht an der Abteilungsleitung: 403 KONTO_GESCHUETZT", async () => {
    const al = await neueAbteilungsleitung();
    const a = await anfrage(verwalter, methode, ziel(al), body);
    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({ code: "KONTO_GESCHUETZT" });
  });

  test("ein Entwickler an einem Entwickler: erlaubt", async () => {
    const dev = await neuerEntwickler();
    const a = await anfrage(entwickler, methode, ziel(dev), body);
    expect(a.status).toBe(erfolg);
  });

  test("die Abteilungsleitung an einer anderen Abteilungsleitung: erlaubt", async () => {
    const al = await neueAbteilungsleitung();
    const a = await anfrage(abteilungsleitung, methode, ziel(al), body);
    expect(a.status).toBe(erfolg);
  });
});

describe("Plattformrollen zuordnen", () => {
  const pfad = (z: PersonaKonto) => `${ROLLEN}/${rolleId}/personen/${z.id}`;

  test("die Abteilungsleitung ordnet einem Entwickler nichts zu und entzieht nichts: 403 KONTO_GESCHUETZT", async () => {
    const dev = await neuerEntwickler();
    for (const methode of ["PUT", "DELETE"]) {
      const a = await anfrage(abteilungsleitung, methode, pfad(dev));
      expect(a.status).toBe(403);
      expect(await a.json()).toMatchObject({ code: "KONTO_GESCHUETZT" });
    }
  });

  test("ein Entwickler ordnet einem Entwickler zu und entzieht wieder", async () => {
    const dev = await neuerEntwickler();
    expect((await anfrage(entwickler, "PUT", pfad(dev))).status).toBe(204);
    expect((await anfrage(entwickler, "DELETE", pfad(dev))).status).toBe(204);
  });

  test("die Abteilungsleitung ordnet einer gewöhnlichen Person zu", async () => {
    const person = await legePersonaAn(welt, "leitendeA");
    expect((await anfrage(abteilungsleitung, "PUT", pfad(person))).status).toBe(
      204,
    );
  });
});
