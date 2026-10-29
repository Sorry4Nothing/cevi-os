import { and, asc, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
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
let demoAdmin: PersonaKonto;
let elternA: PersonaKonto;
let slA: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, elternA, slA] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "slA"),
  ]);
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await db
    .update(schema.abteilung)
    .set({ vertrauenspersonen: null })
    .where(eq(schema.abteilung.id, welt.testabteilungId));
});

const lesen = (konto: PersonaKonto) =>
  app.request("/api/v1/hilfe", { headers: konto.headers });
const schreiben = (konto: PersonaKonto, body: unknown) =>
  app.request("/api/v1/admin/abteilung", {
    method: "PATCH",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const eintraege = () =>
  db
    .select({
      akteurId: schema.auditLog.akteurId,
      aktion: schema.auditLog.aktion,
      zielTyp: schema.auditLog.zielTyp,
      details: schema.auditLog.details,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.abteilungId, welt.testabteilungId),
        eq(schema.auditLog.aktion, "vertrauenspersonen_geaendert"),
      ),
    )
    .orderBy(asc(schema.auditLog.erstelltAm), asc(schema.auditLog.id));

test("ohne Eintrag antwortet die Route mit null, für Eltern und SL gleich", async () => {
  for (const konto of [elternA, slA, admin]) {
    const antwort = await lesen(konto);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ vertrauenspersonen: null });
  }
});

test("ein Admin setzt den Text, Eltern und SL lesen ihn", async () => {
  const text = "Platzhalter: Funktion, Erreichbarkeit";
  expect((await schreiben(admin, { vertrauenspersonen: text })).status).toBe(
    204,
  );
  for (const konto of [elternA, slA]) {
    expect(await (await lesen(konto)).json()).toEqual({
      vertrauenspersonen: text,
    });
  }
});

test("die Abteilung kommt aus der Sitzung: Die Demo-Abteilung sieht den Text nicht", async () => {
  await schreiben(admin, { vertrauenspersonen: "Nur Testabteilung" });
  expect(await (await lesen(demoAdmin)).json()).toEqual({
    vertrauenspersonen: null,
  });
  // Auch der Schreibweg trifft nur die eigene Abteilung
  await schreiben(demoAdmin, { vertrauenspersonen: "Nur Demo" });
  expect(await (await lesen(admin)).json()).toEqual({
    vertrauenspersonen: "Nur Testabteilung",
  });
});

test("Nicht-Admins bekommen 403 und ändern nichts", async () => {
  for (const konto of [elternA, slA]) {
    expect((await schreiben(konto, { vertrauenspersonen: "x" })).status).toBe(
      403,
    );
  }
  expect(await (await lesen(admin)).json()).toEqual({
    vertrauenspersonen: null,
  });
});

test("ungültige Eingaben ergeben 400: fehlendes Feld, fremdes Feld, zu lang, falscher Typ", async () => {
  for (const body of [
    {},
    { vertrauenspersonen: "x", abteilungId: welt.demoAbteilungId },
    { vertrauenspersonen: "x".repeat(2001) },
    { vertrauenspersonen: 5 },
  ]) {
    expect((await schreiben(admin, body)).status).toBe(400);
  }
});

test("Text wird getrimmt, ein leerer Text löscht den Eintrag", async () => {
  await schreiben(admin, { vertrauenspersonen: "  Platzhalter  " });
  expect(await (await lesen(elternA)).json()).toEqual({
    vertrauenspersonen: "Platzhalter",
  });
  await schreiben(admin, { vertrauenspersonen: "   " });
  expect(await (await lesen(elternA)).json()).toEqual({
    vertrauenspersonen: null,
  });
});

test("das Audit-Log nennt nur, ob der Text gesetzt ist, nie den Text; ein No-op schreibt nichts", async () => {
  const vorher = (await eintraege()).length;
  await schreiben(admin, { vertrauenspersonen: "Geheimer Platzhalter" });
  await schreiben(admin, { vertrauenspersonen: "Geheimer Platzhalter" });
  await schreiben(admin, { vertrauenspersonen: "" });
  const neu = (await eintraege()).slice(vorher);
  expect(neu).toEqual([
    {
      akteurId: admin.id,
      aktion: "vertrauenspersonen_geaendert",
      zielTyp: "abteilung",
      details: { gesetzt: true },
    },
    {
      akteurId: admin.id,
      aktion: "vertrauenspersonen_geaendert",
      zielTyp: "abteilung",
      details: { gesetzt: false },
    },
  ]);
  expect(JSON.stringify(neu)).not.toContain("Geheimer");
});
