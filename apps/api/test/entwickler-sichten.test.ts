import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { siehtAlles } from "../src/rechte.js";
import { ladeSeiten } from "../src/seiten.js";
import { sichtbarFuer } from "../src/sichtbarkeit.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

// siehtAlles (#735): Sicht, kein Recht. Die Abteilungsleitung und der Entwickler sehen jedes Objekt der eigenen Abteilung; wer nur ein Recht oder eine Stufenrolle hat, sieht nichts Fremdes.

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
let abteilungsleitung: PersonaKonto;
// Leitung der Stufe B, nie Mitglied des Lagers: sieht nichts Fremdes
let leitendeB: PersonaKonto;
let slA: PersonaKonto;
let slB: PersonaKonto;
let lagerId: string;
let fremdesLagerId: string;
let programmIds: { stufeA: string; ohneStufe: string };

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [entwickler, abteilungsleitung, leitendeB, slA, slB] = await Promise.all([
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "leitendeB"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "slB"),
  ]);
  await db
    .insert(schema.plattformEntwickler)
    .values({ userId: entwickler.id! });
  const [l, fremd] = await db
    .insert(schema.lager)
    .values([
      {
        abteilungId: welt.testabteilungId,
        titel: "Sichtlager",
        von: "2027-07-10",
        bis: "2027-07-24",
        status: "aktiv",
      },
      {
        abteilungId: welt.demoAbteilungId,
        titel: "Fremdes Lager",
        von: "2027-07-10",
        bis: "2027-07-24",
        status: "aktiv",
      },
    ])
    .returning({ id: schema.lager.id });
  lagerId = l.id;
  fremdesLagerId = fremd.id;
  // Mitglied ist nur die Stufenleitung A, nie der Entwickler
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId, personId: slA.id!, rolle: "lagerleitung" });
  programmIds = {
    stufeA: (
      await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        stufen: [welt.stufeAId],
        titel: "Nur Stufe A",
        beginn: new Date(Date.UTC(2027, 4, 1, 8)),
      })
    ).id,
    ohneStufe: (
      await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        titel: "Ohne Stufe",
        beginn: new Date(Date.UTC(2027, 4, 1, 10)),
      })
    ).id,
  };
});

const hole = (konto: PersonaKonto, pfad: string) =>
  app.request(pfad, { headers: konto.headers });

describe("siehtAlles", () => {
  test.each([
    [{ abteilungsleitung: true, entwickler: false }, true],
    [{ abteilungsleitung: false, entwickler: true }, true],
    [{ abteilungsleitung: true, entwickler: true }, true],
    [{ abteilungsleitung: false, entwickler: false }, false],
  ])("%j gibt %s", (person, erwartet) => {
    expect(siehtAlles(person)).toBe(erwartet);
  });

  test("/api/v1/ich liefert abteilungsleitung und entwickler getrennt, kein admin (#736)", async () => {
    const ich = async (konto: PersonaKonto) =>
      (await (await hole(konto, "/api/v1/ich")).json()) as Record<
        string,
        unknown
      >;
    expect(await ich(abteilungsleitung)).toMatchObject({
      abteilungsleitung: true,
      entwickler: false,
    });
    expect(await ich(entwickler)).toMatchObject({
      abteilungsleitung: false,
      entwickler: true,
    });
    expect(await ich(leitendeB)).toMatchObject({
      abteilungsleitung: false,
      entwickler: false,
    });
    expect(await ich(entwickler)).not.toHaveProperty("admin");
  });
});

describe("Lager: /api/v1/lager", () => {
  test("der Entwickler ohne Mitgliedschaft ist Lagerleitung, jede andere Person ohne Mitgliedschaft bekommt 404", async () => {
    const antwort = await hole(entwickler, `/api/v1/lager/${lagerId}`);
    expect(antwort.status).toBe(200);
    expect(((await antwort.json()) as { rolle: string }).rolle).toBe(
      "lagerleitung",
    );
    for (const konto of [leitendeB, slB]) {
      expect((await hole(konto, `/api/v1/lager/${lagerId}`)).status).toBe(404);
    }
    expect(
      (await hole(abteilungsleitung, `/api/v1/lager/${lagerId}`)).status,
    ).toBe(200);
  });

  test("ein Lager einer anderen Abteilung bleibt 404, auch für den Entwickler", async () => {
    expect(
      (await hole(entwickler, `/api/v1/lager/${fremdesLagerId}`)).status,
    ).toBe(404);
  });

  test("die Liste zeigt dem Entwickler alle Lager der Abteilung als Lagerleitung, der anderen Person keines", async () => {
    const lager = async (konto: PersonaKonto) =>
      (
        (await (await hole(konto, "/api/v1/lager")).json()) as {
          lager: { id: string; rolle: string }[];
        }
      ).lager;
    const seine = await lager(entwickler);
    expect(seine.map((l) => l.id)).toContain(lagerId);
    expect(seine.map((l) => l.id)).not.toContain(fremdesLagerId);
    expect(seine.every((l) => l.rolle === "lagerleitung")).toBe(true);
    expect((await lager(leitendeB)).map((l) => l.id)).not.toContain(lagerId);
    expect((await lager(slB)).map((l) => l.id)).not.toContain(lagerId);
  });
});

describe("Programme und Termine", () => {
  test("der Entwickler sieht jedes Programm der Abteilung, die Leitung der anderen Stufe keines der beiden", async () => {
    for (const id of Object.values(programmIds)) {
      expect((await hole(entwickler, `/api/v1/programme/${id}`)).status).toBe(
        200,
      );
    }
    expect(
      (await hole(leitendeB, `/api/v1/programme/${programmIds.stufeA}`)).status,
    ).toBe(404);
    expect(
      (await hole(leitendeB, `/api/v1/programme/${programmIds.ohneStufe}`))
        .status,
    ).toBe(404);
  });

  test("«Alle Termine»: ein Termin ohne Tag steht nur für den Entwickler und die Abteilungsleitung in der Liste", async () => {
    const titel = async (konto: PersonaKonto) =>
      (
        (await (
          await hole(
            konto,
            "/api/v1/termine/alle?von=2027-05-01&bis=2027-05-07",
          )
        ).json()) as { termine: { titel: string }[] }
      ).termine.map((t) => t.titel);
    expect(await titel(entwickler)).toContain("Ohne Stufe");
    expect(await titel(abteilungsleitung)).toContain("Ohne Stufe");
    expect(await titel(leitendeB)).not.toContain("Ohne Stufe");
    expect(await titel(slB)).not.toContain("Ohne Stufe");
  });
});

describe("Seiten und Sichtbarkeit", () => {
  const objekt = {
    abteilungId: "abt-1",
    sichtbarkeit: { art: "tags" as const, tagIds: ["t1"] },
  };
  const person = (abteilungsleitung: boolean, entwickler: boolean) => ({
    id: "p",
    abteilungId: "abt-1",
    abteilungsleitung,
    entwickler,
    gruppen: [],
  });

  test("ein Objekt mit Tags sieht der Entwickler ohne eigenen Tag, die Person ohne Rolle nicht", () => {
    expect(sichtbarFuer(person(false, true), objekt)).toBe(true);
    expect(sichtbarFuer(person(true, false), objekt)).toBe(true);
    expect(sichtbarFuer(person(false, false), objekt)).toBe(false);
  });

  test("auch der Entwickler sieht nie ein Objekt einer anderen Abteilung", () => {
    expect(
      sichtbarFuer(person(false, true), { ...objekt, abteilungId: "abt-2" }),
    ).toBe(false);
  });
});
