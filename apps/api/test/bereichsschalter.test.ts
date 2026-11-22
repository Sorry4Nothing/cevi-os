import { and, eq, inArray } from "drizzle-orm";
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
import {
  bereichVon,
  erstelleSchalterZustand,
  type SchalterZustand,
} from "../src/bereichsschalter.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { legeWebmasterAn } from "../src/plattform.js";
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
  schalteZweitenFaktorEin,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const zustand = erstelleSchalterZustand();
const baueApp = (schalter: SchalterZustand, verbindung = db, roh = sql) =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql: roh,
    db: verbindung,
    auth,
    seiten: ladeSeiten(),
    schalter,
  });
const app = baueApp(zustand);
// Ein eigener Client zählt die Abfragen: Eine Anfrage in einem Bereich in Wartung darf nicht mehr fragen als ohne
const abfragen: string[] = [];
const zaehlSql = postgres(API_URL, {
  debug: (_verbindung, abfrage) => {
    abfragen.push(abfrage);
  },
});
const zaehlApp = baueApp(zustand, erstelleDb(zaehlSql), zaehlSql);
afterAll(() => Promise.all([sql.end(), zaehlSql.end()]));

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let eltern: PersonaKonto;
let slA: PersonaKonto;
let demoEltern: PersonaKonto;
let demoAdmin: PersonaKonto;
let entwickler: PersonaKonto;
let webmaster: PersonaKonto;
let webmasterMitRecht: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  await legeWebmasterAn(db, welt.testabteilungId);
  await legeWebmasterAn(db, welt.demoAbteilungId);
  [admin, adminOhne, eltern, slA, demoEltern, demoAdmin] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "adminOhneZweitenFaktor"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "demoEltern"),
    legePersonaAn(welt, "demoAdmin"),
  ]);
  const mitFaktor = async (persona: Persona) =>
    schalteZweitenFaktorEin(welt, await legePersonaAn(welt, persona));
  [entwickler, webmaster, webmasterMitRecht] = await Promise.all([
    mitFaktor("leitendeA"),
    mitFaktor("leitendeA"),
    mitFaktor("leitendeA"),
  ]);
  await db
    .insert(schema.plattformEntwickler)
    .values({ userId: entwickler.id! });
  const [vorgabe] = await db
    .select({ id: schema.plattformRolle.id })
    .from(schema.plattformRolle)
    .where(
      and(
        eq(schema.plattformRolle.abteilungId, welt.testabteilungId),
        eq(schema.plattformRolle.schluessel, "webmaster"),
      ),
    );
  const [rolle] = await db
    .insert(schema.plattformRolle)
    .values({ abteilungId: welt.testabteilungId, name: "Wartung Website" })
    .returning({ id: schema.plattformRolle.id });
  await db.insert(schema.plattformRolleRecht).values(
    ["seiten.bearbeiten", "wartungsmodus.website"].map((recht) => ({
      rolleId: rolle.id,
      recht,
    })),
  );
  await db.insert(schema.personPlattformRolle).values([
    { userId: webmaster.id!, rolleId: vorgabe.id },
    { userId: webmasterMitRecht.id!, rolleId: rolle.id },
  ]);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  ausgabe.mockRestore();
  // Jeder Test beginnt ohne Schalter
  await db
    .delete(schema.bereichsschalter)
    .where(
      inArray(schema.bereichsschalter.abteilungId, [
        welt.testabteilungId,
        welt.demoAbteilungId,
      ]),
    );
  await zustand.lade(db);
});

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const schalte = (
  konto: PersonaKonto,
  bereich: string,
  body: Record<string, unknown> = {},
) =>
  anfrage(konto, "PUT", "/api/v1/plattform/schalter", {
    art: "wartung",
    bereich,
    ...body,
  });
const hebeAuf = (konto: PersonaKonto, bereich: string) =>
  anfrage(
    konto,
    "DELETE",
    `/api/v1/plattform/schalter?art=wartung&bereich=${bereich}`,
  );

// Eine schreibende Anfrage je Bereich, die ohne Wartung an der Route scheitert (400, 403, 404), nie an der Wartung
const SCHREIBEN: Record<string, [string, string, unknown]> = {
  lager: ["POST", "/api/v1/lager/x/aenderungen", {}],
  chat: ["POST", "/api/v1/chats/direkt", {}],
  programme: ["PUT", "/api/v1/programme/x/teilnahme", {}],
  verwaltung: ["POST", "/api/v1/admin/tags", {}],
  website: ["PUT", "/api/v1/redaktion/seiten/x/entwurf", {}],
  alles: ["POST", "/api/v1/push-token", {}],
};
const schreibe = (konto: PersonaKonto, bereich: string) => {
  const [methode, pfad, body] = SCHREIBEN[bereich]!;
  return anfrage(konto, methode, pfad, body);
};

