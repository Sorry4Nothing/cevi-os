import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import {
  darf,
  ladeLagerZugriff,
  lagerZugriff,
  type LagerEnv,
} from "../../src/lager/policy.js";
import type { LagerRecht, LagerRolle } from "../../src/lager/rechte-katalog.js";
import type { Person } from "../../src/rechte.js";
import { API_URL } from "../hilfen/datenbank.js";

// Die Policy-Schicht für sich: eine Mini-App mit Routen, wie spätere Module sie bauen, und Personen ohne Anmeldung (die Sitzung prüft rechte.ts, die Anbindung die Matrix)
const sql = postgres(API_URL);
const db = erstelleDb(sql);
afterAll(() => sql.end());

let abteilungId: string;
let fremdeAbteilungId: string;
const personen: Record<string, Person> = {};
const lagerOf: Record<string, string> = {};

const konto = async (name: string, abteilung: string, admin = false) => {
  const [zeile] = await db
    .insert(schema.user)
    .values({
      name,
      email: `${randomUUID()}@example.org`,
      username: `policy.${randomUUID().slice(0, 8)}`,
      abteilungId: abteilung,
      mussPasswortAendern: false,
    })
    .returning({ id: schema.user.id });
  personen[name] = {
    id: zeile.id,
    abteilungId: abteilung,
    admin,
    zweiterFaktor: admin,
    rollen: [],
  };
};
const mitglied = (lager: string, name: string, rolle: LagerRolle) =>
  db
    .insert(schema.lagerMitglied)
    .values({ lagerId: lagerOf[lager], personId: personen[name].id, rolle });

const app = new Hono<LagerEnv>()
  // Statt personAusSitzung: Die Person kommt aus einer Kopfzeile des Tests
  .use(async (c, next) => {
    c.set("person", personen[c.req.header("x-person") ?? ""]);
    await next();
  })
  .get("/:id/lesen", lagerZugriff(db, { recht: "aufgaben.lesen_alle" }), (c) =>
    c.json({ rolle: c.get("lager").rolle, mitglied: c.get("lager").mitglied }),
  )
  .get("/:id/offen", lagerZugriff(db), (c) => c.json({ ok: true }))
  .post(
    "/:id/schreiben",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten" }),
    (c) => c.body(null, 204),
  )
  .post(
    "/:id/schluss",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten", auchGeschlossen: true }),
    (c) => c.body(null, 204),
  );

const rufe = (person: string, methode: string, pfad: string) =>
  app.request(pfad, { method: methode, headers: { "x-person": person } });

async function legeLager(
  name: string,
  status: "aktiv" | "abgeschlossen" | "archiviert",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: name,
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  lagerOf[name] = zeile.id;
}

beforeAll(async () => {
  [abteilungId, fremdeAbteilungId] = (
    await db
      .insert(schema.abteilung)
      .values([{ name: "Policy A" }, { name: "Policy B" }])
      .returning({ id: schema.abteilung.id })
  ).map((z) => z.id);
  await Promise.all([
    konto("lagerleitung", abteilungId),
    konto("leitung", abteilungId),
    konto("team", abteilungId),
    konto("lesen", abteilungId),
    konto("ohne", abteilungId),
    konto("admin", abteilungId, true),
    konto("adminAlsLesen", abteilungId, true),
    konto("fremd", fremdeAbteilungId),
    konto("fremdAdmin", fremdeAbteilungId, true),
  ]);
  await legeLager("aktiv", "aktiv");
  await legeLager("zu", "abgeschlossen");
  await legeLager("archiv", "archiviert");
  for (const l of ["aktiv", "zu", "archiv"]) {
    await mitglied(l, "lagerleitung", "lagerleitung");
    await mitglied(l, "leitung", "leitung");
    await mitglied(l, "team", "team");
    await mitglied(l, "lesen", "lesen");
    await mitglied(l, "adminAlsLesen", "lesen");
    // Eine falsche Zeile einer fremden Abteilung gibt nichts frei
    await mitglied(l, "fremd", "lagerleitung");
  }
});

