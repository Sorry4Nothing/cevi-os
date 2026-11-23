import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
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
import { Hono } from "hono";
import {
  beschreibungVon,
  sicherDetails,
} from "../src/aktivitaet-beschreibung.js";
import {
  aktivitaetMiddleware,
  bereichVon,
  geraetVon,
  meldeAenderung,
  objektVon,
  type AktivitaetEintrag,
  type AktivitaetSenke,
  type AktivitaetVariablen,
} from "../src/aktivitaet-middleware.js";
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

  test("Systemzeile: nur Ereignisse mit Wirkung; Nullläufe, Fehler, Aufräumläufe und Chat bleiben weg", async () => {
    const eigene = erstelleAktivitaetsprotokoll(db, { taktMs: null });
    systemzeileAus(eigene, { ereignis: "lager_fristen", erinnert: 0 });
    systemzeileAus(eigene, { ereignis: "lager_fristen", erinnert: 4, x: "y" });
    systemzeileAus(eigene, { ereignis: "lager_fristen", code: "ECONN" });
    systemzeileAus(eigene, {
      ereignis: "push_versand",
      typ: "chat",
      gesendet: 9,
    });
    systemzeileAus(eigene, {
      ereignis: "push_versand",
      typ: "programm",
      gesendet: 12,
      token: "geheim",
    });
    systemzeileAus(eigene, { ereignis: "sitzungen", geloescht: 5 });
    systemzeileAus(eigene, { ereignis: "health", code: "x" });
    expect(eigene.zaehler().puffer).toBe(2);
    const marke = Date.now();
    await eigene.leere();
    const zeilen = await db
      .select()
      .from(schema.aktivitaet)
      .where(
        and(
          eq(schema.aktivitaet.art, "system"),
          gte(schema.aktivitaet.zeit, new Date(marke - 5000)),
          inArray(schema.aktivitaet.aktion, [
            "lager_fristen",
            "push_versand:programm",
          ]),
        ),
      );
    expect(zeilen.map((z) => [z.aktion, z.anzahl]).sort()).toEqual([
      ["lager_fristen", 4],
      ["push_versand:programm", 12],
    ]);
    expect(JSON.stringify(zeilen)).not.toContain("geheim");
    expect(
      zeilen.find((z) => z.aktion === "push_versand:programm")?.beschreibung,
    ).toBe("Programm-Erinnerungen per Push versendet (12 Geräte)");
    eigene.stopp();
  });

  test("Satz: Katalog, Name des Objekts, Elternobjekt; ohne Namen allgemein", () => {
    const direkt = {
      art: "aktion",
      aktion: "PATCH /api/v1/admin/rechte/gruppen/:tagId/rollen/:rolleId",
      objektTyp: "rollen",
      objektName: "Kasse",
      aenderung: {
        direkt: true,
        eltern: { typ: "gruppen", id: randomUUID(), name: "OK Kirmes" },
      },
    };
    expect(beschreibungVon(direkt)).toBe(
      "Rolle «Kasse» der Gruppe «OK Kirmes» geändert",
    );
    expect(
      beschreibungVon({
        ...direkt,
        objektName: null,
        aenderung: { direkt: true },
      }),
    ).toBe("Rolle einer Gruppe geändert");
    // Unteraktion: der Katalog, der Ort in Klammern
    expect(
      beschreibungVon({
        art: "aktion",
        aktion: "PUT /api/v1/lager/:id/rechte",
        objektTyp: "lager",
        objektName: "Sommerlager",
      }),
    ).toBe("Rechte der Lagerrollen geändert (Lager «Sommerlager»)");
    // Der Satz der Route geht vor
    expect(
      beschreibungVon({
        art: "aktion",
        aktion: "PATCH /api/v1/admin/tags/:id",
        aenderung: { text: "Eigener Satz" },
      }),
    ).toBe("Eigener Satz");
    expect(
      beschreibungVon({
        art: "sicherheit",
        aktion: "POST /api/auth/sign-in/username",
        anzahl: 5,
      }),
    ).toBe("Anmeldung fehlgeschlagen, 5-mal");
    expect(
      beschreibungVon({ art: "audit", aktion: "entwickler_vergeben" }),
    ).toBe("Entwickler-Recht vergeben");
  });

  test("Details aus dem Audit-Log: Namen von Rechten und einfache Werte, nie Namen, Texte oder Kennungen", () => {
    const aus = sicherDetails({
      hinzu: [{ recht: "anlass.bearbeiten", geltung: "alle" }, "lager.sehen"],
      weg: ["raum.verwalten", "mit Leerzeichen"],
      status: "abgeschlossen",
      anzahl: 3,
      ja: true,
      name: "Kasse",
      titel: "Sola",
      notiz: "keinleerzeichen",
      telefon: "0791234567",
      tagId: randomUUID(),
      text: "Hallo Welt",
      lang: "x".repeat(100),
    });
    expect(aus).toEqual({
      hinzu: ["anlass.bearbeiten", "lager.sehen"],
      weg: ["raum.verwalten"],
      werte: { status: "abgeschlossen", anzahl: 3, ja: true },
    });
  });
});

