import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import ICAL from "ical.js";
import { Hono } from "hono";
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
import { erstelleApp } from "../../src/app.js";
import type { Db } from "../../src/db/client.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { erstelleIcalRoute } from "../../src/routes/termine/ical.js";
import { ladeSeiten } from "../../src/seiten.js";
import { erzeuge, widerrufe } from "../../src/termine/ical-token.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { legeProgrammAn } from "../hilfen/programme.js";

bereiteAuthTestsVor();
// Jede Persona rechnet scrypt
vi.setConfig({ hookTimeout: 120_000 });

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = { appMinVersion: "1.2.0", sql, auth, seiten: ladeSeiten() };
const app = erstelleApp({ ...optionen, db });
afterAll(() => sql.end());

let welt: Welt;
let lagerTerminId: string;
let konten: Record<Persona, PersonaKonto>;
let ausgabe: MockInstance<typeof console.log>;
const tokens = {} as Record<Persona, string>;

beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// Die Termine liegen relativ zu heute, weil das Fenster des Feeds von der Datenbankuhr abhängt
const TAG = 86_400_000;
const inTagen = (n: number, stunde = 13) =>
  new Date(Math.floor(Date.now() / TAG) * TAG + n * TAG + stunde * 3_600_000);
const datumIn = (n: number) => inTagen(n).toISOString().slice(0, 10);

async function termin(spez: {
  titel: string;
  tags: string[];
  abteilungId?: string;
  status?: "aktiv" | "abgesagt" | "pruefen";
  beginn?: Date;
  tagVon?: string;
  tagBis?: string;
  ort?: string;
}) {
  const t = await legeProgrammAn(db, {
    abteilungId: spez.abteilungId ?? welt.testabteilungId,
    titel: spez.titel,
    beginn: spez.beginn,
    tagVon: spez.tagVon,
    tagBis: spez.tagBis,
  });
  await db
    .update(schema.programm)
    .set({ status: spez.status ?? "aktiv", ort: spez.ort ?? null })
    .where(eq(schema.programm.id, t.id));
  if (spez.tags.length > 0) {
    await db
      .insert(schema.programmTag)
      .values(spez.tags.map((tagId) => ({ programmId: t.id, tagId })));
  }
  return t.id;
}

const LANGER_TITEL =
  "Elternabend, Übernachtung; Stäfa\\Hombi mit einem sehr langen Titel, der gefaltet werden muss";

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
  const { stufeAId: a, stufeBId: b, demoStufeId: d } = welt;
  await termin({ titel: "A", tags: [a], beginn: inTagen(10) });
  await termin({
    titel: "B",
    tags: [b],
    beginn: inTagen(11),
    ort: "Pfadiheim, Stäfa",
  });
  await termin({ titel: LANGER_TITEL, tags: [a, b], beginn: inTagen(12) });
  lagerTerminId = await termin({
    titel: "Lager",
    tags: [a],
    tagVon: datumIn(20),
    tagBis: datumIn(22),
  });
  await termin({
    titel: "A abgesagt",
    tags: [a],
    beginn: inTagen(13),
    status: "abgesagt",
  });
  await termin({ titel: "ohne Tag", tags: [], beginn: inTagen(16) });
  await termin({ titel: "A vergangen", tags: [a], beginn: inTagen(-5) });
  await termin({ titel: "A zu fern", tags: [a], beginn: inTagen(500) });
  await termin({
    titel: "Demo",
    tags: [d],
    abteilungId: welt.demoAbteilungId,
    beginn: inTagen(10),
  });
  // Ein Token je Persona, die einen Kalender sieht
  for (const p of PERSONAS) {
    const konto = konten[p];
    if (!konto.id) continue;
    const abteilungId = ["demoAdmin", "demoEltern"].includes(p)
      ? welt.demoAbteilungId
      : welt.testabteilungId;
    tokens[p] = (await erzeuge(db, { id: konto.id, abteilungId })).token;
  }
});

