import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, inArray } from "drizzle-orm";
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
import { erstelleAuth } from "../src/auth.js";
import {
  erstelleAnmeldungGesperrt,
  erstelleSchalterZustand,
  GESPERRT,
  type SchalterZustand,
} from "../src/bereichsschalter.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { legeWebmasterAn } from "../src/plattform.js";
import { ladeSeiten } from "../src/seiten.js";
import { dateisystemAusgabe } from "../src/website/ausgabe.js";
import { aufWebsiteEreignis } from "../src/website/ereignisse.js";
import {
  erstelleWebsiteSperre,
  HINWEISSEITE,
  mitSperre,
} from "../src/website/sperre.js";
import {
  APP,
  bereiteAuthTestsVor,
  cookiesAus,
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

const fcm = bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const zustand = erstelleSchalterZustand();
// Wie server.ts: Die Anmeldung kennt die Sperre von «alles»
const auth = erstelleAuth(
  drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  { anmeldungGesperrt: erstelleAnmeldungGesperrt({ db, zustand }) },
);
const website = {
  abteilungId: "",
  nimmVomNetz: vi.fn(async () => {}),
  gibFrei: vi.fn(async () => {}),
};
const baueApp = (schalter: SchalterZustand) =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    fcm,
    seiten: ladeSeiten(),
    schalter,
    website,
  });