describe("Zuordnung von Pfaden zu Bereichen", () => {
  test.each([
    ["/api/v1/lager", "lager"],
    ["/api/v1/lager/abc/aufgaben", "lager"],
    ["/api/v1/admin/lager", "lager"],
    ["/api/v1/admin/lager-dateien/x", "lager"],
    ["/api/v1/chats/direkt", "chat"],
    ["/api/v1/programme/x", "programme"],
    ["/api/v1/termine/mein", "programme"],
    ["/api/v1/admin/termine/warnungen", "programme"],
    ["/api/v1/redaktion/seiten", "website"],
    ["/api/v1/website/inhalt", "website"],
    ["/api/v1/medien/x", "website"],
    ["/api/v1/admin/medien", "website"],
    ["/api/v1/admin/tags", "verwaltung"],
    ["/api/v1/admin/plattform/rollen", "verwaltung"],
    ["/api/v1/ich", null],
    ["/api/v1/push-token", null],
    ["/api/v1/plattform/schalter", null],
    ["/api/v1/lagerhaus", null],
  ])("%s gehört zu %s", (pfad, bereich) => {
    expect(bereichVon(pfad)).toBe(bereich);
  });
});

describe("Wartungsmodus: Wirkung", () => {
  test("ohne Schalter läuft alles", async () => {
    expect((await schreibe(eltern, "chat")).status).not.toBe(503);
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(200);
  });

  test("Lesen geht, Schreiben antwortet 503 mit Hinweis und Ende, andere Bereiche laufen", async () => {
    const ende = "2026-11-23T20:00:00.000Z";
    const antwort = await schalte(admin, "lager", {
      hinweis: "Das Lager ist bis 21 Uhr in Wartung.",
      ende,
    });
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({
      art: "wartung",
      bereich: "lager",
      hinweis: "Das Lager ist bis 21 Uhr in Wartung.",
      ende,
      ausgeloestVon: admin.id,
    });

    const lesen = await anfrage(eltern, "GET", "/api/v1/lager");
    expect(lesen.status).toBe(200);
    for (const [methode, body] of [
      ["POST", {}],
      ["PUT", {}],
      ["PATCH", {}],
      ["DELETE", undefined],
    ] as const) {
      const schreiben = await anfrage(
        eltern,
        methode,
        "/api/v1/lager/x/aenderungen",
        body,
      );
      expect(schreiben.status, methode).toBe(503);
      expect(await schreiben.json()).toEqual({
        code: "IN_WARTUNG",
        message: expect.stringContaining("in Wartung"),
        hinweis: "Das Lager ist bis 21 Uhr in Wartung.",
        ende,
      });
    }
    // Ein anderer Bereich und eine andere Abteilung laufen weiter
    expect((await schreibe(eltern, "chat")).status).not.toBe(503);
    expect(
      (await anfrage(demoEltern, "POST", "/api/v1/lager/x/aenderungen", {}))
        .status,
    ).not.toBe(503);
  });

  test.each(["lager", "chat", "programme", "verwaltung"])(
    "%s: Schreiben 503 für Personen ohne feste Rolle, Lesen frei",
    async (bereich) => {
      expect((await schalte(admin, bereich)).status).toBe(200);
      expect((await schreibe(slA, bereich)).status).toBe(503);
      // Hinweis und Ende fehlen: null
      expect(await (await schreibe(slA, bereich)).json()).toMatchObject({
        code: "IN_WARTUNG",
        hinweis: null,
        ende: null,
      });
      // Keiner der anderen Bereiche ist betroffen
      for (const anderer of Object.keys(SCHREIBEN).filter(
        (b) => b !== bereich && b !== "alles",
      )) {
        expect(
          (await schreibe(admin, anderer)).status,
          `${bereich} -> ${anderer}`,
        ).not.toBe(503);
      }
    },
  );

  test("Website: auch die Bearbeitungsansichten sind gesperrt, das Panel (ich) bleibt lesbar", async () => {
    expect((await schalte(admin, "website")).status).toBe(200);
    expect(
      (await anfrage(webmaster, "GET", "/api/v1/redaktion/seiten")).status,
    ).toBe(503);
    expect((await schreibe(webmaster, "website")).status).toBe(503);
    expect(
      (await anfrage(webmaster, "GET", "/api/v1/redaktion/ich")).status,
    ).toBe(200);
    // Die Abteilungsleitung arbeitet weiter
    expect(
      (await anfrage(admin, "GET", "/api/v1/redaktion/seiten")).status,
    ).toBe(200);
  });

  test("alles: jede schreibende Anfrage im API, Lesen und die Anmeldung gehen", async () => {
    expect((await schalte(admin, "alles")).status).toBe(200);
    for (const bereich of Object.keys(SCHREIBEN)) {
      expect((await schreibe(eltern, bereich)).status, bereich).toBe(503);
    }
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(200);
    expect((await anfrage(eltern, "GET", "/api/v1/ich")).status).toBe(200);
    // Anmelden schreibt eine Sitzung und bleibt trotzdem möglich: Es liegt nicht unter /api/v1
    const anmeldung = await app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "expo-origin": APP,
        "x-forwarded-for": zufallsIp(),
      },
      body: JSON.stringify({
        username: eltern.benutzername,
        password: eltern.passwort,
      }),
    });
    expect(anmeldung.status).toBe(200);
    // Der Healthcheck antwortet immer, nie mit der Wartung
    const health = await app.request("/health");
    expect(await health.text()).not.toContain("IN_WARTUNG");
  });

  test("Abteilungsleitung und Entwickler kommen durch, auch zur Verwaltung", async () => {
    expect((await schalte(admin, "alles")).status).toBe(200);
    for (const bereich of Object.keys(SCHREIBEN)) {
      for (const konto of [admin, entwickler]) {
        expect(
          (await schreibe(konto, bereich)).status,
          `${bereich} ${konto === admin ? "admin" : "entwickler"}`,
        ).not.toBe(503);
      }
    }
    // Die Verwaltung der Abteilungsleitung bleibt erreichbar
    expect((await anfrage(admin, "GET", "/api/v1/admin/personen")).status).toBe(
      200,
    );
  });

  test("Webmaster kommt in der Wartung der Website nicht durch", async () => {
    expect((await schalte(admin, "website")).status).toBe(200);
    expect((await schreibe(webmasterMitRecht, "website")).status).toBe(503);
  });

  test("Aufheben wirkt sofort", async () => {
    await schalte(admin, "chat", { hinweis: "Kurz" });
    expect((await schreibe(eltern, "chat")).status).toBe(503);
    const aufgehoben = await hebeAuf(admin, "chat");
    expect(aufgehoben.status).toBe(204);
    expect((await schreibe(eltern, "chat")).status).not.toBe(503);
    // Was nicht gesetzt ist, lässt sich nicht aufheben
    expect((await hebeAuf(admin, "chat")).status).toBe(404);
  });

  test("Setzen ersetzt Hinweis und Ende; es bleibt ein Eintrag", async () => {
    await schalte(admin, "chat", { hinweis: "Eins" });
    await schalte(admin, "chat", { hinweis: "Zwei", ende: null });
    const antwort = await anfrage(admin, "GET", "/api/v1/plattform/schalter");
    const { schalter } = (await antwort.json()) as {
      schalter: { bereich: string; hinweis: string }[];
    };
    expect(schalter).toHaveLength(1);
    expect(schalter[0]).toMatchObject({ bereich: "chat", hinweis: "Zwei" });
    expect((await schreibe(eltern, "chat")).status).toBe(503);
    const zeilen = await db
      .select()
      .from(schema.bereichsschalter)
      .where(eq(schema.bereichsschalter.abteilungId, welt.testabteilungId));
    expect(zeilen).toHaveLength(1);
  });
});