describe("lagerZugriff: Reihenfolge der Prüfungen", () => {
  test("Rolle und Recht: 200, 403 bei fehlendem Recht", async () => {
    const pfad = (l: string, route: string) => `/${lagerOf[l]}/${route}`;
    expect(
      (await rufe("lagerleitung", "GET", pfad("aktiv", "lesen"))).status,
    ).toBe(200);
    expect((await rufe("leitung", "GET", pfad("aktiv", "lesen"))).status).toBe(
      200,
    );
    expect((await rufe("lesen", "GET", pfad("aktiv", "lesen"))).status).toBe(
      200,
    );
    // Team liest nicht alle Aufgaben
    expect((await rufe("team", "GET", pfad("aktiv", "lesen"))).status).toBe(
      403,
    );
    expect((await rufe("team", "GET", pfad("aktiv", "offen"))).status).toBe(
      200,
    );
    expect(
      (await rufe("lesen", "POST", pfad("aktiv", "schreiben"))).status,
    ).toBe(403);
    expect(
      (await rufe("team", "POST", pfad("aktiv", "schreiben"))).status,
    ).toBe(403);
    expect(
      (await rufe("leitung", "POST", pfad("aktiv", "schreiben"))).status,
    ).toBe(204);
    expect(
      (await rufe("lagerleitung", "POST", pfad("aktiv", "schreiben"))).status,
    ).toBe(204);
  });

  test("Nicht-Mitglied, fremde Abteilung, unbekanntes Lager: 404 vor dem Recht; ungültige ID: 400", async () => {
    const aktiv = lagerOf.aktiv;
    for (const wer of ["ohne", "fremd", "fremdAdmin"]) {
      expect((await rufe(wer, "GET", `/${aktiv}/offen`)).status, wer).toBe(404);
      expect((await rufe(wer, "POST", `/${aktiv}/schreiben`)).status, wer).toBe(
        404,
      );
    }
    expect(
      (await rufe("lagerleitung", "GET", `/${randomUUID()}/offen`)).status,
    ).toBe(404);
    expect(
      (await rufe("lagerleitung", "GET", "/nicht-uuid/offen")).status,
    ).toBe(400);
  });

  test("die Abteilungsleitung gilt in der eigenen Abteilung als Lagerleitung, mit oder ohne Zeile", async () => {
    const ohne = await rufe("admin", "GET", `/${lagerOf.aktiv}/lesen`);
    expect(ohne.status).toBe(200);
    expect(await ohne.json()).toEqual({
      rolle: "lagerleitung",
      mitglied: false,
    });
    // Eine schwächere Zeile ändert daran nichts
    const mit = await rufe("adminAlsLesen", "GET", `/${lagerOf.aktiv}/lesen`);
    expect(await mit.json()).toEqual({ rolle: "lagerleitung", mitglied: true });
    expect(
      (await rufe("adminAlsLesen", "POST", `/${lagerOf.aktiv}/schreiben`))
        .status,
    ).toBe(204);
  });

  test("abgeschlossen und archiviert: Lesen geht, jede andere Methode ist 409 LAGER_GESCHLOSSEN", async () => {
    for (const l of ["zu", "archiv"]) {
      expect(
        (await rufe("lagerleitung", "GET", `/${lagerOf[l]}/lesen`)).status,
        l,
      ).toBe(200);
      const antwort = await rufe(
        "lagerleitung",
        "POST",
        `/${lagerOf[l]}/schreiben`,
      );
      expect(antwort.status, l).toBe(409);
      expect(await antwort.json()).toMatchObject({ code: "LAGER_GESCHLOSSEN" });
      // Der Schreibschutz gilt auch für die Abteilungsleitung
      expect(
        (await rufe("admin", "POST", `/${lagerOf[l]}/schreiben`)).status,
        l,
      ).toBe(409);
      // Das fehlende Recht kommt zuerst: Wer nicht schreiben dürfte, erfährt nichts über den Zustand
      expect(
        (await rufe("lesen", "POST", `/${lagerOf[l]}/schreiben`)).status,
        l,
      ).toBe(403);
      // Die Ausnahme der Route
      expect(
        (await rufe("lagerleitung", "POST", `/${lagerOf[l]}/schluss`)).status,
        l,
      ).toBe(204);
    }
  });

  test("die Rolle gilt ab der nächsten Anfrage, nie aus einem Zwischenspeicher", async () => {
    const pfad = `/${lagerOf.aktiv}/schreiben`;
    const bedingung = and(
      eq(schema.lagerMitglied.lagerId, lagerOf.aktiv),
      eq(schema.lagerMitglied.personId, personen.team.id),
    );
    const rolleSetzen = (rolle: LagerRolle) =>
      db.update(schema.lagerMitglied).set({ rolle }).where(bedingung);
    expect((await rufe("team", "POST", pfad)).status).toBe(403);
    await rolleSetzen("leitung");
    expect((await rufe("team", "POST", pfad)).status).toBe(204);
    await rolleSetzen("lesen");
    expect((await rufe("team", "POST", pfad)).status).toBe(403);
    await db.delete(schema.lagerMitglied).where(bedingung);
    expect((await rufe("team", "POST", pfad)).status).toBe(404);
  });
});

describe("ladeLagerZugriff und darf", () => {
  test("liefert Lager, Rolle, Mitgliedschaft und Schreibschutz; ohne Zugang undefined", async () => {
    const zugriff = await ladeLagerZugriff(db, personen.leitung, lagerOf.zu);
    expect(zugriff).toMatchObject({
      rolle: "leitung",
      mitglied: true,
      geschlossen: true,
    });
    expect(zugriff?.lager.id).toBe(lagerOf.zu);
    expect(
      await ladeLagerZugriff(db, personen.ohne, lagerOf.zu),
    ).toBeUndefined();
    expect(
      await ladeLagerZugriff(db, personen.fremdAdmin, lagerOf.zu),
    ).toBeUndefined();
  });

  test("darf folgt der Standardmatrix und verbietet Unbekanntes", () => {
    expect(darf({ rolle: "team" }, "eingang.senden")).toBe(true);
    expect(darf({ rolle: "lesen" }, "eingang.senden")).toBe(false);
    expect(darf({ rolle: "leitung" }, "adressbuch.lesen")).toBe(false);
    expect(darf({ rolle: "lagerleitung" }, "adressbuch.lesen")).toBe(true);
    expect(darf({ rolle: "lagerleitung" }, "gibt.es.nicht" as LagerRecht)).toBe(
      false,
    );
  });
});