const feed = (
  token: string,
  kopf: Record<string, string> = {},
  zielApp: { request: typeof app.request } = app,
) => zielApp.request(`/ical/${token}.ics`, { headers: kopf });
const summaries = (text: string) =>
  new ICAL.Component(ICAL.parse(text))
    .getAllSubcomponents("vevent")
    .map((c) => new ICAL.Event(c).summary)
    .sort();
const meinKalender = async (persona: Persona) => {
  const antwort = await app.request(
    `/api/v1/termine/mein?von=${datumIn(-2)}&bis=${datumIn(397)}&limit=100`,
    { headers: konten[persona].headers },
  );
  expect(antwort.status).toBe(200);
  return (await antwort.json()) as {
    termine: { titel: string; kinder: { vorname: string }[] }[];
  };
};

describe("Feed: genau die Termine von «Mein Kalender»", () => {
  test.each([
    "elternA",
    "elternB",
    "leitendeA",
    "leitendeAElternB",
    "slA",
    "admin",
    "demoEltern",
  ] as const)(
    "%s sieht im Feed dieselben Termine wie in der App",
    async (p) => {
      const antwort = await feed(tokens[p]);
      expect(antwort.status).toBe(200);
      const erwartet = (await meinKalender(p)).termine
        .map((t) => t.titel)
        .sort();
      expect(summaries(await antwort.text())).toEqual(erwartet);
    },
  );

  test("Inhalt eines Eltern-Feeds: sichtbar, was die Sicht liefert, sonst nichts", async () => {
    const titel = summaries(await (await feed(tokens.elternA)).text());
    expect(titel).toEqual(["A", "A abgesagt", "Lager", LANGER_TITEL].sort());
    // Weder ohne Tag, vergangen, zu fern noch die Demo-Abteilung
    for (const nie of ["ohne Tag", "A vergangen", "A zu fern", "Demo"]) {
      expect(titel).not.toContain(nie);
    }
  });

  test("Ereignisse: Zeiten in UTC, ganztägig als DATE mit exklusivem Ende, Ort, Absage, lange Zeilen gefaltet", async () => {
    const antwort = await feed(tokens.leitendeAElternB);
    const text = await antwort.text();
    for (const zeile of text.split("\r\n")) {
      expect(new TextEncoder().encode(zeile).length).toBeLessThanOrEqual(75);
    }
    expect(text.endsWith("\r\n")).toBe(true);
    const events = new ICAL.Component(ICAL.parse(text))
      .getAllSubcomponents("vevent")
      .map((c) => new ICAL.Event(c));
    const nach = (titel: string) => events.find((e) => e.summary === titel)!;
    expect(nach("A").startDate.toJSDate().toISOString()).toBe(
      inTagen(10).toISOString(),
    );
    expect(nach("A").endDate.toJSDate().toISOString()).toBe(
      new Date(inTagen(10).getTime() + 7_200_000).toISOString(),
    );
    expect(nach("B").location).toBe("Pfadiheim, Stäfa");
    expect(nach("Lager").startDate.isDate).toBe(true);
    expect(nach("Lager").startDate.toString()).toBe(datumIn(20));
    expect(nach("Lager").endDate.toString()).toBe(datumIn(23));
    expect(nach("A abgesagt").component.getFirstPropertyValue("status")).toBe(
      "CANCELLED",
    );
    expect(nach(LANGER_TITEL).summary).toBe(LANGER_TITEL);
    // Stabile UID: dieselbe wie der Termin in der Datenbank
    expect(nach("Lager").uid).toBe(`${lagerTerminId}@cevi-os`);
  });

  test("keine Kindernamen, Beschreibung, Tags oder Kategorien", async () => {
    const mein = await meinKalender("elternA");
    const vornamen = mein.termine.flatMap((t) =>
      t.kinder.map((k) => k.vorname),
    );
    const kinder = await db
      .select({ vorname: schema.kind.vorname })
      .from(schema.kind);
    expect(kinder.length).toBeGreaterThan(0);
    const text = await (await feed(tokens.elternA)).text();
    for (const name of [...vornamen, ...kinder.map((k) => k.vorname)]) {
      expect(text).not.toContain(name);
    }
    for (const eigenschaft of [
      "DESCRIPTION",
      "CATEGORIES",
      "ATTENDEE",
      "ORGANIZER",
      "ATTACH",
    ]) {
      expect(text).not.toContain(eigenschaft);
    }
    const tags = await db.select({ name: schema.tag.name }).from(schema.tag);
    for (const { name } of tags) expect(text).not.toContain(`:${name}`);
  });
});

