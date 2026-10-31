import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import type { TokenMessage } from "firebase-admin/messaging";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Fcm } from "../src/push.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  fcmNachricht,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

// Eine Attrappe statt firebase-admin: Kein Netz, keine Schlüssel
let gesendet: TokenMessage[];
const fcm: Fcm = {
  async sendEach(nachrichten) {
    gesendet.push(...nachrichten);
    return { responses: nachrichten.map(() => ({ success: true })) };
  },
};
const baue = (mitFcm: boolean) =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    fcm: mitFcm ? fcm : undefined,
    seiten: ladeSeiten(),
  });
const app = baue(true);
afterAll(() => sql.end());

// Eine eigene Welt pro Test: Die Empfänger von «alle» und das Limit pro Abteilung bleiben so unabhängig
let welt: Welt;
const tokens = new Map<string, string>();

beforeEach(async () => {
  gesendet = [];
  tokens.clear();
  // Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
  vi.spyOn(console, "log").mockImplementation(() => {});
  welt = await erstelleWelt(db, auth);
});
afterEach(() => vi.restoreAllMocks());

// Legt die Persona an und gibt ihr ein Push-Token an ihrer Sitzung
async function person(schluessel: Persona, name: string = schluessel) {
  const konto = await legePersonaAn(welt, schluessel);
  const [sitzung] = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, konto.id!));
  const token = `fcm-test-${randomUUID()}`;
  await db.insert(schema.pushToken).values({
    sessionId: sitzung!.id,
    token,
    userId: konto.id!,
    plattform: "android",
  });
  tokens.set(name, token);
  return konto;
}

const BASIS = "/api/v1/admin/mitteilungen";
const senden = (
  konto: PersonaKonto,
  body: Record<string, unknown>,
  anwendung = app,
) =>
  anwendung.request(BASIS, {
    method: "POST",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ALLE = { titel: "Wichtige Mitteilung", empfaenger: "alle" };
const empfangen = () => gesendet.map((n) => n.token).sort();
const erwartet = (...namen: string[]) =>
  namen.map((n) => tokens.get(n)!).sort();
const auditZeilen = () =>
  db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.abteilungId, welt.testabteilungId));

