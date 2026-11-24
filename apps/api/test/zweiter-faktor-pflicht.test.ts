import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  bereiteAuthTestsVor,
  cookiesAus,
  erstelleTestAuth,
  zufallsIp,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import { webmasterRolle as holeWebmasterRolle } from "./hilfen/webmaster.js";
import {
  erstelleWelt,
  legePersonaAn,
  schalteZweitenFaktorEin,
  totpCode,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Zweiter Faktor in der Verwaltung (#715): Einrichten für jedes Konto ausser dem eines Kindes; Rechtewechsel beenden die Sitzungen nur dort, wo der Faktor Pflicht wird und fehlt.
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
let admin: PersonaKonto;
let webmasterRolle: string;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  // Je Abteilung: Die Rolle einer anderen Testdatei im selben Lauf wäre die falsche
  webmasterRolle = await holeWebmasterRolle(db, welt.testabteilungId);
});

const anfrage = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: object,
) =>
  app.request(pfad, {
    method: methode,
    headers: {
      ...konto.headers,
      "x-forwarded-for": zufallsIp(),
      ...(body && { "content-type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });

const sitzungen = async (userId: string) =>
  (
    await db
      .select({ n: count() })
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
  )[0].n;

const neu = (persona: Persona) => legePersonaAn(welt, persona);

// Einrichten wie die Verwaltung: enable, dann der erste Code
async function richteEin(konto: PersonaKonto) {
  const einrichten = await anfrage(
    konto,
    "POST",
    "/api/auth/two-factor/enable",
    { password: konto.passwort },
  );
  expect(einrichten.status).toBe(200);
  const bestaetigt = await anfrage(
    konto,
    "POST",
    "/api/auth/two-factor/verify-totp",
    { code: await totpCode(welt, konto.id!) },
  );
  expect(bestaetigt.status).toBe(200);
  return {
    ...konto,
    headers: { ...konto.headers, cookie: cookiesAus(bestaetigt) },
  };
}

const zweiterFaktorAn = async (userId: string) =>
  (
    await db
      .select({ an: schema.user.twoFactorEnabled })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
  )[0].an === true;

describe("Einrichten für jedes Konto ausser dem eines Kindes", () => {
  test.each<Persona>(["elternA", "slA", "leitendeA"])(
    "%s richtet ihn ein: enable, verify-totp, twoFactorEnabled",
    async (persona) => {
      const konto = await neu(persona);
      expect(await zweiterFaktorAn(konto.id!)).toBe(false);
      await richteEin(konto);
      expect(await zweiterFaktorAn(konto.id!)).toBe(true);
    },
  );

  test("bis zum ersten Code gilt der Faktor nicht", async () => {
    const konto = await neu("elternA");
    const einrichten = await anfrage(
      konto,
      "POST",
      "/api/auth/two-factor/enable",
      { password: konto.passwort },
    );
    expect(einrichten.status).toBe(200);
    expect(await zweiterFaktorAn(konto.id!)).toBe(false);
    const falsch = await anfrage(
      konto,
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: "000000" },
    );
    expect(falsch.status).toBe(401);
    expect(await zweiterFaktorAn(konto.id!)).toBe(false);
  });

  test("das eigene Konto eines Kindes bekommt 404, es entsteht nichts", async () => {
    const konto = await neu("elternA");
    await db
      .update(schema.kind)
      .set({ userId: konto.id! })
      .where(eq(schema.kind.id, welt.kindAId));
    const antwort = await anfrage(
      konto,
      "POST",
      "/api/auth/two-factor/enable",
      { password: konto.passwort },
    );
    expect(antwort.status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.twoFactor)
        .where(eq(schema.twoFactor.userId, konto.id!)),
    ).toEqual([]);
    // Das Elternkonto desselben Kindes ist nicht das Konto des Kindes
    const eltern = await neu("elternA");
    await db
      .insert(schema.kindEltern)
      .values({ kindId: welt.kindAId, userId: eltern.id! })
      .onConflictDoNothing();
    expect(
      (
        await anfrage(eltern, "POST", "/api/auth/two-factor/enable", {
          password: eltern.passwort,
        })
      ).status,
    ).toBe(200);
  });
});

describe("Pflicht, aber nicht eingerichtet: die Verwaltung sagt es mit dem Code", () => {
  test("eine Person mit Webmaster-Rolle ohne Faktor: 403 ZWEITER_FAKTOR_FEHLT; nach dem Einrichten 200", async () => {
    const konto = await neu("elternA");
    await db
      .insert(schema.personPlattformRolle)
      .values({ userId: konto.id!, rolleId: webmasterRolle });
    const vorher = await anfrage(konto, "GET", "/api/v1/redaktion/ich");
    expect(vorher.status).toBe(403);
    expect(await vorher.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    const mit = await richteEin(konto);
    expect((await anfrage(mit, "GET", "/api/v1/redaktion/ich")).status).toBe(
      200,
    );
  });

  test("die Website und die eigenen Daten brauchen ihn nie", async () => {
    const konto = await neu("elternA");
    await db
      .insert(schema.personPlattformRolle)
      .values({ userId: konto.id!, rolleId: webmasterRolle });
    expect((await anfrage(konto, "GET", "/api/v1/ich")).status).toBe(200);
  });
});

describe("Rechtewechsel beendet Sitzungen nur, wenn der Faktor Pflicht wird und fehlt", () => {
  const zuweisen = (konto: PersonaKonto, rolleId = webmasterRolle) =>
    anfrage(
      admin,
      "PUT",
      `/api/v1/admin/plattform/rollen/${rolleId}/personen/${konto.id}`,
    );

  test("Rolle mit Rechten zuweisen: ohne Faktor Sitzungen weg, mit Faktor bleiben sie", async () => {
    const ohne = await neu("elternA");
    const mit = await schalteZweitenFaktorEin(welt, await neu("elternA"));
    expect(await sitzungen(ohne.id!)).toBeGreaterThan(0);
    expect((await zuweisen(ohne)).status).toBe(204);
    expect((await zuweisen(mit)).status).toBe(204);
    expect(await sitzungen(ohne.id!)).toBe(0);
    expect(await sitzungen(mit.id!)).toBeGreaterThan(0);
    // Das alte Cookie gilt nicht mehr; eine neue Anmeldung geht ohne Code und sieht ZWEITER_FAKTOR_FEHLT
    expect((await anfrage(ohne, "GET", "/api/v1/ich")).status).toBe(401);
    const anmeldung = await app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        ...ohne.headers,
        cookie: "",
        "content-type": "application/json",
        "x-forwarded-for": zufallsIp(),
      },
      body: JSON.stringify({
        username: ohne.benutzername,
        password: ohne.passwort,
      }),
    });
    expect(anmeldung.status).toBe(200);
    const neuHeaders = { ...ohne.headers, cookie: cookiesAus(anmeldung) };
    const redaktion = await anfrage(
      { ...ohne, headers: neuHeaders },
      "GET",
      "/api/v1/redaktion/ich",
    );
    expect(redaktion.status).toBe(403);
    expect((await redaktion.json()).code).toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("Rolle ohne Rechte: niemand wird abgemeldet; kommt ein Recht dazu, trifft es nur die ohne Faktor", async () => {
    const angelegt = await anfrage(
      admin,
      "POST",
      "/api/v1/admin/plattform/rollen",
      {
        name: `Leer ${randomUUID().slice(0, 8)}`,
        rechte: [],
      },
    );
    expect(angelegt.status).toBe(201);
    const { id: rolleId } = (await angelegt.json()) as { id: string };
    const ohne = await neu("elternA");
    const mit = await schalteZweitenFaktorEin(welt, await neu("elternA"));
    expect((await zuweisen(ohne, rolleId)).status).toBe(204);
    expect((await zuweisen(mit, rolleId)).status).toBe(204);
    expect(await sitzungen(ohne.id!)).toBeGreaterThan(0);
    expect(await sitzungen(mit.id!)).toBeGreaterThan(0);

    const aendern = await anfrage(
      admin,
      "PATCH",
      `/api/v1/admin/plattform/rollen/${rolleId}`,
      { rechte: ["medien.verwalten"] },
    );
    expect(aendern.status).toBe(204);
    expect(await sitzungen(ohne.id!)).toBe(0);
    expect(await sitzungen(mit.id!)).toBeGreaterThan(0);
  });

  test("Person zur Abteilungsleitung machen: ohne Faktor abgemeldet; Entzug meldet niemanden ab", async () => {
    const ohne = await neu("elternA");
    const mit = await schalteZweitenFaktorEin(welt, await neu("elternA"));
    for (const konto of [ohne, mit]) {
      const antwort = await anfrage(
        admin,
        "PATCH",
        `/api/v1/admin/personen/${konto.id}`,
        { abteilungsleitung: true },
      );
      expect(antwort.status).toBe(204);
    }
    expect(await sitzungen(ohne.id!)).toBe(0);
    expect(await sitzungen(mit.id!)).toBeGreaterThan(0);

    const weg = await neu("elternA");
    expect(
      (
        await anfrage(admin, "PATCH", `/api/v1/admin/personen/${weg.id}`, {
          abteilungsleitung: false,
        })
      ).status,
    ).toBe(204);
    expect(await sitzungen(weg.id!)).toBeGreaterThan(0);
  });

  test("Stufenleitung ohne Faktor bleibt angemeldet: Die Arbeit an der eigenen Stufe braucht ihn nicht", async () => {
    const konto = await neu("elternA");
    const antwort = await anfrage(
      admin,
      "PATCH",
      `/api/v1/admin/personen/${konto.id}`,
      { rollen: [{ stufeId: welt.stufeAId, typ: "stufenleitung" }] },
    );
    expect(antwort.status).toBe(204);
    expect(await sitzungen(konto.id!)).toBeGreaterThan(0);
  });

  test("ein Name ändern oder die Eltern eintragen meldet niemanden ab", async () => {
    const konto = await neu("elternA");
    expect(
      (
        await anfrage(admin, "PATCH", `/api/v1/admin/personen/${konto.id}`, {
          name: "Neuer Name",
        })
      ).status,
    ).toBe(204);
    expect(await sitzungen(konto.id!)).toBeGreaterThan(0);
  });
});