describe("Antwortkopf", () => {
  test("200: Kalender, nie speichern, ETag, kein Cookie, Sicherheitskopf", async () => {
    // Ein Cookie einer anderen Person ändert nichts und wird nie gesetzt
    const mitCookie = await feed(tokens.elternA, {
      cookie: konten.elternB.headers.cookie ?? "",
    });
    const ohneCookie = await feed(tokens.elternA);
    expect(mitCookie.status).toBe(200);
    expect(mitCookie.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(mitCookie.headers.get("cache-control")).toBe("private, no-store");
    expect(mitCookie.headers.get("set-cookie")).toBeNull();
    expect(ohneCookie.headers.get("set-cookie")).toBeNull();
    expect(mitCookie.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mitCookie.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mitCookie.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(mitCookie.headers.get("etag")).toBe(ohneCookie.headers.get("etag"));
    expect(summaries(await mitCookie.text())).toEqual(
      summaries(await ohneCookie.text()),
    );
  });

  test("HEAD liefert den Kopf ohne Inhalt", async () => {
    const antwort = await app.request(`/ical/${tokens.elternA}.ics`, {
      method: "HEAD",
    });
    expect(antwort.status).toBe(200);
    expect(await antwort.text()).toBe("");
  });
});

describe("404 für alles Unbekannte, immer dieselbe Antwort", () => {
  const sieh = async (antwort: Response) => ({
    status: antwort.status,
    typ: antwort.headers.get("content-type"),
    cache: antwort.headers.get("cache-control"),
    etag: antwort.headers.get("etag"),
    cookie: antwort.headers.get("set-cookie"),
    body: await antwort.text(),
  });

  test("erfunden, falsches Format, falsche Endung, widerrufen, deaktiviert und gesperrt sind nicht zu unterscheiden", async () => {
    // Widerrufen: erst gültig, dann nicht mehr (die Prüfung läuft bei jedem Abruf, auch bei vollem Zwischenspeicher)
    const eigener = await erzeuge(db, {
      id: konten.elternB.id!,
      abteilungId: welt.testabteilungId,
    });
    expect((await feed(eigener.token)).status).toBe(200);
    // erzeuge() hat den Token von elternB ersetzt; die Tests nutzen danach den neuen
    tokens.elternB = eigener.token;
    await widerrufe(db, {
      id: konten.elternB.id!,
      abteilungId: welt.testabteilungId,
    });
    const widerrufen = await sieh(await feed(eigener.token));

    const deaktiviertToken = (
      await erzeuge(db, {
        id: konten.deaktiviert.id!,
        abteilungId: welt.testabteilungId,
      })
    ).token;
    const gesperrt = (
      await erzeuge(db, {
        id: konten.slB.id!,
        abteilungId: welt.testabteilungId,
      })
    ).token;
    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.id, konten.slB.id!));

    const faelle = [
      widerrufen,
      await sieh(await feed("A".repeat(43))),
      await sieh(await feed("zu-kurz")),
      await sieh(await feed("A".repeat(44))),
      await sieh(await feed("ä".repeat(43))),
      await sieh(await feed(deaktiviertToken)),
      await sieh(await feed(gesperrt)),
      await sieh(await app.request(`/ical/${tokens.elternA}.txt`)),
      await sieh(await app.request(`/ical/${tokens.elternA}`)),
      await sieh(await app.request(`/ical/${tokens.elternA}.ics/mehr`)),
    ];
    expect(widerrufen.status).toBe(404);
    for (const f of faelle) expect(f).toEqual(widerrufen);
    expect(widerrufen.body).toBe(
      JSON.stringify({ code: "NICHT_GEFUNDEN", message: "Nicht gefunden" }),
    );
    expect(widerrufen.cookie).toBeNull();
  });
});

