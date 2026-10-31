import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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
import * as schema from "../src/db/schema.js";
import { eckdatenLauf } from "../src/kalender/laufstand.js";
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
const starts: string[] = [];
const appMitSyncs = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  syncs: {
    eckdaten: async () => {
      starts.push("eckdaten");
      return "fertig";
    },
    kalender: async () => {
      starts.push("kalender");
      return "gesperrt";
    },
  },
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const hole = (konto: PersonaKonto, pfad: string) =>
  app.request(pfad, { headers: konto.headers });

describe("GET /api/v1/admin/system", () => {
  test("liefert Prozess, Datenbank, Bestand, Kalender und Umgebung", async () => {
    const antwort = await hole(admin, "/api/v1/admin/system");
    expect(antwort.status).toBe(200);
    const daten = await antwort.json();
    expect(Object.keys(daten).sort()).toEqual([
      "bestand",
      "datenbank",
      "kalender",
      "prozess",
      "umgebung",
    ]);
    expect(daten.prozess.node).toBe(process.version);
    expect(daten.prozess.laufzeitSekunden).toBeGreaterThanOrEqual(0);
    expect(daten.prozess.rssMb).toBeGreaterThan(0);
    expect(daten.datenbank.erreichbar).toBe(true);
    expect(daten.datenbank.pingMs).toBeGreaterThanOrEqual(0);
    expect(daten.datenbank.poolMaximum).toBeGreaterThan(0);
    // Der Admin selbst ist aktiv; Kinder und Tokens gehören der Testabteilung
    expect(daten.bestand.aktivePersonen).toBeGreaterThanOrEqual(1);
    expect(daten.bestand.pushTokens).toBeGreaterThanOrEqual(0);
    expect(daten.kalender).toEqual({
      eingerichtet: false,
      letzterErfolgAm: null,
      fehler: null,
    });
  });

  test("enthält keine Umgebungswerte, Hosts, Adressen oder Schlüssel", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://geheim:geheim@db.example.org/x");
    vi.stubEnv("BETTER_AUTH_SECRET", "geheimes-geheimnis-geheimes-geheimnis");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/pfad/zum/schluessel.json");
    vi.stubEnv("COMMIT_SHA", "kein Hash; <script>");
    try {
      const antwort = await hole(admin, "/api/v1/admin/system");
      const text = await antwort.text();
      for (const verboten of [
        "geheim",
        "db.example.org",
        "schluessel.json",
        "postgres://",
        "kein Hash",
        "localhost",
        "cevi-os.invalid",
        "example.org",
      ]) {
        expect(text).not.toContain(verboten);
      }
      const daten = JSON.parse(text);
      // Nur ob, nicht welche
      expect(daten.umgebung.kalenderSchluessel).toBe(true);
      expect(daten.prozess.commit).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("ein gültiger Commit-Hash erscheint, sonst nichts", async () => {
    vi.stubEnv("COMMIT_SHA", "0123abc");
    try {
      const daten = await (await hole(admin, "/api/v1/admin/system")).json();
      expect(daten.prozess.commit).toBe("0123abc");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("GET /api/v1/admin/system/requests", () => {
  test("zählt Anfragen nach Routenmuster, nie nach konkretem Pfad", async () => {
    const id = randomUUID();
    // 404 für eine fremde, unbekannte Stufe: ein Fehler mit der ID im Pfad
    const fehler = await app.request(`/api/v1/admin/stufen/${id}`, {
      method: "PATCH",
      headers: { ...admin.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(fehler.status).toBe(404);
    expect((await hole(admin, "/api/v1/stufen")).status).toBe(200);

    const antwort = await hole(admin, "/api/v1/admin/system/requests");
    expect(antwort.status).toBe(200);
    const text = await antwort.text();
    expect(text).not.toContain(id);
    const daten = JSON.parse(text);
    expect(daten.gesamt).toBeGreaterThanOrEqual(2);
    expect(daten.statusklassen["4xx"]).toBeGreaterThanOrEqual(1);
    expect(daten.stunden).toHaveLength(24);
    expect(daten.minuten).toHaveLength(60);
    const muster = daten.routen.map(
      (r: { methode: string; route: string }) => `${r.methode} ${r.route}`,
    );
    expect(muster).toContain("PATCH /api/v1/admin/stufen/:id");
    expect(muster).toContain("GET /api/v1/stufen");
    expect(daten.letzteFehler[0]).toEqual({
      zeit: expect.any(String),
      methode: "PATCH",
      route: "/api/v1/admin/stufen/:id",
      status: 404,
    });
  });

  test("die Abrufe der System-Routen zählen nicht mit", async () => {
    await hole(admin, "/api/v1/admin/system");
    await hole(admin, "/api/v1/admin/system/requests");
    const daten = await (
      await hole(admin, "/api/v1/admin/system/requests")
    ).json();
    expect(
      daten.routen.filter((r: { route: string }) =>
        r.route.startsWith("/api/v1/admin/system"),
      ),
    ).toEqual([]);
  });

  test("statische Dateien der Verwaltung zählen nicht mit", async () => {
    await app.request("/admin/admin.css");
    const daten = await (
      await hole(admin, "/api/v1/admin/system/requests")
    ).json();
    expect(
      daten.routen.filter((r: { route: string }) =>
        r.route.startsWith("/admin"),
      ),
    ).toEqual([]);
  });

  test("Query und Header gelangen nicht in die Zahlen", async () => {
    const geheim = `tok-${randomUUID()}`;
    await app.request(`/api/v1/stufen?token=${geheim}`, {
      headers: { ...admin.headers, "x-geheim": geheim },
    });
    const text = await (
      await hole(admin, "/api/v1/admin/system/requests")
    ).text();
    expect(text).not.toContain(geheim);
  });

  test("Nicht-Admins bekommen 403, ohne Login 401", async () => {
    const eltern = await legePersonaAn(welt, "elternA");
    const ohne = await legePersonaAn(welt, "ohneLogin");
    for (const pfad of [
      "/api/v1/admin/system",
      "/api/v1/admin/system/requests",
    ]) {
      expect((await hole(eltern, pfad)).status).toBe(403);
      expect((await hole(ohne, pfad)).status).toBe(401);
    }
  });
});

describe("Ausgaben der Hintergrund-Abrufe (#267)", () => {
  test("GET /syncs zeigt pro Stufe Ausgang und gelesene Eckdaten, kalender zählt Programme", async () => {
    await db.insert(schema.programmEckdaten).values({
      stufeId: welt.stufeAId,
      tag: "2030-05-04",
      treffpunkt: "Bahnhof",
      schlussOrt: null,
      schlussZeit: "17:00",
      mitnehmen: "Znüni",
    });
    eckdatenLauf.am = new Date("2030-05-01T10:00:00Z");
    eckdatenLauf.stufen = new Map([
      [
        welt.stufeAId,
        {
          ausgang: "gelesen",
          fehlercode: null,
          adresse: "https://beispiel.example/cevistufe-a",
        },
      ],
      [
        welt.stufeBId,
        {
          ausgang: "fehler",
          fehlercode: "ECONNRESET",
          adresse: "https://beispiel.example/cevistufe-b",
        },
      ],
    ]);
    const antwort = await hole(admin, "/api/v1/admin/system/syncs");
    expect(antwort.status).toBe(200);
    const daten = await antwort.json();
    expect(daten.eckdaten.letzterLaufAm).toBe("2030-05-01T10:00:00.000Z");
    const a = daten.eckdaten.stufen.find(
      (s: { id: string }) => s.id === welt.stufeAId,
    );
    expect(a).toMatchObject({
      ausgang: "gelesen",
      adresse: "https://beispiel.example/cevistufe-a",
      eckdaten: {
        tag: "2030-05-04",
        treffpunkt: "Bahnhof",
        schlussZeit: "17:00",
      },
    });
    const b = daten.eckdaten.stufen.find(
      (s: { id: string }) => s.id === welt.stufeBId,
    );
    expect(b).toMatchObject({
      ausgang: "fehler",
      fehlercode: "ECONNRESET",
      eckdaten: null,
    });
    // Stufen anderer Abteilungen erscheinen nicht
    expect(
      daten.eckdaten.stufen.some(
        (s: { id: string }) => s.id === welt.demoStufeId,
      ),
    ).toBe(false);
    expect(daten.kalender).toMatchObject({ eingerichtet: false, fehler: null });
    expect(daten.kalender.programme).toBeGreaterThanOrEqual(0);
  });

  test("Nicht-Admins bekommen 403, ohne Login 401", async () => {
    const eltern = await legePersonaAn(welt, "elternA");
    const ohne = await legePersonaAn(welt, "ohneLogin");
    expect((await hole(eltern, "/api/v1/admin/system/syncs")).status).toBe(403);
    expect((await hole(ohne, "/api/v1/admin/system/syncs")).status).toBe(401);
  });

  test("POST stösst den Abruf an, protokolliert ihn und bremst eine zweite Anfrage", async () => {
    const post = (pfad: string) =>
      appMitSyncs.request(pfad, { method: "POST", headers: admin.headers });
    const erste = await post("/api/v1/admin/system/syncs/eckdaten");
    expect(erste.status).toBe(200);
    expect(await erste.json()).toEqual({ ergebnis: "fertig" });
    expect(starts).toEqual(["eckdaten"]);
    // Eigener Job, eigene Bremse; «gesperrt» wird weitergereicht
    const kalender = await post("/api/v1/admin/system/syncs/kalender");
    expect(await kalender.json()).toEqual({ ergebnis: "gesperrt" });
    expect((await post("/api/v1/admin/system/syncs/eckdaten")).status).toBe(
      429,
    );
    expect(starts).toEqual(["eckdaten", "kalender"]);
    const eintraege = await db
      .select({ aktion: schema.auditLog.aktion })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.akteurId, admin.id!));
    expect(eintraege.map((e) => e.aktion)).toEqual(
      expect.arrayContaining([
        "sync_angestossen_eckdaten",
        "sync_angestossen_kalender",
      ]),
    );
  });

  test("ohne Starter antwortet der Knopf mit 501", async () => {
    const antwort = await app.request("/api/v1/admin/system/syncs/kalender", {
      method: "POST",
      headers: admin.headers,
    });
    expect(antwort.status).toBe(501);
  });
});