describe("Middleware: nur, was etwas geändert hat", () => {
  // Eine kleine App mit der echten Middleware und einer Senke, die mitschreibt: ohne Datenbank, mit jeder Antwort, die eine Route geben kann
  type Gesammelt = { eintraege: AktivitaetEintrag[]; namenAbfragen: unknown[] };
  function kleineApp(namen?: Record<string, string>) {
    const g: Gesammelt = { eintraege: [], namenAbfragen: [] };
    const offen: Promise<unknown>[] = [];
    const senke: AktivitaetSenke = {
      erfasse: (e) => void g.eintraege.push(e),
      herkunft: () => "abcdef123456",
      erwarte: (p) => void offen.push(p),
      ...(namen && {
        namen: (abfrage) => {
          g.namenAbfragen.push(abfrage);
          return Promise.resolve(namen);
        },
      }),
    };
    const k = new Hono<{ Variables: AktivitaetVariablen }>();
    k.use(async (c, next) => {
      c.set("nutzerId", "11111111-1111-4111-8111-111111111111");
      await next();
    });
    k.use(aktivitaetMiddleware(senke));
    return {
      k,
      g,
      fertig: async () => {
        await Promise.allSettled(offen);
        return g.eintraege;
      },
    };
  }
  const json = (body: unknown) => ({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ID = "22222222-2222-4222-8222-222222222222";

  test("2xx bei einer schreibenden Anfrage: eine Zeile mit Gruppe, Objekt, Feldnamen, direkt", async () => {
    const { k, fertig } = kleineApp();
    k.patch("/api/v1/admin/tags/:id", (c) => c.body(null, 204));
    const antwort = await k.request(`/api/v1/admin/tags/${ID}`, {
      ...json({ name: "Geheimer Name" }),
      headers: {
        "content-type": "application/json",
        "content-length": "25",
      },
    });
    expect(antwort.status).toBe(204);
    const [z, ...rest] = await fertig();
    expect(rest).toEqual([]);
    expect(z).toMatchObject({
      art: "aktion",
      aktion: "PATCH /api/v1/admin/tags/:id",
      gruppe: "geaendert",
      bereich: "tags",
      objektTyp: "tags",
      objektId: ID,
      felder: ["name"],
      aenderung: { direkt: true },
      ergebnis: "erfolg",
    });
    expect(JSON.stringify(z)).not.toContain("Geheimer");
  });

  test("abgelehnt oder fehlgeschlagen (400, 401, 403, 404, 409, 422, 500): keine Zeile", async () => {
    const { k, fertig } = kleineApp();
    for (const status of [400, 401, 403, 404, 409, 422, 500] as const) {
      k.patch(`/api/v1/admin/tags/:id/s${status}`, (c) =>
        c.json({ code: "X" }, status),
      );
    }
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      const antwort = await k.request(
        `/api/v1/admin/tags/${ID}/s${status}`,
        json({ name: "a" }),
      );
      expect(antwort.status).toBe(status);
    }
    expect(await fertig()).toEqual([]);
  });

  test("lesende Anfragen und unbekannte Routen: keine Zeile, auch nicht bei Kinderdaten", async () => {
    const { k, fertig } = kleineApp();
    k.get("/api/v1/admin/kinder", (c) => c.json([]));
    expect((await k.request("/api/v1/admin/kinder")).status).toBe(200);
    expect(
      (await k.request("/api/v1/gibtsnicht", { method: "POST" })).status,
    ).toBe(404);
    expect(await fertig()).toEqual([]);
  });

  test("Vorschau, Anmelden und Alltagseingaben stehen im Katalog als «nicht»: keine Zeile bei Erfolg", async () => {
    const { k, fertig } = kleineApp();
    k.post("/api/v1/admin/mitteilungen/vorschau", (c) => c.json({ n: 3 }));
    k.post("/api/auth/sign-in/username", (c) => c.json({ ok: true }));
    k.post("/api/auth/sign-out", (c) => c.json({ ok: true }));
    k.put("/api/v1/lager/:id/reaktionen/:a/:b", (c) => c.body(null, 204));
    for (const [methode, pfad] of [
      ["POST", "/api/v1/admin/mitteilungen/vorschau"],
      ["POST", "/api/auth/sign-in/username"],
      ["POST", "/api/auth/sign-out"],
      ["PUT", `/api/v1/lager/${ID}/reaktionen/${ID}/${ID}`],
    ] as const) {
      expect((await k.request(pfad, { method: methode })).status).toBeLessThan(
        300,
      );
    }
    expect(await fertig()).toEqual([]);
  });

  test("PATCH ohne Felder und keine: true der Route sind Nullläufe: keine Zeile", async () => {
    const { k, fertig } = kleineApp();
    k.patch("/api/v1/admin/tags/:id", (c) => c.body(null, 204));
    k.post("/api/v1/lager/:id/zeitplan/meilensteine/:m/verschieben", (c) => {
      meldeAenderung(c, { keine: true });
      return c.json({ trocken: true });
    });
    const leer = await k.request(`/api/v1/admin/tags/${ID}`, {
      ...json({}),
      headers: { "content-type": "application/json", "content-length": "2" },
    });
    expect(leer.status).toBe(204);
    const trocken = await k.request(
      `/api/v1/lager/${ID}/zeitplan/meilensteine/${ID}/verschieben`,
      { method: "POST" },
    );
    expect(trocken.status).toBe(200);
    expect(await fertig()).toEqual([]);
  });

  test("Sicherheit: fehlgeschlagene Anmeldung mit innerem Grund, falscher zweiter Faktor, Begrenzung (429) auf jeder Route", async () => {
    const { k, fertig } = kleineApp();
    k.post("/api/auth/sign-in/username", (c) => {
      c.set("aktivitaetCode", "FALSCHES_PASSWORT");
      return c.json({ code: "ANMELDUNG_FEHLGESCHLAGEN" }, 401);
    });
    k.post("/api/auth/two-factor/verify-totp", (c) =>
      c.json({ code: "INVALID_CODE" }, 401),
    );
    k.get("/api/v1/irgendwas", (c) => c.json({ code: "ZU_VIELE" }, 429));
    await k.request("/api/auth/sign-in/username", { method: "POST" });
    await k.request("/api/auth/two-factor/verify-totp", { method: "POST" });
    await k.request("/api/v1/irgendwas");
    const z = await fertig();
    expect(
      z.map((e) => [e.art, e.aktion, e.fehlerCode, e.anzahl, e.status]),
    ).toEqual([
      [
        "sicherheit",
        "POST /api/auth/sign-in/username",
        "FALSCHES_PASSWORT",
        1,
        401,
      ],
      [
        "sicherheit",
        "POST /api/auth/two-factor/verify-totp",
        "INVALID_CODE",
        1,
        401,
      ],
      ["sicherheit", "(begrenzt)", "ZU_VIELE", 1, 429],
    ]);
  });

  test("angelegt: Kennung und Typ des neuen Objekts aus der Antwort, das Elternobjekt aus dem Pfad", async () => {
    const neu = "33333333-3333-4333-8333-333333333333";
    const { k, fertig } = kleineApp();
    k.post("/api/v1/admin/tags", (c) => c.json({ id: neu }, 201));
    k.post("/api/v1/admin/rechte/gruppen/:tagId/rollen", (c) =>
      c.json({ id: neu, version: 1 }, 201),
    );
    await k.request("/api/v1/admin/tags", { method: "POST" });
    await k.request(`/api/v1/admin/rechte/gruppen/${ID}/rollen`, {
      method: "POST",
    });
    const [tag, rolle] = await fertig();
    expect(tag).toMatchObject({
      gruppe: "angelegt",
      objektTyp: "tags",
      objektId: neu,
      aenderung: { direkt: true },
    });
    expect(rolle).toMatchObject({
      gruppe: "angelegt",
      objektTyp: "rollen",
      objektId: neu,
      aenderung: { direkt: true, eltern: { typ: "gruppen", id: ID } },
    });
  });

  test("Löschen: der Name wird vor dem Löschen gelesen, Objekt und Elternobjekt", async () => {
    const rolle = "44444444-4444-4444-8444-444444444444";
    const { k, g, fertig } = kleineApp({ [ID]: "OK Kirmes", [rolle]: "Kasse" });
    k.delete("/api/v1/admin/rechte/gruppen/:tagId/rollen/:rolleId", (c) =>
      c.body(null, 204),
    );
    await k.request(`/api/v1/admin/rechte/gruppen/${ID}/rollen/${rolle}`, {
      method: "DELETE",
    });
    expect(g.namenAbfragen).toEqual([
      [
        { typ: "gruppen", id: ID, elternTyp: undefined },
        { typ: "rollen", id: rolle, elternTyp: "gruppen" },
      ],
    ]);
    const [z] = await fertig();
    expect(z).toMatchObject({
      gruppe: "geloescht",
      objektTyp: "rollen",
      objektId: rolle,
      objektName: "Kasse",
      aenderung: { eltern: { typ: "gruppen", id: ID, name: "OK Kirmes" } },
    });
  });

  test("Hinweis der Route: Rechte, vorher und nachher, nur sichere Werte", async () => {
    const { k, fertig } = kleineApp();
    k.patch("/api/v1/admin/raeume/:id", (c) => {
      meldeAenderung(c, {
        hinzu: ["raum.verwalten"],
        weg: ["raum.team_zuweisen"],
        vorher: { aktiv: true, name: "Geheim", notiz: "x" },
        nachher: { aktiv: false },
      });
      return c.body(null, 204);
    });
    await k.request(`/api/v1/admin/raeume/${ID}`, {
      ...json({ aktiv: false }),
      headers: { "content-type": "application/json", "content-length": "16" },
    });
    const [z] = await fertig();
    expect(z!.aenderung).toMatchObject({
      hinzu: ["raum.verwalten"],
      weg: ["raum.team_zuweisen"],
      vorher: { aktiv: true },
      nachher: { aktiv: false },
    });
    expect(JSON.stringify(z)).not.toContain("Geheim");
  });
});

describe("Änderungsprotokoll mit Datenbank", () => {
  test("eine Schreibaktion: Benutzerstempel, Muster, Feldnamen, Satz, keine Inhalte; das Audit-Log spiegelt Personen nicht doppelt", async () => {
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
    const z = zeilen.find((r) => r.aktion === "POST /api/v1/admin/personen")!;
    expect(z).toMatchObject({
      art: "aktion",
      methode: "POST",
      bereich: "personen",
      gruppe: "angelegt",
      status: 201,
      ergebnis: "erfolg",
      akteur: "person",
      abteilungId: welt.testabteilungId,
      beschreibung: "Person angelegt",
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
    // Aus dem Audit-Log derselben Anfrage: sein Name, aber keine zweite Zeile
    expect(z.aenderung).toMatchObject({ audit: "person_angelegt" });
    expect(zeilen.filter((r) => r.art === "audit")).toHaveLength(0);
    // Nichts vom Inhalt: weder Namen noch Benutzername noch Passwort
    const alles = JSON.stringify(zeilen);
    for (const geheim of ["Geheimvorname", "Geheimnachname", benutzername]) {
      expect(alles).not.toContain(geheim);
    }
  });

  test("Tag anlegen, umbenennen, löschen: der Name steht im Satz, auch nach dem Löschen", async () => {
    const name = `OK ${randomUUID().slice(0, 6)}`;
    const neu = await anfrage(admin, "POST", "/api/v1/admin/tags", {
      typ: "team",
      name,
    });
    expect(neu.status).toBe(201);
    const { id } = (await neu.json()) as { id: string };
    const neuerName = `${name} neu`;
    expect(
      (
        await anfrage(admin, "PATCH", `/api/v1/admin/tags/${id}`, {
          name: neuerName,
        })
      ).status,
    ).toBe(204);
    expect(
      (await anfrage(admin, "DELETE", `/api/v1/admin/tags/${id}`)).status,
    ).toBe(204);
    const sätze = (await zeilenVon(admin.id!))
      .filter((z) => z.objektId === id)
      .map((z) => [z.gruppe, z.beschreibung])
      .reverse();
    expect(sätze).toEqual([
      ["angelegt", `Tag «${name}» angelegt`],
      ["geaendert", `Tag «${neuerName}» umbenannt`],
      ["geloescht", `Tag «${neuerName}» gelöscht`],
    ]);
  });

  test("Fehlschläge stehen nicht im Protokoll: 404, 403 und 401", async () => {
    const vorher = (await zeilenVon(admin.id!)).length;
    const id = randomUUID();
    expect(
      (
        await anfrage(admin, "PATCH", `/api/v1/admin/personen/${id}`, {
          admin: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(sl, "POST", "/api/v1/admin/tags", {
          typ: "team",
          name: "x",
        })
      ).status,
    ).toBe(403);
    const ip = zufallsIp();
    const ohne = await app.request("/api/v1/admin/personen", {
      method: "POST",
      headers: {
        "x-forwarded-for": ip,
        "content-type": "application/json",
        "content-length": "7",
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(ohne.status).toBe(401);
    await protokoll.leere();
    expect((await zeilenVon(admin.id!)).length).toBe(vorher);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aktivitaet)
      .where(eq(schema.aktivitaet.herkunft, protokoll.herkunft(ip)!));
    expect(n).toBe(0);
  });

  test("lesende Anfragen und der Alltag: keine Zeile", async () => {
    const vorher = (await zeilenVon(admin.id!)).length;
    expect((await anfrage(admin, "GET", "/api/v1/ich")).status).toBe(200);
    expect((await anfrage(admin, "GET", "/api/v1/admin/kinder")).status).toBe(
      200,
    );
    expect((await anfrage(admin, "GET", "/api/v1/admin/personen")).status).toBe(
      200,
    );
    expect((await zeilenVon(admin.id!)).length).toBe(vorher);
  });

  test("Anmeldung: falsche Passwörter eines Kontos in einer Stunde werden eine Zeile mit Zahl, Erfolg und Abmelden stehen nirgends", async () => {
    const konto = await legePersonaAn(welt, "leitendeA");
    const kopf = () => ({
      "expo-origin": APP,
      "content-type": "application/json",
      "x-forwarded-for": zufallsIp(),
    });
    for (let i = 0; i < 3; i++) {
      const falsch = await app.request("/api/auth/sign-in/username", {
        method: "POST",
        headers: kopf(),
        body: JSON.stringify({
          username: konto.benutzername,
          password: "falsch-falsch-1",
        }),
      });
      expect(falsch.status).toBe(401);
    }
    const ok = await app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: kopf(),
      body: JSON.stringify({
        username: konto.benutzername,
        password: konto.passwort,
      }),
    });
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
    const zeilen = await zeilenVon(konto.id!);
    // Keine Zeile für Erfolg oder Abmelden; die Fehlversuche zusammengezogen (nach Grund getrennt)
    expect(zeilen.every((z) => z.art === "sicherheit")).toBe(true);
    expect(zeilen.length).toBeLessThanOrEqual(2);
    expect(zeilen.reduce((s, z) => s + (z.anzahl ?? 0), 0)).toBe(3);
    expect(zeilen[0]).toMatchObject({
      aktion: "POST /api/auth/sign-in/username",
      status: 401,
      ergebnis: "fehler",
      gruppe: null,
    });
    expect(zeilen[0]!.fehlerCode).toBeTruthy();
    // Weder Benutzername noch Passwort stehen irgendwo
    const alles = JSON.stringify(zeilen);
    expect(alles).not.toContain(konto.benutzername!);
    expect(alles).not.toContain("falsch-falsch");
    expect(
      zeilen.some((z) =>
        z.beschreibung?.startsWith("Anmeldung fehlgeschlagen"),
      ),
    ).toBe(true);
  });

  test("Sicherheit: höchstens so viele verschiedene Ereignisse je Stunde, der Rest zählt als verworfen", async () => {
    const klein = erstelleAktivitaetsprotokoll(db, {
      taktMs: null,
      maxSicherheitProStunde: 2,
    });
    for (const h of ["a", "b", "c", "a"]) {
      klein.erfasse({
        zeit: new Date(),
        art: "sicherheit",
        akteur: "anonym",
        herkunft: `h${h}`,
        aktion: "POST /api/auth/sign-in/username",
        bereich: "anmeldung",
        ergebnis: "fehler",
        anzahl: 1,
      });
    }
    expect(klein.zaehler()).toMatchObject({ verworfen: 1 });
    klein.stopp();
  });

  test("Puffer: über der Grenze fallen Zeilen weg, die Lücke steht als Systemzeile", async () => {
    const klein = erstelleAktivitaetsprotokoll(db, {
      taktMs: null,
      maxPuffer: 3,
    });
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
        ergebnis: "erfolg",
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

  test("Audit-Angaben der Anfrage: Name der Audit-Aktion, Rechte neu und entzogen, einfache Werte, nie Namen", async () => {
    const eigene = erstelleAktivitaetsprotokoll(db, { taktMs: null });
    const zeit = new Date();
    const ziel = randomUUID();
    const aktion = `PATCH /api/v1/admin/rechte/gruppen/:tagId/rollen/:rolleId`;
    await db.insert(schema.auditLog).values([
      {
        abteilungId: welt.testabteilungId,
        akteurId: admin.id!,
        aktion: "gruppen_rolle_geaendert",
        zielTyp: "gruppen_rolle",
        zielId: ziel,
        details: {
          tagId: randomUUID(),
          umbenannt: true,
          hinzu: [{ recht: "anlass.bearbeiten", geltung: "alle" }],
          weg: ["raum.verwalten"],
          name: "Kassenwart Hans",
        },
      },
    ]);
    eigene.erfasse({
      zeit,
      art: "aktion",
      userId: admin.id!,
      akteur: "person",
      methode: "PATCH",
      aktion,
      bereich: "rechte",
      gruppe: "geaendert",
      objektTyp: "rollen",
      objektId: ziel,
      status: 204,
      dauerMs: 800,
      ergebnis: "erfolg",
      aenderung: { direkt: true },
    });
    await eigene.leere();
    const [z] = await db
      .select()
      .from(schema.aktivitaet)
      .where(
        and(
          eq(schema.aktivitaet.objektId, ziel),
          eq(schema.aktivitaet.userId, admin.id!),
        ),
      );
    expect(z!.aenderung).toMatchObject({
      audit: "gruppen_rolle_geaendert",
      hinzu: ["anlass.bearbeiten"],
      weg: ["raum.verwalten"],
      werte: { umbenannt: true },
      direkt: true,
    });
    expect(JSON.stringify(z)).not.toContain("Kassenwart");
    eigene.stopp();
  });

  test("Trigger: Audit-Zeilen von Personen werden nicht gespiegelt (die Anfrage steht schon da), von der Kommandozeile schon, mit Feldnamen ohne Werte", async () => {
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
    expect(
      await db
        .select()
        .from(schema.aktivitaet)
        .where(eq(schema.aktivitaet.aktion, aktion)),
    ).toHaveLength(0);
    const cli = `${aktion}_cli`;
    await db.insert(schema.auditLog).values({
      abteilungId: welt.testabteilungId,
      akteurId: "cli",
      aktion: cli,
      zielTyp: "person",
      zielId: ziel,
      details: { rolle: "geheimwert", anzahl: 3 },
    });
    const [z] = await db
      .select()
      .from(schema.aktivitaet)
      .where(eq(schema.aktivitaet.aktion, cli));
    expect(z).toMatchObject({
      art: "audit",
      akteur: "cli",
      userId: null,
      objektTyp: "person",
      objektId: ziel,
      felder: ["anzahl", "rolle"],
    });
    expect(JSON.stringify(z)).not.toContain("geheimwert");
  });
});

describe("Aufbewahrung", () => {
  test("die API-Rolle kann nicht ändern oder löschen", async () => {
    const [z] = await db
      .insert(schema.aktivitaet)
      .values({
        art: "system",
        aktion: "test_fest",
        bereich: "test",
        ergebnis: "erfolg",
      })
      .returning({ id: schema.aktivitaet.id });
    await expect(
      db
        .update(schema.aktivitaet)
        .set({ aktion: "x" })
        .where(eq(schema.aktivitaet.id, z!.id)),
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
    const geloescht = await loescheAlteAktivitaet(db, {
      tage: 365,
      maxZeilen: 1,
    });
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
      gruppe: string | null;
      beschreibung: string;
      benutzer: { id: string | null; name: string | null; rollen: string[] };
      objekt: { typ: string; id: string; name: string | null } | null;
      felder: string[] | null;
      anzahl: number | null;
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
        gruppe: i % 3 === 0 ? "angelegt" : "geaendert",
        beschreibung: `Seed-Änderung ${i}`,
        objektTyp: "seed",
        objektId: i === 0 ? "00000000-0000-4000-8000-000000000001" : undefined,
        objektName: i === 0 ? `Objekt ${seed}` : undefined,
        status: 204,
        ergebnis: "erfolg" as const,
      })),
    );
    // Sicherheitsereignisse im selben Bereich: nur mit art=sicherheit sichtbar
    await db.insert(schema.aktivitaet).values([
      {
        art: "sicherheit" as const,
        abteilungId: welt.testabteilungId,
        akteur: "anonym" as const,
        aktion: "POST /api/auth/sign-in/username",
        bereich: `seed${seed}`,
        status: 401,
        ergebnis: "fehler" as const,
        fehlerCode: "INVALID_USERNAME_OR_PASSWORD",
        anzahl: 4,
      },
      {
        art: "sicherheit" as const,
        abteilungId: welt.testabteilungId,
        akteur: "anonym" as const,
        aktion: "(begrenzt)",
        bereich: `seed${seed}`,
        status: 429,
        ergebnis: "fehler" as const,
        anzahl: 1,
      },
    ]);
    // Eine Zeile der anderen Abteilung
    await db.insert(schema.aktivitaet).values({
      art: "aktion",
      abteilungId: welt.demoAbteilungId,
      aktion: `PATCH /api/v1/admin/fremd${seed}`,
      bereich: `seed${seed}`,
      ergebnis: "erfolg",
    });
  });

  test("Entwickler mit zweitem Faktor liest; das Lesen erzeugt keine Zeile; Sicherheit ist ausgeblendet", async () => {
    const { status, body } = await liste(entwickler, `?bereich=seed${seed}`);
    expect(status).toBe(200);
    expect(body.eintraege).toHaveLength(7);
    expect(body.eintraege[0]).toMatchObject({
      art: "aktion",
      benutzer: {
        id: entwickler.id,
        name: `Name ${seed}`,
        rollen: ["leitung"],
      },
    });
    // Nur Änderungen: die zwei Sicherheitszeilen fehlen
    expect(body.eintraege.every((e) => e.art === "aktion")).toBe(true);
    const zugriffe = (await zeilenVon(entwickler.id!)).filter(
      (z) => z.aktion === `GET ${BASIS}`,
    );
    expect(zugriffe).toHaveLength(0);
  });

  test("alle anderen: Abteilungsleitung, Stufenleitung 403, ohne Anmeldung 401", async () => {
    expect((await anfrage(admin, "GET", BASIS)).status).toBe(403);
    expect((await anfrage(sl, "GET", BASIS)).status).toBe(403);
    expect((await anfrage(admin, "GET", `${BASIS}/verlauf`)).status).toBe(403);
    expect((await anfrage(admin, "GET", `${BASIS}/export.csv`)).status).toBe(
      403,
    );
    // Erst das Objekt, dann die Funktion: unbekannt ist 404, vorhanden aber ohne Funktion 403
    expect(
      (await anfrage(admin, "GET", `${BASIS}/${randomUUID()}`)).status,
    ).toBe(404);
    const [vorhanden] = await db
      .select({ id: schema.aktivitaet.id })
      .from(schema.aktivitaet)
      .where(
        and(
          eq(schema.aktivitaet.bereich, `seed${seed}`),
          eq(schema.aktivitaet.abteilungId, welt.testabteilungId),
        ),
      )
      .limit(1);
    expect(
      (await anfrage(admin, "GET", `${BASIS}/${vorhanden!.id}`)).status,
    ).toBe(403);
    const ohne = await app.request(BASIS);
    expect(ohne.status).toBe(401);
  });

  test("Entwickler ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT", async () => {
    const konto = await legePersonaAn(welt, "leitendeB");
    await db.insert(schema.plattformEntwickler).values({ userId: konto.id! });
    const antwort = await anfrage(konto, "GET", BASIS);
    expect(antwort.status).toBe(403);
    expect(await antwort.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
  });

  test("nur die eigene Abteilung; Detail einer fremden Zeile ist 404", async () => {
    const eigene = await liste(entwickler, `?bereich=seed${seed}`);
    expect(eigene.body.eintraege.some((e) => e.aktion.includes("fremd"))).toBe(
      false,
    );
    const fremde = await liste(entwicklerDemo, `?bereich=seed${seed}`);
    expect(fremde.body.eintraege.map((e) => e.aktion)).toEqual([
      `PATCH /api/v1/admin/fremd${seed}`,
    ]);
    const id = eigene.body.eintraege[0]!.id;
    expect(
      (await anfrage(entwicklerDemo, "GET", `${BASIS}/${id}`)).status,
    ).toBe(404);
    const detail = await anfrage(entwickler, "GET", `${BASIS}/${id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id, bereich: `seed${seed}` });
  });

  test("Filter: Gruppe, Art, Benutzer (Kennung und Namensteil), Objekt, Freitext, Zeitraum", async () => {
    const b = `bereich=seed${seed}`;
    expect(
      (await liste(entwickler, `?${b}&gruppe=angelegt`)).body.eintraege,
    ).toHaveLength(3);
    expect(
      (await liste(entwickler, `?${b}&gruppe=geaendert`)).body.eintraege,
    ).toHaveLength(4);
    // Sicherheit nur auf Verlangen, und dann nur sie
    const sicherheit = (await liste(entwickler, `?${b}&art=sicherheit`)).body
      .eintraege;
    expect(sicherheit.every((e) => e.art === "sicherheit")).toBe(true);
    expect(sicherheit.map((e) => e.beschreibung).sort()).toEqual([
      "Anmeldung fehlgeschlagen, 4-mal",
      "Zu viele Anfragen, Begrenzung ausgelöst",
    ]);
    // Der Filter «Ergebnis» gibt es nicht mehr
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}?${b}&ergebnis=fehler`))
        .status,
    ).toBe(400);
    expect(
      (await liste(entwickler, `?${b}&q=Objekt ${seed}`)).body.eintraege,
    ).toHaveLength(1);
    expect(
      (await liste(entwickler, `?${b}&benutzer=${entwickler.id}`)).body
        .eintraege,
    ).toHaveLength(7);
    expect(
      (
        await liste(
          entwickler,
          `?${b}&benutzer=${encodeURIComponent(`name ${seed}`.toUpperCase())}`,
        )
      ).body.eintraege,
    ).toHaveLength(7);
    // % in der Eingabe ist Text, kein Muster
    expect(
      (await liste(entwickler, `?${b}&benutzer=%25`)).body.eintraege,
    ).toHaveLength(0);
    expect(
      (
        await liste(
          entwickler,
          `?${b}&objekt=00000000-0000-4000-8000-000000000001`,
        )
      ).body.eintraege,
    ).toHaveLength(1);
    expect(
      (await liste(entwickler, `?${b}&q=seed${seed}`)).body.eintraege,
    ).toHaveLength(7);
    expect(
      (await liste(entwickler, `?${b}&q=Seed-Änderung 3`)).body.eintraege,
    ).toHaveLength(1);
    expect(
      (await liste(entwickler, `?${b}&q=gibtsnicht`)).body.eintraege,
    ).toHaveLength(0);
    expect(
      (await liste(entwickler, `?${b}&art=system`)).body.eintraege,
    ).toHaveLength(0);
    expect(
      (await liste(entwickler, `?${b}&art=aenderung`)).body.eintraege,
    ).toHaveLength(7);
    const heute = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Zurich",
    });
    expect(
      (await liste(entwickler, `?${b}&von=${heute}&bis=${heute}`)).body
        .eintraege.length,
    ).toBeGreaterThan(0);
    expect(
      (await liste(entwickler, `?${b}&von=2020-01-01&bis=2020-01-02`)).body
        .eintraege,
    ).toHaveLength(0);
  });

  test("Seitenbildung mit Cursor: neu zuerst, ohne Doppelte, Grenzen geprüft", async () => {
    const b = `bereich=seed${seed}`;
    const ids: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const { body } = await liste(
        entwickler,
        `?${b}&limit=3${nach ? `&nach=${nach}` : ""}`,
      );
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
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}?limit=101`)).status,
    ).toBe(400);
    expect((await anfrage(entwickler, "GET", `${BASIS}?limit=0`)).status).toBe(
      400,
    );
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}?nach=kaputt`)).status,
    ).toBe(400);
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}?unbekannt=1`)).status,
    ).toBe(400);
    expect(
      (await anfrage(entwickler, "GET", `${BASIS}?von=gestern`)).status,
    ).toBe(400);
  });

  test("Verlauf: lückenlose Säulen und Summe; zu langer Zeitraum 400", async () => {
    const heute = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Zurich",
    });
    const antwort = await anfrage(
      entwickler,
      "GET",
      `${BASIS}/verlauf?bereich=seed${seed}&einheit=tag&von=${heute}&bis=${heute}`,
    );
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as {
      punkte: { start: string; gesamt: number }[];
      bereiche: { bereich: string; gesamt: number }[];
      summe: {
        gesamt: number;
        heute: number;
        sieben: number;
        personen: number;
        sicherheit: number;
      };
    };
    expect(body.punkte).toHaveLength(1);
    // Nur die sieben Änderungen; die fünf Sicherheitsereignisse (4 + 1) stehen gesondert
    expect(body.summe).toEqual({
      gesamt: 7,
      heute: 7,
      sieben: 7,
      personen: 1,
      sicherheit: 5,
    });
    expect(body.punkte[0]).not.toHaveProperty("fehler");
    const sicher = (await (
      await anfrage(
        entwickler,
        "GET",
        `${BASIS}/verlauf?bereich=seed${seed}&art=sicherheit&einheit=tag`,
      )
    ).json()) as { summe: { gesamt: number } };
    expect(sicher.summe.gesamt).toBe(5);
    expect(body.bereiche[0]).toMatchObject({
      bereich: `seed${seed}`,
      gesamt: 7,
    });
    const stunden = await anfrage(
      entwickler,
      "GET",
      `${BASIS}/verlauf?einheit=stunde&von=${heute}&bis=${heute}`,
    );
    expect(
      ((await stunden.json()) as { punkte: unknown[] }).punkte.length,
    ).toBeGreaterThanOrEqual(23);
    expect(
      (
        await anfrage(
          entwickler,
          "GET",
          `${BASIS}/verlauf?einheit=stunde&von=2026-01-01&bis=2026-03-01`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(
          entwickler,
          "GET",
          `${BASIS}/verlauf?von=2026-03-02&bis=2026-03-01`,
        )
      ).status,
    ).toBe(400);
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
    const antwort = await anfrage(
      entwickler,
      "GET",
      `${BASIS}/export.csv?bereich=export${seed}`,
    );
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/csv");
    const text = await antwort.text();
    const zeilen = text.split("\r\n");
    expect(zeilen[0]).toContain("zeit,art,benutzer_id,rollen,beschreibung");
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
      .values({
        art: "system",
        abteilungId: welt.testabteilungId,
        aktion: "=1+1",
        bereich: `formel${seed}`,
        ergebnis: "erfolg",
      })
      .returning();
    expect(formel).toHaveLength(1);
    const csv = await (
      await anfrage(
        entwickler,
        "GET",
        `${BASIS}/export.csv?bereich=formel${seed}`,
      )
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
    expect((await anfrage(admin, "GET", `${BASIS}/${ids[0]!.id}`)).status).toBe(
      403,
    );
  });
});

describe("Routenmuster", () => {
  test("unbekannte Pfade: keine Zeile, kein Pfad im Protokoll", async () => {
    const geheim = `geheim-${randomUUID()}`;
    expect(
      (await anfrage(admin, "POST", `/api/v1/${geheim}`, { a: 1 })).status,
    ).toBe(404);
    const zeilen = await zeilenVon(admin.id!);
    expect(zeilen.some((r) => r.aktion === "POST (unbekannte Route)")).toBe(
      false,
    );
    expect(JSON.stringify(zeilen)).not.toContain(geheim);
  });
});

describe("Konto löschen heisst vergessen", () => {
  test("mit dem Konto verlieren die Zeilen Kennung, Name und Funktionen; die Zeilen bleiben", async () => {
    const konto = await legePersonaAn(welt, "leitendeA");
    await db.insert(schema.aktivitaet).values({
      art: "aktion",
      abteilungId: welt.testabteilungId,
      userId: konto.id!,
      akteur: "person",
      name: "Wird vergessen",
      rollen: ["leitung"],
      aktion: "PATCH /api/v1/admin/tags/:id",
      bereich: "tags",
      ergebnis: "erfolg",
    });
    const vorher = await zeilenVon(konto.id!);
    expect(vorher.length).toBeGreaterThan(0);
    expect(vorher[0]!.name).toBeTruthy();
    const ids = vorher.map((z) => z.id);
    await db.delete(schema.user).where(eq(schema.user.id, konto.id!));
    expect(await zeilenVon(konto.id!)).toHaveLength(0);
    const nachher = await db
      .select()
      .from(schema.aktivitaet)
      .where(inArray(schema.aktivitaet.id, ids));
    expect(nachher).toHaveLength(ids.length);
    for (const z of nachher) {
      expect(z).toMatchObject({ userId: null, name: null, rollen: [] });
    }
  });
});