describe("ETag und Datenbanklast", () => {
  test("If-None-Match ergibt 304 ohne Inhalt und ohne Abfrage der Termine", async () => {
    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    const betrifft = (q: string) =>
      /programm|person_tag|"kind"|programm_tag/.test(q);

    const erste = await feed(tokens.leitendeA, {}, zaehlApp);
    expect(erste.status).toBe(200);
    const etag = erste.headers.get("etag")!;
    // Token und Konto, Sicht der Person, Termine: höchstens drei Abfragen, keine je Zeile
    expect(abfragen.length).toBeLessThanOrEqual(3);
    expect(abfragen.filter(betrifft).length).toBeLessThanOrEqual(2);
    abfragen.length = 0;

    // Ein neuer Termin liegt in der Datenbank; der Zwischenspeicher gilt 5 Minuten
    const neu = await termin({
      titel: "Nachträglich",
      tags: [welt.stufeAId],
      beginn: inTagen(30),
    });
    const zweite = await feed(
      tokens.leitendeA,
      { "if-none-match": etag },
      zaehlApp,
    );
    expect(zweite.status).toBe(304);
    expect(await zweite.text()).toBe("");
    expect(zweite.headers.get("etag")).toBe(etag);
    expect(zweite.headers.get("cache-control")).toBe("private, no-store");
    // Nur die Prüfung des Tokens, keine Abfrage der Termine
    expect(abfragen.filter(betrifft)).toEqual([]);
    expect(abfragen.length).toBe(1);
    abfragen.length = 0;

    // Weitere Formen des Kopfs: schwach, Liste, Stern; ein fremder Wert liefert den Inhalt
    for (const kopf of [`W/${etag}`, `"x", ${etag}`, "*"]) {
      expect(
        (await feed(tokens.leitendeA, { "if-none-match": kopf }, zaehlApp))
          .status,
      ).toBe(304);
    }
    const voll = await feed(
      tokens.leitendeA,
      { "if-none-match": '"anderer"' },
      zaehlApp,
    );
    expect(voll.status).toBe(200);
    expect(summaries(await voll.text())).not.toContain("Nachträglich");
    expect(abfragen.filter(betrifft)).toEqual([]);

    // Eine andere Person hat ihren eigenen Zwischenspeicher und sieht den neuen Termin
    const andere = await feed(tokens.slA, {}, zaehlApp);
    expect(summaries(await andere.text())).toContain("Nachträglich");
    await db.delete(schema.programm).where(eq(schema.programm.id, neu));
  });

  test("ein Widerruf wirkt sofort, auch mit gefülltem Zwischenspeicher", async () => {
    const konto = konten.leitendeB;
    const { token } = await erzeuge(db, {
      id: konto.id!,
      abteilungId: welt.testabteilungId,
    });
    expect((await feed(token)).status).toBe(200);
    await widerrufe(db, { id: konto.id!, abteilungId: welt.testabteilungId });
    expect((await feed(token)).status).toBe(404);
  });
});

