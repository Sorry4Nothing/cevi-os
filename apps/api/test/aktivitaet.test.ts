import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
} from "vitest";
import {
  erstelleAktivitaetsprotokoll,
  loescheAlteAktivitaet,
  systemzeileAus,
} from "../src/aktivitaet.js";
import { objektVon, bereichVon, geraetVon } from "../src/aktivitaet-middleware.js";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  APP,
  bereiteAuthTestsVor,
  erstelleTestAuth,
  zufallsIp,
} from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql_ = postgres(API_URL);
const db = erstelleDb(sql_);
const auth = erstelleTestAuth(db);
const protokoll = erstelleAktivitaetsprotokoll(db, { taktMs: null });
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql: sql_,
  db,
  auth,
  seiten: ladeSeiten(),
  aktivitaet: protokoll,
});
afterAll(async () => {
  protokoll.stopp();
  await sql_.end();
});

let welt: Welt;
let admin: PersonaKonto;
let entwickler: PersonaKonto;
let entwicklerDemo: PersonaKonto;
let sl: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  admin = await legePersonaAn(welt, "admin");
  entwickler = await legePersonaMitFaktorAn(welt, "leitendeA");
  entwicklerDemo = await legePersonaMitFaktorAn(welt, "demoEltern");
  sl = await legePersonaAn(welt, "slA");
  await db
    .insert(schema.plattformEntwickler)
    .values([{ userId: entwickler.id! }, { userId: entwicklerDemo.id! }]);
});

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(pfad, {
    method: methode,
    // Wie ein Client: mit Länge, sonst liest die Middleware die Namen der Felder nicht
    headers: body
      ? {
          ...konto.headers,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(JSON.stringify(body))),
        }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

// Alles aus dem Puffer in die Tabelle, dann die Zeilen einer Person (neu zuerst)
async function zeilenVon(userId: string) {
  await protokoll.leere();
  return db
    .select()
    .from(schema.aktivitaet)
    .where(eq(schema.aktivitaet.userId, userId))
    .orderBy(sql`${schema.aktivitaet.zeit} desc, ${schema.aktivitaet.id} desc`);
}

describe("Hilfsfunktionen", () => {
  test("Objekt: nur UUIDs aus dem Pfad, mit dem Wort davor; andere Werte nie", () => {
    const id = randomUUID();
    const user = randomUUID();
    expect(
      objektVon(
        "/api/v1/admin/tags/:id/personen/:userId",
        `/api/v1/admin/tags/${id}/personen/${user}`,
      ),
    ).toEqual({ objektTyp: "personen", objektId: user });
    expect(
      objektVon(
        "/api/v1/termine/kalender/:token",
        "/api/v1/termine/kalender/geheim-token",
      ),
    ).toBeUndefined();
  });

  test("Bereich aus dem Muster", () => {
    expect(bereichVon("/api/v1/admin/personen/:id")).toBe("personen");
    expect(bereichVon("/api/v1/redaktion/seiten")).toBe("website");
    expect(bereichVon("/api/v1/lager/:id/aufgaben")).toBe("lager");
    expect(bereichVon("/api/auth/sign-out")).toBe("anmeldung");
  });

  test("Gerät: nur die Familie", () => {
    expect(
      geraetVon(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      ),
    ).toBe("Chrome");
    expect(geraetVon(undefined)).toBeUndefined();
  });

  test("Systemzeile: Nullläufe bleiben weg, Zahl und Code kommen mit", async () => {
    const eigene = erstelleAktivitaetsprotokoll(db, { taktMs: null });
    const name = `testlauf_${randomUUID().slice(0, 8)}`;
    systemzeileAus(eigene, { ereignis: name, geloescht: 0 });
    systemzeileAus(eigene, { ereignis: `${name}_a`, geloescht: 7, token: "x" });
    systemzeileAus(eigene, { ereignis: `${name}_b`, code: "ECONN", geloescht: 0 });
    systemzeileAus(eigene, { ereignis: "health", code: "x" });
    await eigene.leere();
    const zeilen = await db
      .select()
      .from(schema.aktivitaet)
      .where(sql`${schema.aktivitaet.aktion} like ${`${name}%`}`);
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([`${name}_a`, `${name}_b`]);
    const a = zeilen.find((z) => z.aktion === `${name}_a`)!;
    expect(a).toMatchObject({ art: "system", anzahl: 7, ergebnis: "erfolg" });
    expect(JSON.stringify(a)).not.toContain('"x"');
    expect(zeilen.find((z) => z.aktion === `${name}_b`)).toMatchObject({
      ergebnis: "fehler",
      fehlerCode: "ECONN",
    });
    eigene.stopp();
  });
});

describe("Middleware", () => {
  test("eine Schreibaktion: Benutzerstempel, Muster, Feldnamen, keine Inhalte", async () => {
    const benutzername = `person.${randomUUID().slice(0, 8)}`;
    const antwort = await anfrage(admin, "POST", "/api/v1/admin/personen", {
      vorname: "Geheimvorname",
      nachname: "Geheimnachname",
      benutzername,
      admin: false,
      rollen: [],
      elternteilVon: [],
    });
    expect(antwort.status).toBe(201);
    const zeilen = await zeilenVon(admin.id!);
    const z = zeilen.find((r) => r.art === "aktion")!;
    expect(z).toMatchObject({
      aktion: "POST /api/v1/admin/personen",
      methode: "POST",
      bereich: "personen",
      status: 201,
      ergebnis: "erfolg",
      akteur: "person",
      abteilungId: welt.testabteilungId,
      felder: [
        "admin",
        "benutzername",
        "elternteilVon",
        "nachname",
        "rollen",
        "vorname",
      ],
    });
    expect(z.rollen).toContain("abteilungsleitung");
    expect(z.name).toBeTruthy();
    expect(z.dauerMs).toBeGreaterThanOrEqual(0);
    expect(z.anfrageId).toBeTruthy();
    // Nichts vom Inhalt: weder Namen noch Benutzername noch Passwort
    const alles = JSON.stringify(zeilen);
    for (const geheim of ["Geheimvorname", "Geheimnachname", benutzername]) {
      expect(alles).not.toContain(geheim);
    }
    // Die bestehende Audit-Zeile erscheint zusätzlich als Zeile «audit»
    expect(zeilen.some((r) => r.art === "audit" && r.aktion === "person_angelegt")).toBe(true);
  });

  test("Fehlerfall: Status, Code und Objekt aus dem Pfad", async () => {
    const id = randomUUID();
    const antwort = await anfrage(admin, "PATCH", `/api/v1/admin/personen/${id}`, {
      admin: true,
    });
    expect(antwort.status).toBe(404);
    const z = (await zeilenVon(admin.id!)).find(
      (r) => r.aktion === "PATCH /api/v1/admin/personen/:id",
    );
    expect(z).toMatchObject({
      aktion: "PATCH /api/v1/admin/personen/:id",
      status: 404,
      ergebnis: "fehler",
      fehlerCode: "NICHT_GEFUNDEN",
      objektTyp: "personen",
      objektId: id,
      felder: ["admin"],
    });
  });

  test("ohne Anmeldung: anonym, mit gekürztem Hash der IP statt der IP", async () => {
    const ip = zufallsIp();
    const antwort = await app.request("/api/v1/admin/personen", {
      method: "POST",
      headers: {
        "x-forwarded-for": ip,
        "content-type": "application/json",
        "content-length": "7",
        "user-agent": "Mozilla/5.0 Firefox/120.0",
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(antwort.status).toBe(401);
    await protokoll.leere();
    const zeilen = await db
      .select()
      .from(schema.aktivitaet)
      .where(
        and(
          eq(schema.aktivitaet.status, 401),
          eq(schema.aktivitaet.herkunft, protokoll.herkunft(ip)!),
        ),
      );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      akteur: "anonym",
      userId: null,
      geraet: "Firefox",
      fehlerCode: "NICHT_ANGEMELDET",
    });
    expect(zeilen[0]!.herkunft).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(zeilen)).not.toContain(ip);
  });

  test("lesende Anfragen: nur der Zugriff auf Kinder- und Exportdaten", async () => {
    const vorher = (await zeilenVon(admin.id!)).length;
    expect((await anfrage(admin, "GET", "/api/v1/ich")).status).toBe(200);
    expect((await zeilenVon(admin.id!)).length).toBe(vorher);
    expect((await anfrage(admin, "GET", "/api/v1/admin/kinder")).status).toBe(200);
    const z = (await zeilenVon(admin.id!)).find(
      (r) => r.aktion === "GET /api/v1/admin/kinder",
    );
    expect(z).toMatchObject({
      art: "zugriff",
      aktion: "GET /api/v1/admin/kinder",
      ergebnis: "erfolg",
    });
  });

  test("Anmeldung: Erfolg mit Person, Fehlschlag mit Konto und innerem Grund, Abmelden", async () => {
    const konto = await legePersonaAn(welt, "leitendeA");
    const kopf = () => ({
      "expo-origin": APP,
      "content-type": "application/json",
      "x-forwarded-for": zufallsIp(),
    });
    const falsch = await app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: kopf(),
      body: JSON.stringify({ username: konto.benutzername, password: "falsch-falsch-1" }),
    });
    expect(falsch.status).toBe(401);
    const ok = await app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: kopf(),
      body: JSON.stringify({ username: konto.benutzername, password: konto.passwort }),
    });
    expect(ok.status).toBe(200);
    const cookie = ok.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const aus = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { ...kopf(), cookie },
      body: "{}",
    });
    expect(aus.status).toBe(200);
    const zeilen = (await zeilenVon(konto.id!)).filter((z) => z.art === "anmeldung");
    expect(zeilen.map((z) => [z.aktion, z.status, z.fehlerCode]).reverse()).toEqual([
      ["POST /api/auth/sign-in/username", 401, "INVALID_USERNAME_OR_PASSWORD"],
      ["POST /api/auth/sign-in/username", 200, null],
      ["POST /api/auth/sign-out", 200, null],
    ]);
    // Weder Benutzername noch Passwort stehen irgendwo
    const alles = JSON.stringify(zeilen);
    expect(alles).not.toContain(konto.benutzername!);
    expect(alles).not.toContain("falsch-falsch");
  });

  test("Puffer: über der Grenze fallen Zeilen weg, die Lücke steht als Systemzeile", async () => {
    const klein = erstelleAktivitaetsprotokoll(db, { taktMs: null, maxPuffer: 3 });
    const marke = `puffer_${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 10; i++) {
      klein.erfasse({
        zeit: new Date(),
        art: "system",
        akteur: "system",
        aktion: marke,
        bereich: "test",
        ergebnis: "erfolg",
      });
    }
    expect(klein.zaehler()).toMatchObject({ puffer: 3, verworfen: 7 });
    await klein.leere();
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aktivitaet)
      .where(eq(schema.aktivitaet.aktion, marke));
    expect(n).toBe(3);
    // Die Lücke ist sichtbar
    expect(klein.zaehler().verworfen).toBe(7);
    klein.stopp();
  });

  test("anonyme Flut: je Minute nur die ersten Zeilen", async () => {
    const klein = erstelleAktivitaetsprotokoll(db, {
      taktMs: null,
      maxAnonymProMinute: 5,
    });
    for (let i = 0; i < 20; i++) {
      klein.erfasse({
        zeit: new Date(),
        art: "aktion",
        akteur: "anonym",
        aktion: "POST /api/v1/x",
        bereich: "x",
        ergebnis: "fehler",
      });
    }
    expect(klein.zaehler()).toMatchObject({ puffer: 5, verworfen: 15 });
    klein.stopp();
  });

  test("ein Datenbankfehler beim Schreiben lässt nichts scheitern", async () => {
    const kaputt = erstelleAktivitaetsprotokoll(db, { taktMs: null });
    // Zu lange Zeichenkette in einem Feld mit CHECK: Der Batch scheitert
    kaputt.erfasse({
      zeit: new Date(),
      art: "aktion",
      akteur: "person",
      geraet: "x".repeat(100),
      aktion: "POST /x",
      bereich: "x",
      ergebnis: "erfolg",
    });
    await expect(kaputt.leere()).resolves.toBeUndefined();
    expect(kaputt.zaehler().verworfen).toBeGreaterThanOrEqual(1);
    kaputt.stopp();
  });

  test("Trigger: eine Audit-Zeile wird eine Zeile «audit» mit Feldnamen, ohne Werte", async () => {
    const aktion = `test_${randomUUID().slice(0, 8)}`;
    const ziel = randomUUID();
    await db.insert(schema.auditLog).values({
      abteilungId: welt.testabteilungId,
      akteurId: admin.id!,
      aktion,
      zielTyp: "person",
      zielId: ziel,
      details: { rolle: "geheimwert", anzahl: 3 },
    });
    const [z] = await db
      .select()
      .from(schema.aktivitaet)
      .where(eq(schema.aktivitaet.aktion, aktion));
    expect(z).toMatchObject({
      art: "audit",
      userId: admin.id,
      objektTyp: "person",
      objektId: ziel,
      felder: ["anzahl", "rolle"],
    });
    expect(z!.name).toBeTruthy();
    expect(JSON.stringify(z)).not.toContain("geheimwert");
  });
});

describe("Aufbewahrung", () => {
  test("die API-Rolle kann nicht ändern oder löschen", async () => {
    const [z] = await db
      .insert(schema.aktivitaet)
      .values({ art: "system", aktion: "test_fest", bereich: "test", ergebnis: "erfolg" })
      .returning({ id: schema.aktivitaet.id });
    await expect(
      db.update(schema.aktivitaet).set({ aktion: "x" }).where(eq(schema.aktivitaet.id, z!.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(schema.aktivitaet).where(eq(schema.aktivitaet.id, z!.id)),
    ).rejects.toThrow();
  });

  test("nach der Frist wird gelöscht, nicht davor; unter 7 Tagen nie", async () => {
    const marke = `frist_${randomUUID().slice(0, 8)}`;
    const vor = (tage: number) => new Date(Date.now() - tage * 86_400_000);
    await db.insert(schema.aktivitaet).values(
      [100, 91, 89, 3].map((t) => ({
        zeit: vor(t),
        art: "system" as const,
        aktion: marke,
        bereich: "test",
        ergebnis: "erfolg" as const,
        anzahl: t,
      })),
    );
    const gelesen = async () =>
      (
        await db
          .select({ t: schema.aktivitaet.anzahl })
          .from(schema.aktivitaet)
          .where(eq(schema.aktivitaet.aktion, marke))
      )
        .map((r) => r.t)
        .sort();
    await loescheAlteAktivitaet(db, { tage: 90, maxZeilen: 500_000 });
    expect(await gelesen()).toEqual([3, 89]);
    // Eine Frist unter 7 Tagen gilt als 7: Die drei Tage alte Zeile bleibt
    await loescheAlteAktivitaet(db, { tage: 0, maxZeilen: 500_000 });
    expect(await gelesen()).toEqual([3, 89].filter((t) => t < 7));
  });

  test("über der Obergrenze fallen die ältesten weg (Untergrenze 10000)", async () => {
    const marke = `flut_${randomUUID().slice(0, 8)}`;
    await db.execute(sql`insert into aktivitaet (art, aktion, bereich, ergebnis)
      select 'system', ${marke}, 'test', 'erfolg' from generate_series(1, 10050)`);
    const geloescht = await loescheAlteAktivitaet(db, { tage: 365, maxZeilen: 1 });
    expect(geloescht).toBeGreaterThanOrEqual(50);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aktivitaet);
    expect(n).toBeLessThanOrEqual(10_000);
  });
});

describe("GET /api/v1/admin/protokoll", () => {
  const BASIS = "/api/v1/admin/protokoll";
  type Liste = {
    eintraege: {
      id: string;
      zeit: string;
      art: string;
      aktion: string;
      titel: string;
      bereich: string;
      ergebnis: string;
      benutzer: { id: string | null; name: string | null; rollen: string[] };
      objekt: { typ: string; id: string } | null;
      felder: string[] | null;
    }[];
    weitere: boolean;
    naechste: string | null;
  };
  const liste = async (konto: PersonaKonto, abfrage = "") => {
    const antwort = await anfrage(konto, "GET", `${BASIS}${abfrage}`);
    return { status: antwort.status, body: (await antwort.json()) as Liste };
  };

  let seed: string;
  beforeAll(async () => {
    seed = randomUUID().slice(0, 8);
    const user = entwickler.id!;
    await db.insert(schema.aktivitaet).values(
      Array.from({ length: 7 }, (_, i) => ({
        zeit: new Date(Date.now() - i * 60_000),
        art: "aktion" as const,
        abteilungId: welt.testabteilungId,
        userId: user,
        akteur: "person" as const,
        name: `Name ${seed}`,
        rollen: ["leitung"],
        methode: "PATCH",
        aktion: `PATCH /api/v1/admin/seed${seed}/:id`,
        bereich: `seed${seed}`,
        objektTyp: "seed",
        objektId: i === 0 ? "00000000-0000-4000-8000-000000000001" : undefined,
        status: i % 3 === 0 ? 500 : 204,
        ergebnis: i % 3 === 0 ? ("fehler" as const) : ("erfolg" as const),
      })),
    );
    // Eine Zeile der anderen Abteilung
    await db.insert(schema.aktivitaet).values({
      art: "aktion",
      abteilungId: welt.demoAbteilungId,
      aktion: `PATCH /api/v1/admin/fremd${seed}`,
      bereich: `seed${seed}`,
      ergebnis: "erfolg",
    });
  });

  test("Entwickler mit zweitem Faktor liest; der Zugriff steht selbst im Protokoll", async () => {
    const { status, body } = await liste(entwickler, `?bereich=seed${seed}`);
    expect(status).toBe(200);
    expect(body.eintraege).toHaveLength(7);
    expect(body.eintraege[0]).toMatchObject({
      art: "aktion",
      benutzer: { id: entwickler.id, name: `Name ${seed}`, rollen: ["leitung"] },
    });
    const zugriffe = (await zeilenVon(entwickler.id!)).filter(
      (z) => z.art === "zugriff" && z.aktion === `GET ${BASIS}`,
    );
    expect(zugriffe.length).toBeGreaterThan(0);
  });

  test("alle anderen: Abteilungsleitung, Stufenleitung 403, ohne Anmeldung 401", async () => {
    expect((await anfrage(admin, "GET", BASIS)).status).toBe(403);
    expect((await anfrage(sl, "GET", BASIS)).status).toBe(403);
    expect((await anfrage(admin, "GET", `${BASIS}/verlauf`)).status).toBe(403);
    expect((await anfrage(admin, "GET", `${BASIS}/export.csv`)).status).toBe(403);
    expect((await anfrage(admin, "GET", `${BASIS}/${randomUUID()}`)).status).toBe(403);
    const ohne = await app.request(BASIS);
    expect(ohne.status).toBe(401);
  });

  test("Entwickler ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT", async () => {
    const konto = await legePersonaAn(welt, "leitendeB");
    await db.insert(schema.plattformEntwickler).values({ userId: konto.id! });
    const antwort = await anfrage(konto, "GET", BASIS);
    expect(antwort.status).toBe(403);
    expect(await antwort.json()).toMatchObject({ code: "ZWEITER_FAKTOR_FEHLT" });
  });

  test("nur die eigene Abteilung; Detail einer fremden Zeile ist 404", async () => {
    const eigene = await liste(entwickler, `?bereich=seed${seed}`);
    expect(eigene.body.eintraege.some((e) => e.aktion.includes("fremd"))).toBe(false);
    const fremde = await liste(entwicklerDemo, `?bereich=seed${seed}`);
    expect(fremde.body.eintraege.map((e) => e.aktion)).toEqual([
      `PATCH /api/v1/admin/fremd${seed}`,
    ]);
    const id = eigene.body.eintraege[0]!.id;
    expect((await anfrage(entwicklerDemo, "GET", `${BASIS}/${id}`)).status).toBe(404);
    const detail = await anfrage(entwickler, "GET", `${BASIS}/${id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id, bereich: `seed${seed}` });
  });

  test("Filter: Ergebnis, Benutzer (Kennung und Namensteil), Objekt, Freitext, Art, Zeitraum", async () => {
    const b = `bereich=seed${seed}`;
    expect((await liste(entwickler, `?${b}&ergebnis=fehler`)).body.eintraege).toHaveLength(3);
    expect((await liste(entwickler, `?${b}&ergebnis=erfolg`)).body.eintraege).toHaveLength(4);
    expect(
      (await liste(entwickler, `?${b}&benutzer=${entwickler.id}`)).body.eintraege,
    ).toHaveLength(7);
    expect(
      (await liste(entwickler, `?${b}&benutzer=${encodeURIComponent(`name ${seed}`.toUpperCase())}`)).body.eintraege,
    ).toHaveLength(7);
    // % in der Eingabe ist Text, kein Muster
    expect((await liste(entwickler, `?${b}&benutzer=%25`)).body.eintraege).toHaveLength(0);
    expect(
      (await liste(entwickler, `?${b}&objekt=00000000-0000-4000-8000-000000000001`)).body.eintraege,
    ).toHaveLength(1);
    expect((await liste(entwickler, `?${b}&q=seed${seed}`)).body.eintraege).toHaveLength(7);
    expect((await liste(entwickler, `?${b}&q=gibtsnicht`)).body.eintraege).toHaveLength(0);
    expect((await liste(entwickler, `?${b}&art=system`)).body.eintraege).toHaveLength(0);
    const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
    expect(
      (await liste(entwickler, `?${b}&von=${heute}&bis=${heute}`)).body.eintraege.length,
    ).toBeGreaterThan(0);
    expect(
      (await liste(entwickler, `?${b}&von=2020-01-01&bis=2020-01-02`)).body.eintraege,
    ).toHaveLength(0);
  });

  test("Seitenbildung mit Cursor: neu zuerst, ohne Doppelte, Grenzen geprüft", async () => {
    const b = `bereich=seed${seed}`;
    const ids: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const { body } = await liste(entwickler, `?${b}&limit=3${nach ? `&nach=${nach}` : ""}`);
      ids.push(...body.eintraege.map((e) => e.id));
      nach = body.naechste;
      seiten++;
      expect(body.weitere).toBe(nach !== null);
    } while (nach && seiten < 10);
    expect(seiten).toBe(3);
    expect(new Set(ids).size).toBe(7);
    const alle = (await liste(entwickler, `?${b}`)).body.eintraege;
    expect(ids).toEqual(alle.map((e) => e.id));
    const zeiten = alle.map((e) => Date.parse(e.zeit));
    expect(zeiten).toEqual([...zeiten].sort((x, y) => y - x));
    expect((await anfrage(entwickler, "GET", `${BASIS}?limit=101`)).status).toBe(400);
    expect((await anfrage(entwickler, "GET", `${BASIS}?limit=0`)).status).toBe(400);
    expect((await anfrage(entwickler, "GET", `${BASIS}?nach=kaputt`)).status).toBe(400);
    expect((await anfrage(entwickler, "GET", `${BASIS}?unbekannt=1`)).status).toBe(400);
    expect((await anfrage(entwickler, "GET", `${BASIS}?von=gestern`)).status).toBe(400);
  });

  test("Verlauf: lückenlose Säulen und Summe; zu langer Zeitraum 400", async () => {
    const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
    const antwort = await anfrage(
      entwickler,
      "GET",
      `${BASIS}/verlauf?bereich=seed${seed}&einheit=tag&von=${heute}&bis=${heute}`,
    );
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as {
      punkte: { start: string; gesamt: number; fehler: number }[];
      bereiche: { bereich: string; gesamt: number }[];
      summe: { gesamt: number; fehler: number };
    };
    expect(body.punkte).toHaveLength(1);
    expect(body.summe).toEqual({ gesamt: 7, fehler: 3 });
    expect(body.bereiche[0]).toMatchObject({ bereich: `seed${seed}`, gesamt: 7 });
    const stunden = await anfrage(
      entwickler,
      "GET",
      `${BASIS}/verlauf?einheit=stunde&von=${heute}&bis=${heute}`,
    );
    expect(((await stunden.json()) as { punkte: unknown[] }).punkte.length).toBeGreaterThanOrEqual(23);
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}/verlauf?einheit=stunde&von=2026-01-01&bis=2026-03-01`)).status,
    ).toBe(400);
    expect((await anfrage(entwickler, "GET", `${BASIS}/verlauf?von=2026-03-02&bis=2026-03-01`)).status).toBe(400);
  });

  test("Export: CSV ohne Namen, Formeln entschärft, mit Audit-Zeile «protokoll_exportiert»", async () => {
    await db.insert(schema.aktivitaet).values({
      art: "aktion",
      abteilungId: welt.testabteilungId,
      aktion: `POST /api/v1/admin/=cmd${seed}`,
      bereich: `export${seed}`,
      name: "Sichtbarer Name",
      herkunft: "abcdef123456",
      ergebnis: "erfolg",
    });
    const antwort = await anfrage(entwickler, "GET", `${BASIS}/export.csv?bereich=export${seed}`);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/csv");
    const text = await antwort.text();
    const zeilen = text.split("\r\n");
    expect(zeilen[0]).toContain("zeit,art,benutzer_id");
    expect(zeilen).toHaveLength(2);
    expect(text).not.toContain("Sichtbarer Name");
    expect(text).not.toContain("abcdef123456");
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.akteurId, entwickler.id!),
          eq(schema.auditLog.aktion, "protokoll_exportiert"),
        ),
      );
    expect(audit!.details).toEqual({ zeilen: 1 });
    expect(JSON.stringify(audit)).not.toContain(`export${seed}`);
    // Die Formel am Anfang einer Zelle wird entschärft
    const formel = await db
      .insert(schema.aktivitaet)
      .values({ art: "system", abteilungId: welt.testabteilungId, aktion: "=1+1", bereich: `formel${seed}`, ergebnis: "erfolg" })
      .returning();
    expect(formel).toHaveLength(1);
    const csv = await (
      await anfrage(entwickler, "GET", `${BASIS}/export.csv?bereich=formel${seed}`)
    ).text();
    expect(csv.split("\r\n")[1]).toContain(",'=1+1,");
  });

  test("der Server prüft, nicht die Oberfläche: Zeilen der Aktionen der Verwaltung bleiben für andere unsichtbar", async () => {
    // Alle Routen sind hinter derselben Middleware: jede andere Rolle bekommt 403, auch mit gültigem Filter
    const ids = await db
      .select({ id: schema.aktivitaet.id })
      .from(schema.aktivitaet)
      .where(inArray(schema.aktivitaet.userId, [entwickler.id!]))
      .limit(1);
    expect((await anfrage(admin, "GET", `${BASIS}/${ids[0]!.id}`)).status).toBe(403);
  });
});

describe("Routenmuster", () => {
  test("das Muster der ausgeführten Route, nicht einer später passenden (/verlauf vor /:id)", async () => {
    const detail = (await zeilenVon(entwickler.id!)).filter(
      (z) => z.aktion === "GET /api/v1/admin/protokoll/:id",
    ).length;
    expect(
      (await anfrage(entwickler, "GET", "/api/v1/admin/protokoll/verlauf")).status,
    ).toBe(200);
    const danach = await zeilenVon(entwickler.id!);
    expect(danach.filter((z) => z.aktion === "GET /api/v1/admin/protokoll/:id").length).toBe(detail);
  });

  test("unbekannte Pfade: kein Pfad im Protokoll, nur «(unbekannte Route)»", async () => {
    const geheim = `geheim-${randomUUID()}`;
    expect((await anfrage(admin, "POST", `/api/v1/${geheim}`, { a: 1 })).status).toBe(404);
    const zeilen = await zeilenVon(admin.id!);
    const z = zeilen.find((r) => r.aktion === "POST (unbekannte Route)");
    expect(z).toMatchObject({ status: 404, bereich: "sonstiges" });
    expect(JSON.stringify(zeilen)).not.toContain(geheim);
  });
});
