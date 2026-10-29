import { Expo } from "expo-server-sdk";
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
import { programm } from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  expo: new Expo({ accessToken: "test-zugang" }),
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const ROLLEN = [
  "admin",
  "slA",
  "slB",
  "leitendeA",
  "leitendeB",
  "leitendeAElternB",
  "elternA",
  "elternB",
  "demoAdmin",
] as const;
type Rolle = (typeof ROLLEN)[number];

let welt: Welt;
let konten: Record<Rolle, PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      ROLLEN.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Rolle, PersonaKonto>;
});

// Jede Anfrage schriebe sonst eine Log-Zeile in die Testausgabe; die Zeilen prüft der Log-Test
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const patch = (konto: PersonaKonto, programmId: string, body: unknown) =>
  app.request(`/api/v1/programme/${programmId}`, {
    method: "PATCH",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const detail = async (konto: PersonaKonto, programmId: string) => {
  const res = await app.request(`/api/v1/programme/${programmId}`, {
    headers: konto.headers,
  });
  return { status: res.status, body: await res.json() };
};

const zeile = async (programmId: string) =>
  (await db.select().from(programm).where(eq(programm.id, programmId)))[0];

const frisch = (
  sichtbarkeit: "intern" | "leitende" | "eltern",
  stufen: string[],
) =>
  legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit,
    stufen,
  });

describe("PATCH /api/v1/programme/:id: Status je Person", () => {
  type Erwartet = Record<Rolle, number>;
  const FAELLE: [
    string,
    "intern" | "leitende" | "eltern",
    "A" | "B" | "AB" | "",
    Erwartet,
  ][] = [
    [
      "P1: intern, ohne Stufe",
      "intern",
      "",
      {
        admin: 204,
        slA: 403,
        slB: 403,
        leitendeA: 404,
        leitendeB: 404,
        leitendeAElternB: 404,
        elternA: 404,
        elternB: 404,
        demoAdmin: 404,
      },
    ],
    [
      "P2: intern, Stufe A",
      "intern",
      "A",
      {
        admin: 204,
        slA: 204,
        slB: 403,
        leitendeA: 404,
        leitendeB: 404,
        leitendeAElternB: 404,
        elternA: 404,
        elternB: 404,
        demoAdmin: 404,
      },
    ],
    [
      "P3: leitende, Stufe A",
      "leitende",
      "A",
      {
        admin: 204,
        slA: 204,
        slB: 403,
        leitendeA: 204,
        leitendeB: 404,
        leitendeAElternB: 204,
        elternA: 404,
        elternB: 404,
        demoAdmin: 404,
      },
    ],
    [
      "P4: eltern, Stufe A",
      "eltern",
      "A",
      {
        admin: 204,
        slA: 204,
        slB: 403,
        leitendeA: 204,
        leitendeB: 404,
        leitendeAElternB: 204,
        elternA: 403,
        elternB: 404,
        demoAdmin: 404,
      },
    ],
    [
      "P5: eltern, Stufe B",
      "eltern",
      "B",
      {
        admin: 204,
        slA: 403,
        slB: 204,
        leitendeA: 404,
        leitendeB: 204,
        leitendeAElternB: 403,
        elternA: 404,
        elternB: 403,
        demoAdmin: 404,
      },
    ],
    [
      "P6: leitende, Stufen A und B",
      "leitende",
      "AB",
      {
        admin: 204,
        slA: 204,
        slB: 204,
        leitendeA: 204,
        leitendeB: 204,
        leitendeAElternB: 204,
        elternA: 404,
        elternB: 404,
        demoAdmin: 404,
      },
    ],
  ];

  test.each(FAELLE)("%s", async (_name, sichtbarkeit, gruppe, erwartet) => {
    const stufen = {
      "": [],
      A: [welt.stufeAId],
      B: [welt.stufeBId],
      AB: [welt.stufeAId, welt.stufeBId],
    }[gruppe];
    const p = await frisch(sichtbarkeit, stufen);
    const status = {} as Erwartet;
    const flags: Partial<Record<Rolle, unknown>> = {};
    for (const rolle of ROLLEN) {
      const vorher = await zeile(p.id);
      const lesen = await detail(konten[rolle], p.id);
      status[rolle] = (
        await patch(konten[rolle], p.id, { treffpunkt: `Bahnhof ${rolle}` })
      ).status;
      if (status[rolle] !== 204) {
        // Jede Absage lässt die Zeile, wie sie war
        expect(await zeile(p.id)).toEqual(vorher);
      }
      // Wo die Zeile verborgen ist, ist es auch das Detail; sonst zeigt das Flag das Recht
      expect(lesen.status).toBe(status[rolle] === 404 ? 404 : 200);
      if (lesen.status === 200) flags[rolle] = lesen.body.darfErgaenzen;
    }
    expect(status).toEqual(erwartet);
    expect(flags).toEqual(
      Object.fromEntries(
        Object.entries(erwartet)
          .filter(([, s]) => s !== 404)
          .map(([rolle, s]) => [rolle, s === 204]),
      ),
    );
  });
});