describe("Wartungsmodus: wer schalten darf", () => {
  test("ohne Sitzung 401; Eltern, Stufenleitung und Webmaster ohne Recht 403", async () => {
    const ohne = await app.request("/api/v1/plattform/schalter", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(ohne.status).toBe(401);
    for (const konto of [eltern, slA, webmaster]) {
      for (const bereich of ["lager", "website"]) {
        const antwort = await schalte(konto, bereich);
        expect(antwort.status, bereich).toBe(403);
        expect(await antwort.json()).toMatchObject({
          code: "KEINE_BERECHTIGUNG",
        });
        expect((await hebeAuf(konto, bereich)).status).toBe(403);
      }
      expect(
        (await anfrage(konto, "GET", "/api/v1/plattform/schalter")).status,
      ).toBe(403);
    }
    expect(zustand.leer()).toBe(true);
  });

  test("ohne zweiten Faktor 403 ZWEITER_FAKTOR_FEHLT", async () => {
    const antwort = await schalte(adminOhne, "lager");
    // Die Verwaltung der Abteilungsleitung verlangt ihn schon überall; hier gilt es für den Pfad der Plattform
    expect(antwort.status).toBe(403);
    expect(await antwort.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    expect(zustand.leer()).toBe(true);
  });

  test("Webmaster mit dem Recht darf die Wartung der Website, aber keinen anderen Bereich", async () => {
    expect((await schalte(webmasterMitRecht, "lager")).status).toBe(403);
    expect((await schalte(webmasterMitRecht, "alles")).status).toBe(403);
    const ok = await schalte(webmasterMitRecht, "website", {
      hinweis: "Seiten werden umgebaut.",
    });
    expect(ok.status).toBe(200);
    expect((await schreibe(slA, "website")).status).toBe(503);
    expect((await hebeAuf(webmasterMitRecht, "website")).status).toBe(204);
    expect((await schreibe(slA, "website")).status).not.toBe(503);
  });

  test("Entwickler darf jeden Bereich", async () => {
    for (const bereich of Object.keys(SCHREIBEN)) {
      expect((await schalte(entwickler, bereich)).status, bereich).toBe(200);
      expect((await hebeAuf(entwickler, bereich)).status, bereich).toBe(204);
    }
  });

  test("Zustand lesen: Abteilungsleitung und Entwickler alles der eigenen Abteilung, Webmaster mit Recht nur die Website", async () => {
    await schalte(admin, "lager");
    await schalte(admin, "website");
    await schalte(demoAdmin, "chat");
    const lies = async (konto: PersonaKonto) =>
      (
        (await (
          await anfrage(konto, "GET", "/api/v1/plattform/schalter")
        ).json()) as { schalter: { bereich: string }[] }
      ).schalter
        .map((s) => s.bereich)
        .sort();
    expect(await lies(admin)).toEqual(["lager", "website"]);
    expect(await lies(entwickler)).toEqual(["lager", "website"]);
    expect(await lies(webmasterMitRecht)).toEqual(["website"]);
    expect(await lies(demoAdmin)).toEqual(["chat"]);
  });

  test("Eingabe: unbekannter Bereich, noch nicht schaltbare Art, leerer Hinweis, falsches Ende, fremdes Feld", async () => {
    expect((await schalte(admin, "keller")).status).toBe(400);
    expect(
      (
        await anfrage(admin, "PUT", "/api/v1/plattform/schalter", {
          art: "sperre",
          bereich: "lager",
        })
      ).status,
    ).toBe(400);
    expect((await schalte(admin, "lager", { hinweis: "" })).status).toBe(400);
    expect(
      (await schalte(admin, "lager", { hinweis: "x".repeat(501) })).status,
    ).toBe(400);
    expect((await schalte(admin, "lager", { ende: "morgen" })).status).toBe(
      400,
    );
    expect((await schalte(admin, "lager", { sperre: true })).status).toBe(400);
    expect(zustand.leer()).toBe(true);
  });

  test("jede Schaltung steht im Audit-Log, ohne den Hinweistext", async () => {
    await schalte(admin, "chat", { hinweis: "Geheimer Text" });
    await schalte(admin, "chat", { hinweis: "Anderer Text" });
    await hebeAuf(admin, "chat");
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.akteurId, admin.id!),
          eq(schema.auditLog.zielTyp, "bereichsschalter"),
        ),
      )
      .orderBy(schema.auditLog.erstelltAm);
    expect(zeilen.map((z) => z.aktion)).toEqual([
      "schalter_gesetzt",
      "schalter_geaendert",
      "schalter_aufgehoben",
    ]);
    expect(zeilen[0]).toMatchObject({
      abteilungId: welt.testabteilungId,
      details: { art: "wartung", bereich: "chat", ende: null },
    });
    expect(JSON.stringify(zeilen)).not.toContain("Text");
  });
});

