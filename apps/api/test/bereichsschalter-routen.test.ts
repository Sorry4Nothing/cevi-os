import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import {
  bereichVon,
  erstelleSchalterZustand,
  GESPERRT,
  type SchalterArt,
  type SchalterBereich,
} from "../src/bereichsschalter.js";
import { erstelleDb } from "../src/db/client.js";
import { ladeSeiten } from "../src/seiten.js";
import { erzeuge } from "../src/termine/ical-token.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// #425/#424: Die Sperre gilt für alles. Dieser Test geht jede registrierte Route der App durch (die Routen stimmen mit docs/api/openapi.yaml überein, openapi.test.ts) und stellt sicher, dass keine ohne Bereich bleibt, ausser den hier begründeten.
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const zustand = erstelleSchalterZustand();
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  schalter: zustand,
});
afterAll(() => sql.end());

// Konto-Grundfunktionen ohne eigenen Bereich: Nur «alles» trifft sie (das Panel der Person, ihr Bild, die Stufenliste, die Push-Anmeldung). /api/v1/plattform ist bewusst offen (die Schalter selbst)
const OHNE_BEREICH = new Set([
  "/api/v1/ich",
  "/api/v1/ich/bild",
  "/api/v1/ich/datenschutz",
  "/api/v1/personen/:id/bild",
  "/api/v1/push-token",
  "/api/v1/stufen",
  "/api/v1/stufen/:id/logo",
  "/api/v1/stufen/:id/kontakte",
  "/api/v1/plattform/schalter",
  // App-Nachweis (#785): ohne Sitzung, vor jeder Bereichsprüfung
  "/api/v1/app/nachweis",
  "/api/v1/app/nachweis/challenge",
]);

const routen = [
  ...new Set(
    app.routes
      .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/v1/"))
      .map((r) => `${r.method} ${r.path}`),
  ),
].map((s) => {
  const [methode, pfad] = s.split(" ");
  return { methode, pfad };
});
const mitBeispiel = (pfad: string) => pfad.replace(/:\w+/g, "x");

let welt: Welt;
let admin: PersonaKonto;
let eltern: PersonaKonto;
let token: string;
let tokenDemo: string;

const setze = (
  abteilungId: string,
  bereich: SchalterBereich,
  art: SchalterArt = "sperre",
) =>
  zustand.setze({
    id: "00000000-0000-4000-8000-000000000000",
    abteilungId,
    bereich,
    art,
    hinweis: "intern",
    ende: null,
    websiteOffline: false,
    ausgeloestVon: admin.id!,
    ausgeloestAm: new Date(),
  });
const anfrage = (konto: PersonaKonto, methode: string, pfad: string) =>
  app.request(mitBeispiel(pfad), { method: methode, headers: konto.headers });
const feed = (t: string, kopf: Record<string, string> = {}) =>
  app.request(`/ical/${t}.ics`, { headers: kopf });

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, eltern] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "elternA"),
  ]);
  token = (
    await erzeuge(db, { id: eltern.id!, abteilungId: welt.testabteilungId })
  ).token;
  const demo = await legePersonaAn(welt, "demoEltern");
  tokenDemo = (
    await erzeuge(db, { id: demo.id!, abteilungId: welt.demoAbteilungId })
  ).token;
});
beforeEach(async () => {
  // Der Zustand liegt nur im Speicher dieses Tests
  for (const b of [
    "website",
    "lager",
    "chat",
    "programme",
    "verwaltung",
    "alles",
  ] as const) {
    for (const art of ["sperre", "wartung"] as const) {
      for (const a of [welt?.testabteilungId, welt?.demoAbteilungId]) {
        if (a) zustand.hebeAuf(a, b, art);
      }
    }
  }
});