describe("PATCH /api/v1/programme/:id: Inhalt", () => {
  test("alle fünf Felder getrimmt gespeichert, geaendert_von und geaendert_am gesetzt", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const vorher = await zeile(p.id);
    expect(vorher.geaendertVon).toBeNull();
    expect(vorher.geaendertAm).toBeNull();
    const res = await patch(konten.leitendeA, p.id, {
      treffpunkt: "  Waldhütte ",
      schlussOrt: " Bahnhof",
      schlussZeit: "16:30",
      mitnehmen: " Znüni und Wasser ",
      infoEltern: "Bei Regen drinnen. ",
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const nachher = await zeile(p.id);
    expect(nachher).toMatchObject({
      treffpunkt: "Waldhütte",
      schlussOrt: "Bahnhof",
      schlussZeit: "16:30:00",
      mitnehmen: "Znüni und Wasser",
      infoEltern: "Bei Regen drinnen.",
      geaendertVon: konten.leitendeA.id,
    });
    expect(nachher.geaendertAm).toBeInstanceOf(Date);
    // Die Google-Felder und Titel bleiben
    expect(nachher.googleOrt).toBe("Google-Ort");
    expect(nachher.titel).toBe(vorher.titel);
  });

  test("eine Teiländerung lässt die anderen Felder stehen; die Änderung trägt den letzten Bearbeiter", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    await patch(konten.leitendeA, p.id, {
      treffpunkt: "Waldhütte",
      mitnehmen: "Znüni",
    });
    await patch(konten.slA, p.id, { infoEltern: "Regen" });
    expect(await zeile(p.id)).toMatchObject({
      treffpunkt: "Waldhütte",
      mitnehmen: "Znüni",
      infoEltern: "Regen",
      geaendertVon: konten.slA.id,
    });
  });

  test.each([
    ["leer", ""],
    ["nur Leerzeichen", "   "],
    ["null", null],
  ])(
    "%s löscht die Angabe, und der Ort aus Google gilt wieder",
    async (_name, wert) => {
      const p = await frisch("eltern", [welt.stufeAId]);
      await patch(konten.leitendeA, p.id, {
        treffpunkt: "Waldhütte",
        schlussOrt: "Bahnhof",
        schlussZeit: "16:30",
        mitnehmen: "Znüni",
        infoEltern: "Regen",
      });
      expect(
        (
          await patch(konten.leitendeA, p.id, {
            treffpunkt: wert,
            schlussOrt: wert,
            schlussZeit: wert === null ? null : "",
            mitnehmen: wert,
            infoEltern: wert,
          })
        ).status,
      ).toBe(204);
      expect(await zeile(p.id)).toMatchObject({
        treffpunkt: null,
        schlussOrt: null,
        schlussZeit: null,
        mitnehmen: null,
        infoEltern: null,
      });
      // Eine spätere Änderung in Google (der Abgleich schreibt google_ort) kommt an
      await db
        .update(programm)
        .set({ googleOrt: "Neuer Ort" })
        .where(eq(programm.id, p.id));
      const { body } = await detail(konten.elternA, p.id);
      expect(body).toMatchObject({
        treffpunkt: null,
        googleOrt: "Neuer Ort",
        darfErgaenzen: false,
      });
    },
  );

  test("Grenzen: 200 und 2000 Zeichen gehen, 201 und 2001 nicht", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    expect(
      (
        await patch(konten.admin, p.id, {
          treffpunkt: "x".repeat(200),
          schlussOrt: "x".repeat(200),
          mitnehmen: "y".repeat(2000),
          infoEltern: "y".repeat(2000),
        })
      ).status,
    ).toBe(204);
    for (const [feld, laenge] of [
      ["treffpunkt", 201],
      ["schlussOrt", 201],
      ["mitnehmen", 2001],
      ["infoEltern", 2001],
    ] as const) {
      expect(
        (await patch(konten.admin, p.id, { [feld]: "z".repeat(laenge) }))
          .status,
      ).toBe(400);
    }
    expect((await zeile(p.id)).treffpunkt).toBe("x".repeat(200));
  });

  test.each([
    ["leerer Körper", {}],
    ["kein JSON-Objekt", "[]"],
    ["status", { status: "abgesagt" }],
    ["sichtbarkeit", { sichtbarkeit: "eltern" }],
    ["stufen", { stufen: [] }],
    ["abteilungId", { abteilungId: randomUUID() }],
    ["titel", { titel: "Neu" }],
    ["googleOrt", { googleOrt: "Neu" }],
    ["geaendertVon", { geaendertVon: randomUUID() }],
    ["geaendertAm", { geaendertAm: "2027-01-01T00:00:00Z" }],
    ["ein erlaubtes Feld mit einem fremden", { treffpunkt: "A", titel: "B" }],
    ["Zeit 24:00", { schlussZeit: "24:00" }],
    ["Zeit 9:30", { schlussZeit: "9:30" }],
    ["Zeit 16:30:00", { schlussZeit: "16:30:00" }],
    ["Zeit als Zahl", { schlussZeit: 1630 }],
    ["Zahl als Treffpunkt", { treffpunkt: 5 }],
    ["NUL im Treffpunkt", { treffpunkt: "Wald\u0000hütte" }],
  ])("%s: 400, Zeile unverändert", async (_name, body) => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const vorher = await zeile(p.id);
    const res = await patch(konten.admin, p.id, body);
    expect(res.status).toBe(400);
    expect(await zeile(p.id)).toEqual(vorher);
  });

  test("ohne JSON-Kopfzeile: 400", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const res = await app.request(`/api/v1/programme/${p.id}`, {
      method: "PATCH",
      headers: konten.admin.headers,
      body: JSON.stringify({ treffpunkt: "Wald" }),
    });
    expect(res.status).toBe(400);
    expect((await zeile(p.id)).treffpunkt).toBeNull();
  });

  test("ungültige ID: 400; unbekannte ID: 404 NICHT_GEFUNDEN", async () => {
    expect(
      (await patch(konten.admin, "keine-uuid", { mitnehmen: "x" })).status,
    ).toBe(400);
    const res = await patch(konten.admin, randomUUID(), { mitnehmen: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NICHT_GEFUNDEN" });
  });

  test("ein Programm einer anderen Abteilung: 404 trotz Admin", async () => {
    const fremd = await legeProgrammAn(db, {
      abteilungId: welt.demoAbteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.demoStufeId],
    });
    expect(
      (await patch(konten.admin, fremd.id, { mitnehmen: "x" })).status,
    ).toBe(404);
    expect((await zeile(fremd.id)).mitnehmen).toBeNull();
  });

  test("kein Log enthält den Inhalt", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    await patch(konten.leitendeA, p.id, { infoEltern: "<Max Muster>" });
    await patch(konten.leitendeA, p.id, { infoEltern: "x".repeat(5000) });
    const zeilen = ausgabe.mock.calls.map((a) => a.map(String).join(" "));
    expect(zeilen.length).toBeGreaterThan(0);
    expect(zeilen.join("\n")).not.toContain("Max Muster");
    expect((await zeile(p.id)).infoEltern).toBe("<Max Muster>");
  });
});