const app = baueApp(zustand);
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let eltern: PersonaKonto;
let slA: PersonaKonto;
let demoEltern: PersonaKonto;
let demoAdmin: PersonaKonto;
let entwickler: PersonaKonto;
let entwickler2: PersonaKonto;
let webmasterMitRecht: PersonaKonto;
let loginAdmin: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  website.abteilungId = welt.testabteilungId;
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
  [entwickler, entwickler2, webmasterMitRecht] = await Promise.all([
    mitFaktor("leitendeA"),
    mitFaktor("leitendeA"),
    mitFaktor("leitendeA"),
  ]);
  // Ein Entwickler ohne zweiten Faktor, mit Passwort für die Anmeldung unter «alles»
  loginAdmin = await legePersonaAn(welt, "leitendeA");
  await db
    .insert(schema.plattformEntwickler)
    .values([
      { userId: entwickler.id! },
      { userId: entwickler2.id! },
      { userId: loginAdmin.id! },
    ]);
  const [rolle] = await db
    .insert(schema.plattformRolle)
    .values({ abteilungId: welt.testabteilungId, name: "Wartung Website" })
    .returning({ id: schema.plattformRolle.id });
  await db
    .insert(schema.plattformRolleRecht)
    .values({ rolleId: rolle.id, recht: "wartungsmodus.website" });
  await db
    .insert(schema.personPlattformRolle)
    .values({ userId: webmasterMitRecht.id!, rolleId: rolle.id });
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
  fcm.zuruecksetzen();
  website.nimmVomNetz.mockClear().mockResolvedValue();
  website.gibFrei.mockClear().mockResolvedValue();
});
afterEach(async () => {
  ausgabe.mockRestore();
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
  konto: PersonaKonto | null,
  methode: string,
  pfad: string,
  body?: unknown,
) {
  return app.request(pfad, {
    method: methode,
    headers: {
      ...(konto?.headers ?? {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const sperre = (
  konto: PersonaKonto,
  bereich: string,
  body: Record<string, unknown> = {},
) =>
  anfrage(konto, "PUT", "/api/v1/plattform/schalter", {
    art: "sperre",
    bereich,
    ...body,
  });
const wartung = (konto: PersonaKonto, bereich: string) =>
  anfrage(konto, "PUT", "/api/v1/plattform/schalter", {
    art: "wartung",
    bereich,
  });
const hebeAuf = (konto: PersonaKonto, bereich: string, art = "sperre") =>
  anfrage(
    konto,
    "DELETE",
    `/api/v1/plattform/schalter?art=${art}&bereich=${bereich}`,
  );

// Eine lesende Anfrage je Bereich; die Sperre antwortet vor jeder Route
const LESEN: Record<string, string> = {
  lager: "/api/v1/lager",
  chat: "/api/v1/chats",
  programme: "/api/v1/programme",
  verwaltung: "/api/v1/admin/personen",
  website: "/api/v1/redaktion/ich",
  alles: "/api/v1/ich",
};

describe("Informationssperre: Wirkung", () => {
  test.each(Object.keys(LESEN))(
    "%s: jede Anfrage des Bereichs antwortet 423 mit neutralem Text, auch für Abteilungsleitung und Entwickler",
    async (bereich) => {
      const antwort = await sperre(admin, bereich, {
        hinweis: "Interne Notiz zum Vorfall",
      });
      expect(antwort.status).toBe(200);
      for (const konto of [admin, entwickler, slA, eltern]) {
        const gesperrt = await anfrage(konto, "GET", LESEN[bereich]);
        expect(gesperrt.status, bereich).toBe(423);
        // Neutral: weder der Hinweis noch ein Anlass
        expect(await gesperrt.json()).toEqual(GESPERRT);
      }
      // Auch schreibend
      expect(
        (await anfrage(admin, "POST", LESEN[bereich], {})).status,
        bereich,
      ).toBe(423);
    },
  );

  test("andere Bereiche und andere Abteilungen laufen weiter", async () => {
    await sperre(admin, "lager");
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(200);
    expect((await anfrage(admin, "GET", "/api/v1/admin/personen")).status).toBe(
      200,
    );
    expect((await anfrage(eltern, "GET", "/api/v1/ich")).status).toBe(200);
    expect((await anfrage(demoEltern, "GET", "/api/v1/lager")).status).not.toBe(
      423,
    );
  });

  test("alles trifft auch Pfade ohne Bereich; /health, die Schalter und die Verwaltungsseite bleiben erreichbar", async () => {
    await sperre(admin, "alles");
    expect((await anfrage(eltern, "GET", "/api/v1/ich")).status).toBe(423);
    expect(
      (await anfrage(eltern, "POST", "/api/v1/push-token", {})).status,
    ).toBe(423);
    const health = await app.request("/health");
    expect(await health.text()).not.toContain("GESPERRT");
    expect(health.status).not.toBe(423);
    expect((await app.request("/admin")).status).toBe(200);
    // Zustand sehen und aufheben: Abteilungsleitung und Entwickler, mitten in der Sperre
    for (const konto of [admin, entwickler]) {
      const lesen = await anfrage(konto, "GET", "/api/v1/plattform/schalter");
      expect(lesen.status).toBe(200);
      expect(await lesen.json()).toMatchObject({
        schalter: [{ art: "sperre", bereich: "alles" }],
        darfSperre: true,
      });
    }
  });

  test("die Sperre geht der Wartung vor", async () => {
    await wartung(admin, "chat");
    await sperre(admin, "chat");
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(423);
    await hebeAuf(admin, "chat");
    // Die Wartung bleibt, wenn nur die Sperre fällt
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(200);
    expect(
      (await anfrage(eltern, "POST", "/api/v1/chats/direkt", {})).status,
    ).toBe(503);
  });

  test("Aufheben wirkt sofort; Entwickler und Abteilungsleitung heben gegenseitig auf", async () => {
    await sperre(admin, "chat");
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(423);
    expect((await hebeAuf(entwickler, "chat")).status).toBe(204);
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(200);
    await sperre(entwickler, "chat");
    expect((await hebeAuf(admin, "chat")).status).toBe(204);
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(200);
    expect((await hebeAuf(admin, "chat")).status).toBe(404);
  });

  test("öffentliche Medien ohne Sitzung: gesperrt bei Sperre der Website oder von alles, sonst nicht", async () => {
    const pfad = `/api/v1/medien/${randomUUID()}`;
    const ohne = await app.request(pfad);
    expect(ohne.status).not.toBe(423);
    await sperre(admin, "chat");
    expect((await app.request(pfad)).status).not.toBe(423);
    await sperre(admin, "website");
    const gesperrt = await app.request(pfad);
    expect(gesperrt.status).toBe(423);
    expect(await gesperrt.json()).toEqual(GESPERRT);
    await hebeAuf(admin, "website");
    await sperre(admin, "alles");
    expect((await app.request(pfad)).status).toBe(423);
  });

  test("der Zustand überlebt einen Neustart", async () => {
    await sperre(admin, "chat", { hinweis: "Bleibt" });
    const neu = erstelleSchalterZustand();
    await neu.lade(db);
    const antwort = await baueApp(neu).request("/api/v1/chats", {
      headers: eltern.headers,
    });
    expect(antwort.status).toBe(423);
  });
});

describe("Informationssperre: wer schalten darf", () => {
  test("nur Entwickler und Abteilungsleitung, mit zweitem Faktor; Webmaster, Stufenleitung und Eltern nie", async () => {
    for (const konto of [eltern, slA, webmasterMitRecht]) {
      for (const bereich of ["website", "lager", "alles"]) {
        expect((await sperre(konto, bereich)).status, bereich).toBe(403);
        expect((await hebeAuf(konto, bereich)).status).toBe(403);
      }
    }
    const ohneFaktor = await sperre(adminOhne, "lager");
    expect(ohneFaktor.status).toBe(403);
    expect(await ohneFaktor.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    expect(
      (await anfrage(null, "PUT", "/api/v1/plattform/schalter", {})).status,
    ).toBe(401);
    expect(zustand.vonAbteilung(welt.testabteilungId)).toEqual([]);
  });

  test("der Webmaster mit dem Recht darf die Wartung der Website, aber die Sperre weder setzen noch aufheben noch sehen", async () => {
    expect((await wartung(webmasterMitRecht, "website")).status).toBe(200);
    expect((await sperre(admin, "website")).status).toBe(200);
    // Er sieht nur die Wartung, die Sperre bleibt ihm verborgen
    const lesen = await anfrage(
      webmasterMitRecht,
      "GET",
      "/api/v1/plattform/schalter",
    );
    expect(lesen.status).toBe(200);
    const { schalter, darfSperre } = (await lesen.json()) as {
      schalter: { art: string }[];
      darfSperre: boolean;
    };
    expect(schalter.map((s) => s.art)).toEqual(["wartung"]);
    expect(darfSperre).toBe(false);
    expect((await hebeAuf(webmasterMitRecht, "website")).status).toBe(403);
    expect(
      zustand.trifft(welt.testabteilungId, "website", "sperre"),
    ).toBeDefined();
  });

  test("Eingabe: Sitzungen und Website nur bei der Sperre, Website nur für «website» und «alles»", async () => {
    const roh = (body: Record<string, unknown>) =>
      anfrage(admin, "PUT", "/api/v1/plattform/schalter", body);
    expect(
      (await roh({ art: "wartung", bereich: "lager", sitzungenBeenden: true }))
        .status,
    ).toBe(400);
    expect(
      (await roh({ art: "wartung", bereich: "website", websiteOffline: true }))
        .status,
    ).toBe(400);
    expect(
      (await roh({ art: "sperre", bereich: "lager", websiteOffline: true }))
        .status,
    ).toBe(400);
    expect(
      (await roh({ art: "sperre", bereich: "lager", sitzungenBeenden: "ja" }))
        .status,
    ).toBe(400);
    expect(zustand.vonAbteilung(welt.testabteilungId)).toEqual([]);
  });

  test("Audit-Log mit Art, Bereich und den Wünschen, ohne den Hinweis", async () => {
    // Ohne `sitzungenBeenden`: Es endete die Sitzungen der Personen, die die späteren Tests brauchen
    await sperre(admin, "website", {
      hinweis: "Geheimer Anlass",
      websiteOffline: true,
    });
    const [schalter] = await db
      .select({ id: schema.bereichsschalter.id })
      .from(schema.bereichsschalter)
      .where(eq(schema.bereichsschalter.abteilungId, welt.testabteilungId));
    await hebeAuf(admin, "website");
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, schalter.id))
      .orderBy(schema.auditLog.erstelltAm);
    expect(zeilen.map((z) => z.aktion)).toEqual([
      "schalter_gesetzt",
      "schalter_aufgehoben",
    ]);
    expect(zeilen[0]).toMatchObject({
      akteurId: admin.id,
      details: {
        art: "sperre",
        bereich: "website",
        ende: null,
        sitzungenBeenden: false,
        websiteOffline: true,
      },
    });
    expect(JSON.stringify(zeilen)).not.toContain("Anlass");
  });
});

describe("Informationssperre: Anmeldung unter «alles»", () => {
  const sitzungenVon = (konto: PersonaKonto) =>
    db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, konto.id!));
  const anmelden = (konto: PersonaKonto, passwort = konto.passwort) =>
    app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "expo-origin": APP,
        "x-forwarded-for": zufallsIp(),
      },
      body: JSON.stringify({
        username: konto.benutzername,
        password: passwort,
      }),
    });

  test("normale Personen melden sich nicht an, Abteilungsleitung und Entwickler schon", async () => {
    expect((await anmelden(eltern)).status).toBe(200);
    const vorher = (await sitzungenVon(eltern)).length;
    await sperre(admin, "alles");
    // Wie jeder Anmeldefehler: das einheitliche 401, damit niemand am Status erkennt, dass eine Sperre gilt; es entsteht keine Sitzung
    for (const konto of [eltern, slA]) {
      const antwort = await anmelden(konto);
      expect(antwort.status).toBe(401);
      expect(await antwort.json()).toMatchObject({
        code: "ANMELDUNG_FEHLGESCHLAGEN",
      });
      expect(antwort.headers.getSetCookie()).toEqual([]);
    }
    expect((await sitzungenVon(eltern)).length).toBe(vorher);
    // Ein falsches Passwort antwortet genauso
    const falsch = await anmelden(eltern, "falsches-passwort-1");
    expect(falsch.status).toBe(401);
    // Abteilungsleitung (ohne zweiten Faktor angemeldet: nur die Sitzung wird geprüft) und Entwickler
    expect((await anmelden(adminOhne)).status).toBe(200);
    expect((await anmelden(loginAdmin)).status).toBe(200);
    // Die andere Abteilung meldet sich normal an
    expect((await anmelden(demoEltern)).status).toBe(200);
  });

  test("eine Sperre eines Bereichs sperrt die Anmeldung nicht", async () => {
    await sperre(admin, "lager");
    expect((await anmelden(eltern)).status).toBe(200);
  });

  test("nach dem Aufheben melden sich alle wieder an", async () => {
    await sperre(admin, "alles");
    expect((await anmelden(eltern)).status).toBe(401);
    await hebeAuf(admin, "alles");
    expect((await anmelden(eltern)).status).toBe(200);
  });
});

describe("Informationssperre: öffentliche Website vom Netz", () => {
  const warteBis = (art: string) =>
    new Promise<void>((erfuellt) => {
      const ab = aufWebsiteEreignis((e) => {
        if (e.art === art && e.abteilungId === welt.testabteilungId) {
          ab();
          erfuellt();
        }
      });
    });

  test("auf Wunsch nimmt die Sperre die Website vom Netz; Aufheben gibt sie frei und löst den Abgleich aus", async () => {
    const antwort = await sperre(admin, "website", { websiteOffline: true });
    expect(await antwort.json()).toMatchObject({
      websiteOffline: true,
      websiteVomNetz: true,
    });
    expect(website.nimmVomNetz).toHaveBeenCalledTimes(1);
    expect(zustand.websiteOffline(welt.testabteilungId)).toBe(true);
    const abgleich = warteBis("seite_geaendert");
    expect((await hebeAuf(admin, "website")).status).toBe(204);
    await abgleich;
    expect(website.gibFrei).toHaveBeenCalledTimes(1);
    expect(zustand.websiteOffline(welt.testabteilungId)).toBe(false);
  });

  test("ohne den Wunsch bleibt die Website, auch bei einer Sperre der Website", async () => {
    await sperre(admin, "website");
    expect(website.nimmVomNetz).not.toHaveBeenCalled();
    expect(zustand.websiteOffline(welt.testabteilungId)).toBe(false);
    await hebeAuf(admin, "website");
    expect(website.gibFrei).not.toHaveBeenCalled();
  });

  test("hält eine zweite Sperre die Website noch vom Netz, gibt das Aufheben der ersten sie nicht frei", async () => {
    await sperre(admin, "website", { websiteOffline: true });
    await sperre(admin, "alles", { websiteOffline: true });
    await hebeAuf(admin, "website");
    expect(website.gibFrei).not.toHaveBeenCalled();
    expect(zustand.websiteOffline(welt.testabteilungId)).toBe(true);
    await hebeAuf(admin, "alles");
    expect(website.gibFrei).toHaveBeenCalledTimes(1);
  });

  test("scheitert die Ausgabe, gilt die Sperre trotzdem und die Antwort sagt es", async () => {
    website.nimmVomNetz.mockRejectedValue(new Error("EACCES"));
    const antwort = await sperre(admin, "alles", { websiteOffline: true });
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toMatchObject({
      websiteOffline: true,
      websiteVomNetz: false,
    });
    expect((await anfrage(eltern, "GET", "/api/v1/ich")).status).toBe(423);
    expect(zustand.websiteOffline(welt.testabteilungId)).toBe(true);
  });

  test("eine Sperre einer anderen Abteilung berührt die Website nicht", async () => {
    const antwort = await anfrage(
      demoAdmin,
      "PUT",
      "/api/v1/plattform/schalter",
      {
        art: "sperre",
        bereich: "website",
        websiteOffline: true,
      },
    );
    expect(antwort.status).toBe(200);
    expect(website.nimmVomNetz).not.toHaveBeenCalled();
    expect(zustand.websiteOffline(welt.testabteilungId)).toBe(false);
  });

  test("Dateisystem: Ausgabe geleert, Hinweisseite geschrieben, Weiterleitungen bleiben; Freigabe räumt die Hinweisseiten", async () => {
    const wurzel = await mkdtemp(join(tmpdir(), "cevi-sperre-"));
    try {
      const ausgabeFs = dateisystemAusgabe(wurzel);
      for (const datei of [
        "index.html",
        "kontakt/index.html",
        "sitemap.xml",
        "robots.txt",
        "website/website.css",
        "weiterleitungen.caddy",
      ]) {
        await ausgabeFs.schreibe(datei, `Inhalt ${datei}`);
      }
      const sperreFs = erstelleWebsiteSperre(ausgabeFs, "abteilung");
      await sperreFs.nimmVomNetz();
      expect(await ausgabeFs.liste()).toEqual([
        "404.html",
        "index.html",
        "weiterleitungen.caddy",
      ]);
      expect(await readFile(join(wurzel, "index.html"), "utf8")).toBe(
        HINWEISSEITE,
      );
      expect(HINWEISSEITE).not.toMatch(/<script|https?:\/\//);
      await sperreFs.gibFrei();
      expect(await ausgabeFs.liste()).toEqual(["weiterleitungen.caddy"]);
    } finally {
      await rm(wurzel, { recursive: true, force: true });
    }
  });

  test("der Abgleich läuft nicht, solange die Website vom Netz ist", async () => {
    const lauf = vi.fn(async () => "fertig" as const);
    let gesperrt = true;
    const umhuellt = mitSperre(() => gesperrt, lauf);
    expect(await umhuellt()).toBe("gesperrt");
    expect(lauf).not.toHaveBeenCalled();
    gesperrt = false;
    expect(await umhuellt()).toBe("fertig");
    expect(lauf).toHaveBeenCalledTimes(1);
  });
});

describe("Informationssperre: Push an die Entwickler", () => {
  async function tokenVon(konto: PersonaKonto) {
    const [sitzung] = await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, konto.id!));
    // Ein Token je Sitzung: das aus einem früheren Test weg
    await db
      .delete(schema.pushToken)
      .where(eq(schema.pushToken.sessionId, sitzung.id));
    const token = `token-${randomUUID()}`;
    await db.insert(schema.pushToken).values({
      sessionId: sitzung.id,
      token,
      userId: konto.id!,
      plattform: "android",
    });
    return token;
  }

  test("bei der Auslösung geht ein Push an die anderen Entwickler, ohne Hinweis und nicht an den Auslöser", async () => {
    const andere = await tokenVon(entwickler2);
    const eigener = await tokenVon(entwickler);
    await sperre(entwickler, "chat", { hinweis: "Geheimer Anlass" });
    const tokens = fcm.nachrichten.map((n) => (n as { token: string }).token);
    expect(tokens).toContain(andere);
    expect(tokens).not.toContain(eigener);
    expect(
      fcm.nachrichten.find((n) => (n as { token: string }).token === andere),
    ).toMatchObject({
      notification: {
        title: "Informationssperre ausgelöst",
        body: "Bereich: Chat",
      },
      data: { typ: "plattform" },
      android: { notification: { channelId: "mitteilungen" } },
    });
    expect(JSON.stringify(fcm.nachrichten)).not.toContain("Anlass");
    // Eine Änderung der bestehenden Sperre löst keinen zweiten Push aus
    fcm.nachrichten.length = 0;
    await sperre(entwickler, "chat", { hinweis: "Anders" });
    expect(fcm.nachrichten).toEqual([]);
  });

  test("die Wartung löst keinen Push aus", async () => {
    await tokenVon(entwickler2);
    await wartung(entwickler, "chat");
    expect(fcm.nachrichten).toEqual([]);
  });

  test("ein Ausfall des Pushs macht die Sperre nicht rückgängig", async () => {
    await tokenVon(entwickler2);
    fcm.ausfall = true;
    const antwort = await sperre(entwickler, "chat");
    expect(antwort.status).toBe(200);
    expect((await anfrage(eltern, "GET", "/api/v1/chats")).status).toBe(423);
  });
});

