import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
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
import { loescheAlteFormularAntworten } from "../src/formular/formular.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Formulare der Website (#819): die öffentliche Route (Sichtbarkeit, Prüfung, Spamschutz) und die Antworten in der Verwaltung
bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const neueApp = () =>
  erstelleApp({
    appMinVersion: "1.2.0",
    sql,
    db,
    auth,
    seiten: ladeSeiten(),
  });
const app = neueApp();
afterAll(() => sql.end());

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

let welt: Welt;
let admin: PersonaKonto;
let slA: PersonaKonto;
let leitendeA: PersonaKonto;
let elternA: PersonaKonto;
let demoEltern: PersonaKonto;
let ohneLogin: PersonaKonto;
let tagId: string;

const NAME = randomUUID();
const ZAHL = randomUUID();
const WAHL = randomUUID();
const OK = randomUUID();
const felder = () => [
  { id: NAME, typ: "text", beschriftung: "Name", pflicht: true, maxLaenge: 20 },
  { id: ZAHL, typ: "zahl", beschriftung: "Anzahl", pflicht: false, ganzzahl: true, min: 1, max: 9 },
  { id: WAHL, typ: "mehrfachwahl", beschriftung: "Mitbringen", pflicht: false, optionen: ["Zelt", "Topf", "Seil"], maxAuswahl: 2 },
  { id: OK, typ: "zustimmung", beschriftung: "Einverstanden", pflicht: true },
];
const gueltig = (extra: Record<string, unknown> = {}) => ({
  [NAME]: "Pia",
  [OK]: true,
  ...extra,
});

let zaehler = 0;
// Jede Anfrage von einer eigenen Adresse, damit die Grenzen je Adresse nie stören; die Grenzen prüfen eigene Tests
const ip = () => `10.${Math.floor(++zaehler / 250)}.${zaehler % 250}.1`;

function sende(
  konto: PersonaKonto | null,
  formularId: string,
  koerper: unknown,
  kopf: Record<string, string> = {},
  anwendung = app,
) {
  return anwendung.request(`/api/v1/formulare/${formularId}/antworten`, {
    method: "POST",
    headers: {
      ...(konto?.headers ?? {}),
      "content-type": "application/json",
      "x-forwarded-for": ip(),
      ...kopf,
    },
    body: JSON.stringify(koerper),
  });
}
const body = (antworten: Record<string, unknown>, extra: object = {}) => ({
  antworten,
  homepage: "",
  dauerMs: 8000,
  ...extra,
});

async function seite(
  sichtbarkeit: "oeffentlich" | "angemeldet" | "tags",
  daten: Record<string, unknown> = {},
  bausteinSicht: unknown = undefined,
  abteilungId = welt.testabteilungId,
  veroeffentlicht = true,
) {
  const formularId = randomUUID();
  const adresse = `f-${randomUUID().slice(0, 12)}`;
  const [s] = await db
    .insert(schema.seite)
    .values({
      abteilungId,
      adresse,
      titel: `Seite ${adresse}`,
      sichtbarkeit,
      sichtbarkeitTags: sichtbarkeit === "tags" ? [tagId] : [],
    })
    .returning();
  const [v] = await db
    .insert(schema.seiteVersion)
    .values({
      seiteId: s!.id,
      nr: 1,
      inhalt: {
        v: 1,
        titel: "Umfrage",
        bausteine: [
          {
            id: formularId,
            typ: "formular",
            ...(bausteinSicht ? { sichtbarkeit: bausteinSicht } : {}),
            daten: {
              titel: "Sommerlager",
              felder: felder(),
              datenschutz: "Wir planen das Lager. Die Leitung sieht die Antworten.",
              ...daten,
            },
          },
        ],
      },
    })
    .returning();
  if (veroeffentlicht) {
    await db
      .update(schema.seite)
      .set({ veroeffentlichteVersionId: v!.id })
      .where(eq(schema.seite.id, s!.id));
  }
  return { formularId, seiteId: s!.id, versionId: v!.id };
}
const anzahl = async (formularId: string) =>
  (
    await db
      .select({ n: count() })
      .from(schema.formularAntwort)
      .where(eq(schema.formularAntwort.formularId, formularId))
  )[0]!.n;