describe("POST /api/v1/admin/mitteilungen", () => {
  test("«alle» erreicht nur aktive Konten mit eingeschalteter Option", async () => {
    const admin = await person("admin");
    await person("elternA");
    await person("slB");
    // Option aus: bekommt nichts
    const still = await person("elternB", "still");
    await db
      .update(schema.user)
      .set({ pushProgramme: false })
      .where(eq(schema.user.id, still.id!));
    // Token bleibt, das Konto ist gesperrt: bekommt nichts
    const gesperrt = await person("leitendeA", "gesperrt");
    await db
      .update(schema.user)
      .set({ banned: true, deaktiviertAm: new Date() })
      .where(eq(schema.user.id, gesperrt.id!));
    // Konto der Demo-Abteilung: nie
    await person("demoEltern");

    const antwort = await senden(admin, ALLE);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ empfaenger: 3 });
    expect(empfangen()).toEqual(erwartet("admin", "elternA", "slB"));
  });

  test("der Push trägt nur den Titel, Typ «mitteilung», leere ID und den Kanal «mitteilungen»", async () => {
    const admin = await person("admin");
    await senden(admin, ALLE);
    expect(gesendet).toEqual([
      fcmNachricht(
        tokens.get("admin")!,
        "Wichtige Mitteilung",
        { typ: "mitteilung", id: "" },
        "mitteilungen",
      ),
    ]);
  });

  test("«stufen» erreicht Eltern aktiver Kinder und Leitende der Stufe, dazu die absendende Person", async () => {
    const admin = await person("admin");
    await person("elternA");
    await person("slA");
    await person("leitendeA");
    await person("elternB");
    await person("slB");
    // Eltern von Kind B und eines inaktiven Kindes der Stufe A: Das inaktive Kind zählt nicht
    const nurInaktiv = await person("elternB", "nurInaktiv");
    const [inaktiv] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Kind",
        nachname: "Inaktiv",
        stufeId: welt.stufeAId,
        inaktivSeit: new Date(),
      })
      .returning();
    await db
      .insert(schema.kindEltern)
      .values({ kindId: inaktiv!.id, userId: nurInaktiv.id! });

    const antwort = await senden(admin, {
      titel: "Sommerlager",
      empfaenger: "stufen",
      stufeIds: [welt.stufeAId],
    });
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ empfaenger: 4 });
    expect(empfangen()).toEqual(
      erwartet("admin", "elternA", "slA", "leitendeA"),
    );
  });

  test("mehrere Stufen: eine Person in beiden bekommt den Push einmal", async () => {
    const admin = await person("admin");
    await person("leitendeAElternB");
    await person("slB");
    const antwort = await senden(admin, {
      titel: "Hallo",
      empfaenger: "stufen",
      stufeIds: [welt.stufeAId, welt.stufeBId, welt.stufeAId],
    });
    expect(await antwort.json()).toEqual({ empfaenger: 3 });
    expect(empfangen()).toEqual(erwartet("admin", "leitendeAElternB", "slB"));
  });

  test.each([
    ["Eltern", ["eltern"], ["elternA"]],
    ["Stufenleitung", ["stufenleitung"], ["slA"]],
    ["Leitende", ["leitung"], ["leitendeA"]],
    ["Leitende und Eltern", ["leitung", "eltern"], ["leitendeA", "elternA"]],
    [
      "Stufenleitung und Leitende",
      ["stufenleitung", "leitung"],
      ["slA", "leitendeA"],
    ],
  ])(
    "«stufen» nur an %s: sonst niemand, auch nicht die absendende Person",
    async (_name, rollen, erwartetNamen) => {
      const admin = await person("admin");
      for (const n of [
        "elternA",
        "slA",
        "leitendeA",
        "elternB",
        "slB",
      ] as const)
        await person(n);
      const antwort = await senden(admin, {
        titel: "Hallo",
        empfaenger: "stufen",
        stufeIds: [welt.stufeAId],
        rollen,
      });
      expect(await antwort.json()).toEqual({
        empfaenger: erwartetNamen.length,
      });
      expect(empfangen()).toEqual(erwartet(...erwartetNamen));
    },
  );

  test("«alle» nur an eine Rolle trifft diese Rolle in allen Stufen, nicht die absendende Person", async () => {
    const admin = await person("admin");
    for (const n of ["elternA", "slA", "slB", "leitendeA"] as const)
      await person(n);
    const antwort = await senden(admin, { ...ALLE, rollen: ["stufenleitung"] });
    expect(await antwort.json()).toEqual({ empfaenger: 2 });
    expect(empfangen()).toEqual(erwartet("slA", "slB"));
  });

  test("alle drei Rollen sind dasselbe wie keine Angabe", async () => {
    const admin = await person("admin");
    await person("elternA");
    // Eltern nur von Stufe B: Die Stufe A erreicht es nicht, «alle» schon
    await person("elternB", "ohneKind");
    const alle = ["stufenleitung", "leitung", "eltern"];
    await senden(admin, { ...ALLE, rollen: alle });
    expect(empfangen()).toEqual(erwartet("admin", "elternA", "ohneKind"));
    gesendet = [];
    await senden(admin, {
      titel: "Hallo",
      empfaenger: "stufen",
      stufeIds: [welt.stufeAId],
      rollen: alle,
    });
    expect(empfangen()).toEqual(erwartet("admin", "elternA"));
  });

  test("der Audit-Eintrag nennt die Rollen nur, wenn gefiltert wurde", async () => {
    const admin = await person("admin");
    await senden(admin, { ...ALLE, rollen: ["eltern", "stufenleitung"] });
    await senden(admin, ALLE);
    const zeilen = (await auditZeilen()).sort(
      (a, b) => a.erstelltAm.getTime() - b.erstelltAm.getTime(),
    );
    expect(zeilen[0]!.details).toEqual({
      empfaenger: "alle",
      rollen: ["stufenleitung", "eltern"],
      anzahl: 0,
    });
    expect(zeilen[1]!.details).toEqual({ empfaenger: "alle", anzahl: 1 });
  });

  test("der Audit-Eintrag nennt Gruppe und Zahl, nie den Text", async () => {
    const admin = await person("admin");
    await person("elternA");
    await senden(admin, { ...ALLE, titel: "Geheimer Titeltext" });
    await senden(admin, {
      titel: "Zweiter Titeltext",
      empfaenger: "stufen",
      stufeIds: [welt.stufeAId],
    });
    const zeilen = (await auditZeilen()).sort(
      (a, b) => a.erstelltAm.getTime() - b.erstelltAm.getTime(),
    );
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toMatchObject({
      abteilungId: welt.testabteilungId,
      akteurId: admin.id,
      aktion: "mitteilung_gesendet",
      zielTyp: "abteilung",
      zielId: welt.testabteilungId,
      details: { empfaenger: "alle", anzahl: 2 },
    });
    expect(zeilen[1]!.details).toEqual({
      empfaenger: "stufen",
      stufeIds: [welt.stufeAId],
      anzahl: 2,
    });
    expect(JSON.stringify(zeilen)).not.toContain("Titeltext");
  });

  test("Nicht-Admins bekommen 403, es geht nichts hinaus und nichts ins Audit-Log", async () => {
    for (const schluessel of ["slA", "leitendeA", "elternA"] as const) {
      const konto = await person(schluessel);
      expect((await senden(konto, ALLE)).status).toBe(403);
    }
    expect(gesendet).toEqual([]);
    expect(await auditZeilen()).toEqual([]);
  });

  test("Stufen einer anderen Abteilung und unbekannte IDs sind 400", async () => {
    const admin = await person("admin");
    for (const stufeIds of [
      [welt.demoStufeId],
      [welt.stufeAId, randomUUID()],
    ]) {
      const antwort = await senden(admin, {
        titel: "Hallo",
        empfaenger: "stufen",
        stufeIds,
      });
      expect(antwort.status).toBe(400);
    }
    expect(gesendet).toEqual([]);
    expect(await auditZeilen()).toEqual([]);
  });

  test.each([
    ["ohne Titel", { empfaenger: "alle" }],
    ["leerer Titel", { titel: "   ", empfaenger: "alle" }],
    ["zu langer Titel", { titel: "x".repeat(101), empfaenger: "alle" }],
    ["unbekannte Gruppe", { titel: "Hallo", empfaenger: "admins" }],
    ["«stufen» ohne Stufen", { titel: "Hallo", empfaenger: "stufen" }],
    [
      "«stufen» mit leerer Liste",
      { titel: "Hallo", empfaenger: "stufen", stufeIds: [] },
    ],
    [
      "«alle» mit Stufen",
      { titel: "Hallo", empfaenger: "alle", stufeIds: [randomUUID()] },
    ],
    ["unbekanntes Feld", { ...ALLE, text: "Textkörper" }],
    ["leere Rollen", { ...ALLE, rollen: [] }],
    ["unbekannte Rolle", { ...ALLE, rollen: ["admin"] }],
  ])("%s ist 400", async (_name, body) => {
    const admin = await person("admin");
    expect((await senden(admin, body)).status).toBe(400);
    expect(gesendet).toEqual([]);
  });

  test("ohne Push-Dienst gibt es 503 und keinen Audit-Eintrag", async () => {
    const admin = await person("admin");
    const antwort = await senden(admin, ALLE, baue(false));
    expect(antwort.status).toBe(503);
    expect(await antwort.json()).toMatchObject({
      code: "PUSH_NICHT_EINGERICHTET",
    });
    expect(await auditZeilen()).toEqual([]);
  });

  test("ab der elften Mitteilung in einer Stunde gibt es 429", async () => {
    const admin = await person("admin");
    for (let i = 0; i < 10; i++) {
      expect((await senden(admin, ALLE)).status).toBe(200);
    }
    gesendet = [];
    expect((await senden(admin, ALLE)).status).toBe(429);
    expect(gesendet).toEqual([]);
    expect(await auditZeilen()).toHaveLength(10);
  });

  test("das Limit gilt je Abteilung", async () => {
    const admin = await person("admin");
    const demoAdmin = await person("demoAdmin");
    for (let i = 0; i < 10; i++) await senden(admin, ALLE);
    expect((await senden(admin, ALLE)).status).toBe(429);
    expect((await senden(demoAdmin, ALLE)).status).toBe(200);
  });
});