describe("Informationssperre: alle Sitzungen beenden", () => {
  // Zuletzt in der Datei: Der Test beendet die Sitzungen aller Personen der Testabteilung ausser der der Abteilungsleitung
  const sitzungen = (userId: string) =>
    db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, userId));
  const zweitesGeraet = async (konto: PersonaKonto) => {
    const anmeldung = await auth.api.signInUsername({
      body: { username: konto.benutzername!, password: konto.passwort! },
      returnHeaders: true,
    });
    return { "expo-origin": APP, cookie: cookiesAus(anmeldung) };
  };

  test("ohne den Wunsch bleiben alle Sitzungen", async () => {
    const person = await legePersonaAn(welt, "elternA");
    const vorher = (await sitzungen(person.id!)).length;
    const antwort = await sperre(admin, "lager");
    expect(await antwort.json()).toMatchObject({ sitzungenBeendet: null });
    expect((await sitzungen(person.id!)).length).toBe(vorher);
    expect((await anfrage(person, "GET", "/api/v1/ich")).status).toBe(200);
  });

  test("auf Wunsch enden die Sitzungen der Abteilung, die eigene und die anderer Abteilungen bleiben", async () => {
    const person = await legePersonaAn(welt, "elternA");
    const zweit = await zweitesGeraet(person);
    const vorher = (await sitzungen(person.id!)).length;
    expect(vorher).toBeGreaterThanOrEqual(2);
    const antwort = await sperre(admin, "lager", { sitzungenBeenden: true });
    expect(antwort.status).toBe(200);
    const koerper = (await antwort.json()) as { sitzungenBeendet: number };
    expect(koerper.sitzungenBeendet).toBeGreaterThanOrEqual(vorher);
    expect(await sitzungen(person.id!)).toEqual([]);
    // Ausser Lager läuft alles, aber die Sitzungen sind weg: 401
    expect(
      (await app.request("/api/v1/ich", { headers: person.headers })).status,
    ).toBe(401);
    expect((await app.request("/api/v1/ich", { headers: zweit })).status).toBe(
      401,
    );
    // Die Sitzung dessen, der sperrt, bleibt, und die andere Abteilung ist unberührt
    expect((await anfrage(admin, "GET", "/api/v1/ich")).status).toBe(200);
    expect((await anfrage(demoEltern, "GET", "/api/v1/ich")).status).toBe(200);
    expect((await sitzungen(demoEltern.id!)).length).toBeGreaterThan(0);
  });
});