describe("Wartungsmodus: Zustand im Speicher", () => {
  test("er überlebt einen Neustart: Laden aus der Datenbank", async () => {
    await schalte(admin, "chat", { hinweis: "Nach dem Neustart noch da" });
    const neu = erstelleSchalterZustand();
    expect(neu.leer()).toBe(true);
    await neu.lade(db);
    expect(neu.trifft(welt.testabteilungId, "chat", "wartung")).toMatchObject({
      hinweis: "Nach dem Neustart noch da",
    });
    const antwort = await baueApp(neu).request("/api/v1/chats/direkt", {
      method: "POST",
      headers: { ...eltern.headers, "content-type": "application/json" },
      body: "{}",
    });
    expect(antwort.status).toBe(503);
  });

  test("eine Anfrage in einem Bereich in Wartung fragt die Datenbank nicht mehr als ohne", async () => {
    const lesen = async () => {
      abfragen.length = 0;
      const antwort = await zaehlApp.request("/api/v1/chats", {
        headers: eltern.headers,
      });
      expect(antwort.status).toBe(200);
      return abfragen.length;
    };
    await lesen();
    const ohne = await lesen();
    await schalte(admin, "chat");
    expect(await lesen()).toBe(ohne);
    // Auch eine gesperrte Schreibanfrage einer Person ohne feste Rolle: nur die Prüfung auf den Entwickler kommt dazu
    abfragen.length = 0;
    const schreiben = await zaehlApp.request("/api/v1/chats/direkt", {
      method: "POST",
      headers: { ...eltern.headers, "content-type": "application/json" },
      body: "{}",
    });
    expect(schreiben.status).toBe(503);
    expect(abfragen.length).toBeLessThanOrEqual(ohne + 1);
  });
});