const json = async (a: Response) => (await a.json()) as Record<string, any>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, slA, leitendeA, elternA, demoEltern, ohneLogin] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "leitendeA"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "demoEltern"),
    legePersonaAn(welt, "ohneLogin"),
  ]);
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId: welt.testabteilungId,
      typ: "funktion",
      name: "Formular-Leitende",
      kuerzel: "FL",
    })
    .returning();
  tagId = t!.id;
  await db
    .insert(schema.personTag)
    .values({ userId: leitendeA.id!, tagId, rolle: "Leitung" });
});

describe("öffentliches Formular", () => {
  test("eine anonyme Antwort wird gespeichert: ohne Person, mit Frist, ohne Wert in der Antwort", async () => {
    const f = await seite("oeffentlich");
    const a = await sende(null, f.formularId, body(gueltig({ [ZAHL]: 3, [WAHL]: ["Seil", "Zelt"] })));
    expect(a.status).toBe(201);
    expect(await json(a)).toEqual({ ok: true });
    const [z] = await db
      .select()
      .from(schema.formularAntwort)
      .where(eq(schema.formularAntwort.formularId, f.formularId));
    expect(z).toMatchObject({
      userId: null,
      seiteId: f.seiteId,
      versionId: f.versionId,
      abteilungId: welt.testabteilungId,
    });
    expect(z!.antworten).toEqual({ [NAME]: "Pia", [OK]: true, [ZAHL]: 3, [WAHL]: ["Zelt", "Seil"] });
    const tage = (z!.loeschenAm.getTime() - Date.now()) / 86_400_000;
    expect(tage).toBeGreaterThan(179.9);
    expect(tage).toBeLessThan(180.1);
  });

  test("eine angemeldete Person sendet mit ihrem Konto, auch auf einer öffentlichen Seite", async () => {
    const f = await seite("oeffentlich");
    expect((await sende(elternA, f.formularId, body(gueltig()))).status).toBe(201);
    const [z] = await db
      .select()
      .from(schema.formularAntwort)
      .where(eq(schema.formularAntwort.formularId, f.formularId));
    expect(z!.userId).toBe(elternA.id);
  });

  test("Pflichtfeld, Grenzen, Option und fremde Feld-ID: 422 mit Feld-ID und Code, nie mit dem Wert", async () => {
    const f = await seite("oeffentlich");
    const geheim = "GEHEIMER-WERT-98765";
    const fremd = randomUUID();
    const a = await sende(
      null,
      f.formularId,
      body({
        [NAME]: geheim.repeat(3),
        [ZAHL]: 12,
        [WAHL]: ["Zelt", "Topf", "Seil"],
        [fremd]: "x",
      }),
    );
    expect(a.status).toBe(422);
    const text = await a.text();
    expect(text).not.toContain(geheim);
    const fehler = (JSON.parse(text) as { fehler: { feld: string; code: string }[] }).fehler;
    expect(fehler).toEqual(
      expect.arrayContaining([
        { feld: NAME, code: "ZU_LANG" },
        { feld: ZAHL, code: "BEREICH" },
        { feld: WAHL, code: "ANZAHL" },
        { feld: OK, code: "PFLICHT" },
        { feld: fremd, code: "UNBEKANNT" },
      ]),
    );
    expect(await anzahl(f.formularId)).toBe(0);
  });

  test("das Formular kommt aus der Datenbank: eine Antwort auf ein nicht veröffentlichtes, unbekanntes oder fremdes Formular ist 404", async () => {
    const entwurf = await seite("oeffentlich", {}, undefined, welt.testabteilungId, false);
    expect((await sende(null, entwurf.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(null, randomUUID(), body(gueltig()))).status).toBe(404);
    const a = await sende(null, "kein-uuid", body(gueltig()));
    expect(a.status).toBe(400);
  });

  test("Eingabe: kein JSON, falsche Form, zusätzliche Felder, zu grosse Antwort", async () => {
    const f = await seite("oeffentlich");
    const roh = (b: BodyInit, typ = "application/json") =>
      app.request(`/api/v1/formulare/${f.formularId}/antworten`, {
        method: "POST",
        headers: { "content-type": typ, "x-forwarded-for": ip() },
        body: b,
      });
    expect((await roh("{kaputt")).status).toBe(400);
    expect((await roh("name=x", "application/x-www-form-urlencoded")).status).toBe(400);
    expect((await sende(null, f.formularId, { antworten: "x" })).status).toBe(400);
    expect((await sende(null, f.formularId, { ...body(gueltig()), rolle: "admin" })).status).toBe(400);
    expect((await sende(null, f.formularId, body(gueltig(), { dauerMs: -1 }))).status).toBe(400);
    expect((await roh(JSON.stringify(body({ [NAME]: "x".repeat(70_000) })))).status).toBe(413);
    expect(await anzahl(f.formularId)).toBe(0);
  });

  test("nur POST: GET, PUT und DELETE gibt es nicht", async () => {
    const f = await seite("oeffentlich");
    for (const methode of ["GET", "PUT", "DELETE"]) {
      const a = await app.request(`/api/v1/formulare/${f.formularId}/antworten`, {
        method: methode,
        headers: { "x-forwarded-for": ip() },
      });
      expect([401, 404, 405]).toContain(a.status);
    }
  });

  test("eine fremde Herkunft (Origin) ist 403, auch ohne Sitzung", async () => {
    const f = await seite("oeffentlich");
    const a = await sende(null, f.formularId, body(gueltig()), { origin: "https://boese.example.org" });
    expect(a.status).toBe(403);
    expect(await anzahl(f.formularId)).toBe(0);
  });
});

describe("Spamschutz", () => {
  test("die Falle: gefüllt heisst «gesendet», gespeichert wird nichts", async () => {
    const f = await seite("oeffentlich");
    const a = await sende(null, f.formularId, body(gueltig(), { homepage: "https://spam.example" }));
    expect(a.status).toBe(201);
    expect(await anzahl(f.formularId)).toBe(0);
  });

  test("zu schnell: 422 ZU_SCHNELL, nichts gespeichert", async () => {
    const f = await seite("oeffentlich");
    const a = await sende(null, f.formularId, body(gueltig(), { dauerMs: 300 }));
    expect(a.status).toBe(422);
    expect((await json(a)).code).toBe("ZU_SCHNELL");
    expect(await anzahl(f.formularId)).toBe(0);
  });

  test("je Adresse und Formular höchstens 10 Antworten in zehn Minuten, dann 429", async () => {
    const f = await seite("oeffentlich");
    const frisch = neueApp();
    const kopf = { "x-forwarded-for": "192.0.2.77" };
    const stati: number[] = [];
    for (let i = 0; i < 12; i++) {
      stati.push((await sende(null, f.formularId, body(gueltig()), kopf, frisch)).status);
    }
    expect(stati.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(stati.slice(10)).toEqual([429, 429]);
    expect(await anzahl(f.formularId)).toBe(10);
    // Eine andere Adresse ist nicht betroffen
    expect((await sende(null, f.formularId, body(gueltig()), { "x-forwarded-for": "192.0.2.78" }, frisch)).status).toBe(201);
  });

  test("je Adresse alle Formulare zusammen höchstens 30 Versuche, dann 429", async () => {
    const frisch = neueApp();
    const kopf = { "x-forwarded-for": "192.0.2.90" };
    let letzte = 0;
    for (let i = 0; i < 31; i++) {
      letzte = (await sende(null, randomUUID(), body(gueltig()), kopf, frisch)).status;
    }
    expect(letzte).toBe(429);
  });

  test("Obergrenze der Antworten: das Formular ist voll (409), auch bei gleichzeitigen Anfragen", async () => {
    const f = await seite("oeffentlich", { maxAntworten: 2 });
    const stati = await Promise.all(
      Array.from({ length: 5 }, () => sende(null, f.formularId, body(gueltig()))),
    ).then((r) => r.map((a) => a.status).sort());
    expect(stati).toEqual([201, 201, 409, 409, 409]);
    expect(await anzahl(f.formularId)).toBe(2);
  });

  test("eine Antwort je angemeldete Person: die zweite ist 409, anonyme bleiben unbegrenzt", async () => {
    const f = await seite("oeffentlich", { eineProPerson: true });
    expect((await sende(elternA, f.formularId, body(gueltig()))).status).toBe(201);
    const zweite = await sende(elternA, f.formularId, body(gueltig()));
    expect(zweite.status).toBe(409);
    expect((await json(zweite)).code).toBe("BEREITS_BEANTWORTET");
    expect((await sende(slA, f.formularId, body(gueltig()))).status).toBe(201);
    expect((await sende(null, f.formularId, body(gueltig()))).status).toBe(201);
    expect((await sende(null, f.formularId, body(gueltig()))).status).toBe(201);
  });
});

describe("Sichtbarkeit", () => {
  test("Seite für Angemeldete: ohne Anmeldung 404, mit Anmeldung 201, andere Abteilung 404", async () => {
    const f = await seite("angemeldet");
    expect((await sende(null, f.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(ohneLogin, f.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(demoEltern, f.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(elternA, f.formularId, body(gueltig()))).status).toBe(201);
    expect(await anzahl(f.formularId)).toBe(1);
  });

  test("Seite für eine Gruppe: nur wer den Tag trägt (und die Abteilungsleitung)", async () => {
    const f = await seite("tags");
    expect((await sende(elternA, f.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(slA, f.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(leitendeA, f.formularId, body(gueltig()))).status).toBe(201);
    expect((await sende(admin, f.formularId, body(gueltig()))).status).toBe(201);
  });

  test("öffentliche Seite, aber Baustein nur für Angemeldete oder für eine Gruppe", async () => {
    const ang = await seite("oeffentlich", {}, { art: "angemeldet" });
    expect((await sende(null, ang.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(elternA, ang.formularId, body(gueltig()))).status).toBe(201);
    const gruppe = await seite("oeffentlich", {}, { art: "tags", tagIds: [tagId] });
    expect((await sende(elternA, gruppe.formularId, body(gueltig()))).status).toBe(404);
    expect((await sende(leitendeA, gruppe.formularId, body(gueltig()))).status).toBe(201);
  });

  test("ein 404 sieht für «gibt es nicht» und «darfst du nicht» gleich aus", async () => {
    const f = await seite("angemeldet");
    const a = await sende(null, f.formularId, body(gueltig()));
    const b = await sende(null, randomUUID(), body(gueltig()));
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  test("Zeitgrenze: nach dem letzten Tag 410, am letzten Tag offen", async () => {
    const zu = await seite("oeffentlich", { schliesstAm: "2000-01-01" });
    const a = await sende(null, zu.formularId, body(gueltig()));
    expect(a.status).toBe(410);
    expect((await json(a)).code).toBe("FORMULAR_GESCHLOSSEN");
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
    const offen = await seite("oeffentlich", { schliesstAm: heute });
    expect((await sende(null, offen.formularId, body(gueltig()))).status).toBe(201);
  });

  test("Sperre der Website: 423 auch für die öffentliche Route", async () => {
    const f = await seite("oeffentlich");
    const schalter = (await import("../src/bereichsschalter.js")).erstelleSchalterZustand();
    const gesperrt = erstelleApp({ appMinVersion: "1.2.0", sql, db, auth, seiten: ladeSeiten(), schalter });
    schalter.setze({
      id: randomUUID(),
      abteilungId: welt.testabteilungId,
      bereich: "website",
      art: "sperre",
      hinweis: null,
      ende: null,
      websiteOffline: false,
      ausgeloestVon: "test",
      ausgeloestAm: new Date(),
    });
    expect((await sende(null, f.formularId, body(gueltig()), {}, gesperrt)).status).toBe(423);
    schalter.setze({
      id: randomUUID(),
      abteilungId: welt.testabteilungId,
      bereich: "website",
      art: "wartung",
      hinweis: null,
      ende: null,
      websiteOffline: false,
      ausgeloestVon: "test",
      ausgeloestAm: new Date(),
    });
    schalter.hebeAuf(welt.testabteilungId, "website", "sperre");
    expect((await sende(null, f.formularId, body(gueltig()), {}, gesperrt)).status).toBe(503);
    expect(await anzahl(f.formularId)).toBe(0);
  });
});

describe("Antworten in der Verwaltung", () => {
  let f: Awaited<ReturnType<typeof seite>>;
  const url = (pfad = "") => `/api/v1/admin/formulare${pfad}`;
  const hole = (konto: PersonaKonto | null, pfad: string, methode = "GET") =>
    app.request(url(pfad), { method: methode, headers: konto?.headers ?? {} });

  beforeAll(async () => {
    f = await seite("oeffentlich");
    await sende(null, f.formularId, body(gueltig({ [NAME]: "=1+1" })));
    await sende(elternA, f.formularId, body(gueltig({ [NAME]: "@SUMME(A1)" })));
    await sende(null, f.formularId, body(gueltig({ [NAME]: "+41 79" })));
    await sende(null, f.formularId, body(gueltig({ [NAME]: "-5; \"Zitat\"" })));
  });

  test("ohne Sitzung 401, ohne Recht 403: Eltern, Stufenleitung, Leitende", async () => {
    expect((await hole(null, "")).status).toBe(401);
    for (const k of [elternA, slA, leitendeA]) {
      expect((await hole(k, "")).status).toBe(403);
      expect((await hole(k, `/${f.formularId}`)).status).toBe(403);
      expect((await hole(k, `/${f.formularId}/antworten`)).status).toBe(403);
      expect((await hole(k, `/${f.formularId}/antworten.csv`)).status).toBe(403);
      expect((await hole(k, `/${f.formularId}/antworten`, "DELETE")).status).toBe(403);
    }
  });

  test("die Abteilungsleitung sieht die Liste der Formulare mit der Zahl der Antworten", async () => {
    const a = await hole(admin, "");
    expect(a.status).toBe(200);
    const liste = (await json(a)).formulare as Record<string, unknown>[];
    expect(liste.find((x) => x.formularId === f.formularId)).toMatchObject({
      titel: "Sommerlager",
      veroeffentlicht: true,
      anzahl: 4,
      aufbewahrenTage: 180,
    });
  });

  test("Einzelansicht und Liste: mit Beschriftungen der Version, Person oder anonym", async () => {
    const kopf = await json(await hole(admin, `/${f.formularId}`));
    expect(kopf.rechte).toEqual({ exportieren: true, loeschen: true });
    expect(kopf.felder).toHaveLength(4);
    const a = await json(await hole(admin, `/${f.formularId}/antworten?limit=3`));
    expect(a.antworten).toHaveLength(3);
    expect(a.weitere).toBe(true);
    const rest = await json(await hole(admin, `/${f.formularId}/antworten?limit=3&nach=${a.naechste}`));
    expect(rest.antworten).toHaveLength(1);
    expect(rest.weitere).toBe(false);
    const alle = [...a.antworten, ...rest.antworten] as { person: string | null; eintraege: { beschriftung: string; wert: string }[] }[];
    expect(alle.filter((x) => x.person !== null)).toHaveLength(1);
    expect(alle[0]!.eintraege[0]).toMatchObject({ beschriftung: "Name" });
    // Texte bleiben Text: kein HTML wird ausgewertet oder verändert
    expect(JSON.stringify(alle)).toContain("=1+1");
  });

  test("ein Formular einer anderen Abteilung und ein unbekanntes sind 404", async () => {
    const demo = await legePersonaAn(welt, "demoAdmin");
    expect((await hole(demo, `/${f.formularId}`)).status).toBe(404);
    expect((await hole(demo, `/${f.formularId}/antworten`)).status).toBe(404);
    expect((await hole(demo, `/${f.formularId}/antworten.csv`)).status).toBe(404);
    expect((await hole(demo, `/${f.formularId}/antworten`, "DELETE")).status).toBe(404);
    expect((await hole(admin, `/${randomUUID()}`)).status).toBe(404);
    expect((await hole(admin, `/kein-uuid`)).status).toBe(400);
    const liste = (await json(await hole(demo, ""))).formulare as { formularId: string }[];
    expect(liste.find((x) => x.formularId === f.formularId)).toBeUndefined();
  });

  test("CSV: UTF-8 mit BOM, Semikolon, Formeln entschärft, Anführungszeichen verdoppelt", async () => {
    const a = await hole(admin, `/${f.formularId}/antworten.csv`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(a.headers.get("content-disposition")).toContain("attachment");
    expect(a.headers.get("cache-control")).toBe("no-store");
    // text() schneidet das BOM ab: die Bytes prüft der Test selbst
    const bytes = new Uint8Array(await a.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
    expect(text.split("\r\n")[0]).toBe("Eingang;Person;Name;Anzahl;Mitbringen;Einverstanden");
    // Keine Zelle beginnt mit einem Formelzeichen
    for (const zeile of text.split("\r\n").slice(1).filter(Boolean)) {
      for (const zelle of zeile.split(";")) {
        expect(zelle).not.toMatch(/^[=+\-@\t]/);
      }
    }
    expect(text).toContain("'=1+1");
    expect(text).toContain("'@SUMME(A1)");
    expect(text).toContain("'+41 79");
    expect(text).toContain(`"'-5; ""Zitat"""`);
    expect(text).toContain("Ja, zugestimmt");
    expect(
      await db
        .select({ n: count() })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.aktion, "formular_export")),
    ).toEqual([{ n: expect.any(Number) }]);
  });

  test("Löschen: eine Antwort, dann alle; die Antwort der anderen Abteilung bleibt unberührt", async () => {
    const g = await seite("oeffentlich");
    for (let i = 0; i < 3; i++) await sende(null, g.formularId, body(gueltig()));
    const [erste] = (await json(await hole(admin, `/${g.formularId}/antworten`))).antworten as { id: string }[];
    const weg = await hole(admin, `/${g.formularId}/antworten/${erste!.id}`, "DELETE");
    expect(weg.status).toBe(204);
    expect((await hole(admin, `/${g.formularId}/antworten/${erste!.id}`, "DELETE")).status).toBe(404);
    expect(await anzahl(g.formularId)).toBe(2);
    const alle = await hole(admin, `/${g.formularId}/antworten`, "DELETE");
    expect(await json(alle)).toEqual({ geloescht: 2 });
    expect(await anzahl(g.formularId)).toBe(0);
    // Das Formular bleibt in der Liste (veröffentlicht), nur ohne Antworten
    const liste = (await json(await hole(admin, ""))).formulare as { formularId: string; anzahl: number }[];
    expect(liste.find((x) => x.formularId === g.formularId)?.anzahl).toBe(0);
  });

  test("ein Formular, das nicht mehr auf der Seite steht, bleibt mit seinen Antworten sichtbar", async () => {
    const g = await seite("oeffentlich", { titel: "Altes Formular" });
    await sende(null, g.formularId, body(gueltig()));
    await db.update(schema.seite).set({ veroeffentlichteVersionId: null }).where(eq(schema.seite.id, g.seiteId));
    expect((await sende(null, g.formularId, body(gueltig()))).status).toBe(404);
    const z = ((await json(await hole(admin, ""))).formulare as Record<string, unknown>[]).find((x) => x.formularId === g.formularId);
    expect(z).toMatchObject({ veroeffentlicht: false, anzahl: 1, titel: "Altes Formular" });
    const a = await json(await hole(admin, `/${g.formularId}/antworten`));
    expect(a.antworten[0].eintraege[0].beschriftung).toBe("Name");
  });

  test("alte Antworten bleiben lesbar, wenn die Felder später geändert werden", async () => {
    const g = await seite("oeffentlich");
    await sende(null, g.formularId, body(gueltig({ [NAME]: "Alt" })));
    // Neue Version: Feld «Name» umbenannt, Feld «Anzahl» entfernt
    const neu = felder().filter((x) => x.id !== ZAHL).map((x) => (x.id === NAME ? { ...x, beschriftung: "Vorname" } : x));
    const [v2] = await db
      .insert(schema.seiteVersion)
      .values({
        seiteId: g.seiteId,
        nr: 2,
        inhalt: { v: 1, titel: "U", bausteine: [{ id: g.formularId, typ: "formular", daten: { felder: neu, datenschutz: "Hinweis" } }] },
      })
      .returning();
    await db.update(schema.seite).set({ veroeffentlichteVersionId: v2!.id }).where(eq(schema.seite.id, g.seiteId));
    await sende(null, g.formularId, body(gueltig({ [NAME]: "Neu" })));
    const a = await json(await hole(admin, `/${g.formularId}/antworten`));
    const [neuere, aeltere] = a.antworten as { eintraege: { beschriftung: string; wert: string }[] }[];
    expect(neuere!.eintraege[0]).toEqual(expect.objectContaining({ beschriftung: "Vorname", wert: "Neu" }));
    expect(aeltere!.eintraege[0]).toEqual(expect.objectContaining({ beschriftung: "Name", wert: "Alt" }));
    const csv = await (await hole(admin, `/${g.formularId}/antworten.csv`)).text();
    expect(csv).toContain("Eingang;Person;Vorname;Mitbringen;Einverstanden");
    expect(csv).toContain("Alt");
    expect(csv).toContain("Neu");
  });
});

describe("Aufbewahrung und Konto", () => {
  test("der Lauf löscht Antworten nach ihrer Frist und nur diese", async () => {
    const f = await seite("oeffentlich");
    await sende(null, f.formularId, body(gueltig()));
    await sende(null, f.formularId, body(gueltig()));
    const [erste] = await db.select().from(schema.formularAntwort).where(eq(schema.formularAntwort.formularId, f.formularId));
    await db
      .update(schema.formularAntwort)
      .set({ loeschenAm: new Date(Date.now() - 1000) })
      .where(eq(schema.formularAntwort.id, erste!.id));
    expect(await loescheAlteFormularAntworten(db)).toBeGreaterThanOrEqual(1);
    expect(await anzahl(f.formularId)).toBe(1);
  });

  test("mit dem Konto verschwindet nur die Zuordnung, die Antwort bleibt anonym", async () => {
    const f = await seite("oeffentlich");
    const [u] = await db
      .insert(schema.user)
      .values({
        id: randomUUID(),
        name: "Wegwerf Konto",
        email: `${randomUUID()}@beispiel.invalid`,
        emailVerified: false,
        abteilungId: welt.testabteilungId,
      } as never)
      .returning();
    await db.insert(schema.formularAntwort).values({
      abteilungId: welt.testabteilungId,
      seiteId: f.seiteId,
      formularId: f.formularId,
      versionId: f.versionId,
      userId: u!.id,
      antworten: { [NAME]: "Weg" },
      loeschenAm: new Date(Date.now() + 1e9),
    });
    await db.delete(schema.user).where(eq(schema.user.id, u!.id));
    const [z] = await db.select().from(schema.formularAntwort).where(eq(schema.formularAntwort.formularId, f.formularId));
    expect(z).toMatchObject({ userId: null });
    expect(z!.antworten).toEqual({ [NAME]: "Weg" });
  });

  test("die Datenbank lehnt zu grosse und falsch geformte Antworten ab", async () => {
    const f = await seite("oeffentlich");
    const einfuegen = (antworten: unknown) =>
      db.insert(schema.formularAntwort).values({
        abteilungId: welt.testabteilungId,
        seiteId: f.seiteId,
        formularId: f.formularId,
        versionId: f.versionId,
        antworten: antworten as never,
        loeschenAm: new Date(Date.now() + 1e9),
      });
    await expect(einfuegen(["liste"])).rejects.toThrow();
    await expect(einfuegen({ x: "a".repeat(25000) })).rejects.toThrow();
  });
});