describe("Bereichszuordnung aller Routen", () => {
  test("jede Route unter /api/v1 hat einen Bereich, ausser der begründeten Liste", () => {
    const ohne = routen
      .filter((r) => bereichVon(r.pfad) === null)
      .map((r) => r.pfad);
    expect([...new Set(ohne)].sort()).toEqual([...OHNE_BEREICH].sort());
  });

  test("Kalender, Termine, Anlässe, Vorschläge und Räume sind «programme», Lager-Einstellungen «lager»", () => {
    for (const pfad of [
      "/api/v1/anlaesse/x",
      "/api/v1/termin-vorschlaege",
      "/api/v1/ich/kalender-link",
      "/api/v1/stufen/x/anwesenheit",
      "/api/v1/admin/anlaesse",
      "/api/v1/admin/termin-vorschlaege",
      "/api/v1/admin/kategorie-zuordnungen",
      "/api/v1/raeume",
      "/api/v1/admin/raeume",
    ]) {
      expect(bereichVon(pfad), pfad).toBe("programme");
    }
    expect(bereichVon("/api/v1/ich/lager-benachrichtigungen")).toBe("lager");
  });

  test("das Lädeli (Laden, Bestellungen, Verwaltung) gehört zur Website", () => {
    for (const pfad of [
      "/api/v1/laden",
      "/api/v1/laden/bestellungen",
      "/api/v1/laden/bestellungen/x",
      "/api/v1/admin/laden/artikel",
      "/api/v1/admin/laden/bestellungen/x/status",
    ]) {
      expect(bereichVon(pfad), pfad).toBe("website");
    }
  });
});

describe("Sperre «alles» erfasst jede Route", () => {
  test("jede registrierte Route ausser /api/v1/plattform antwortet 423, auch für die Abteilungsleitung", async () => {
    setze(welt.testabteilungId, "alles");
    const abweichler: string[] = [];
    for (const { methode, pfad } of routen) {
      if (pfad.startsWith("/api/v1/plattform")) continue;
      // Ohne Sitzung, die Sperre der Bereiche gilt dort nicht (#785)
      if (pfad.startsWith("/api/v1/app/nachweis")) continue;
      const antwort = await anfrage(admin, methode, pfad);
      if (antwort.status !== 423) {
        abweichler.push(`${methode} ${pfad} ${antwort.status}`);
      }
    }
    expect(abweichler).toEqual([]);
    expect(
      (await anfrage(admin, "GET", "/api/v1/plattform/schalter")).status,
    ).toBe(200);
  });

  test.each([
    ["programme", "GET", "/api/v1/anlaesse/x"],
    ["programme", "POST", "/api/v1/termin-vorschlaege"],
    ["programme", "GET", "/api/v1/ich/kalender-link"],
    ["programme", "GET", "/api/v1/stufen/x/anwesenheit"],
    ["programme", "GET", "/api/v1/admin/anlaesse"],
    ["programme", "GET", "/api/v1/raeume"],
    ["programme", "GET", "/api/v1/admin/raeume"],
    ["lager", "GET", "/api/v1/ich/lager-benachrichtigungen"],
  ] as const)("%s-Sperre trifft %s %s", async (bereich, methode, pfad) => {
    setze(welt.testabteilungId, bereich);
    const antwort = await anfrage(admin, methode, pfad);
    expect(antwort.status).toBe(423);
    expect(await antwort.json()).toEqual(GESPERRT);
  });
});

describe("ICS-Feed unter Sperre", () => {
  test("ohne Schalter liefert er den Kalender", async () => {
    expect((await feed(token)).status).toBe(200);
  });

  test.each(["programme", "alles"] as const)(
    "%s-Sperre: dieselbe 404-Antwort wie für einen unbekannten Token, auch mit If-None-Match",
    async (bereich) => {
      const etag = (await feed(token)).headers.get("etag")!;
      setze(welt.testabteilungId, bereich);
      const unbekannt = await feed("a".repeat(43));
      const gesperrt = await feed(token, { "if-none-match": etag });
      expect(gesperrt.status).toBe(404);
      expect(await gesperrt.text()).toBe(await unbekannt.text());
      expect(gesperrt.headers.get("etag")).toBeNull();
    },
  );

  test("andere Bereiche, Wartung und die andere Abteilung berühren den Feed nicht; nach der Aufhebung läuft er wieder", async () => {
    setze(welt.testabteilungId, "lager");
    setze(welt.testabteilungId, "programme", "wartung");
    setze(welt.demoAbteilungId, "programme");
    expect((await feed(token)).status).toBe(200);
    expect((await feed(tokenDemo)).status).toBe(404);
    zustand.hebeAuf(welt.demoAbteilungId, "programme", "sperre");
    expect((await feed(tokenDemo)).status).toBe(200);
  });
});