describe("Ratenbegrenzung", () => {
  test("je IP: Fehlversuche zählen, danach 429 mit Retry-After; eine andere IP bleibt frei", async () => {
    const mini = new Hono().route("/", erstelleIcalRoute({ db, ipLimit: 5 }));
    const von = (ip: string) => ({ "x-forwarded-for": `198.51.100.1, ${ip}` });
    for (let i = 0; i < 5; i++) {
      expect(
        (await feed("A".repeat(43), von("203.0.113.7"), mini)).status,
      ).toBe(404);
    }
    const gesperrt = await feed("A".repeat(43), von("203.0.113.7"), mini);
    expect(gesperrt.status).toBe(429);
    expect(gesperrt.headers.get("retry-after")).toBe("600");
    // Auch ein gültiger Token kommt von dieser IP nicht mehr durch
    expect((await feed(tokens.elternA, von("203.0.113.7"), mini)).status).toBe(
      429,
    );
    expect((await feed(tokens.elternA, von("203.0.113.8"), mini)).status).toBe(
      200,
    );
  });

  test("je Token-Prefix: Ein Token, den eine Quelle zu oft abruft, wird gebremst", async () => {
    const mini = new Hono().route(
      "/",
      erstelleIcalRoute({ db, praefixLimit: 3 }),
    );
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await feed(
            tokens.elternA,
            { "x-forwarded-for": `192.0.2.${i}` },
            mini,
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (await feed(tokens.elternA, { "x-forwarded-for": "192.0.2.99" }, mini))
        .status,
    ).toBe(429);
    expect(
      (await feed(tokens.leitendeA, { "x-forwarded-for": "192.0.2.99" }, mini))
        .status,
    ).toBe(200);
  });

  test("die Standardgrenze der App liegt bei 300 je IP und 10 Minuten", async () => {
    const kopf = { "x-forwarded-for": "203.0.113.50" };
    let letzte = 0;
    for (let i = 0; i < 301; i++) {
      letzte = (await feed("ungueltig", kopf)).status;
      if (i < 300) expect(letzte).toBe(404);
    }
    expect(letzte).toBe(429);
  });

  test("ein Fehler der Datenbank ist 500 und nennt den Token nicht", async () => {
    const kaputt = new Proxy(db, {
      get: (ziel, name) =>
        name === "execute"
          ? () => Promise.reject(new Error("Datenbank weg"))
          : Reflect.get(ziel, name),
    });
    const antwort = await feed(
      tokens.elternA,
      {},
      erstelleApp({ ...optionen, db: kaputt }),
    );
    expect(antwort.status).toBe(500);
    expect(await antwort.text()).not.toContain(tokens.elternA);
  });
});

describe("Der Token steht in keinem Log", () => {
  test("weder Anfrage-Log noch Fehler-Log, Antwort oder Kopf nennen den Token", async () => {
    ausgabe.mockClear();
    const gesehen = [tokens.elternA, tokens.leitendeA];
    const unbekannt = "Z".repeat(43);
    const antworten = [
      await feed(gesehen[0]),
      await feed(gesehen[0], { "if-none-match": "*" }),
      await feed(unbekannt),
      await feed(unbekannt, { "x-forwarded-for": "203.0.113.99" }),
    ];
    // Ein Abbruch in der Datenbank landet im Fehler-Log
    const kaputt = new Proxy(db, {
      get: (ziel, name) =>
        name === "execute"
          ? () => Promise.reject(new Error("Datenbank weg"))
          : Reflect.get(ziel, name),
    });
    antworten.push(
      await feed(gesehen[1], {}, erstelleApp({ ...optionen, db: kaputt })),
    );
    const zeilenImLog = ausgabe.mock.calls.map(([z]) => String(z));
    expect(zeilenImLog.length).toBeGreaterThanOrEqual(5);
    for (const z of zeilenImLog) {
      for (const t of [...gesehen, unbekannt]) expect(z).not.toContain(t);
    }
    // Das Muster der Route steht im Log, nie der Pfad
    expect(zeilenImLog.some((z) => z.includes('"route":"/ical/:datei"'))).toBe(
      true,
    );
    for (const a of antworten) {
      for (const [name, wert] of a.headers) {
        for (const t of [...gesehen, unbekannt]) {
          expect(`${name}: ${wert}`).not.toContain(t);
        }
      }
      if (a.status !== 200) {
        for (const t of [...gesehen, unbekannt]) {
          expect(await a.clone().text()).not.toContain(t);
        }
      }
    }
  });

  test("kein Audit-Eintrag nennt den Token und der Abruf schreibt keinen", async () => {
    // Nur die Abteilung dieser Welt: Andere Testdateien schreiben parallel in die gleiche Tabelle
    const audit = () =>
      db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.abteilungId, welt.testabteilungId));
    const vorher = await audit();
    await feed(tokens.elternA);
    const nachher = await audit();
    expect(nachher.length).toBe(vorher.length);
    expect(JSON.stringify(nachher)).not.toContain(tokens.elternA);
  });
});
