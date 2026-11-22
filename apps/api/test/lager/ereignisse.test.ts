import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pgSchema, text } from "drizzle-orm/pg-core";
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
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { lagerSpalten } from "../../src/db/schema-lager.js";
import {
  Ereignisverteiler,
  ereignisverteiler,
} from "../../src/lager/ereignisse.js";
import { legeZeileAn } from "../../src/lager/sync.js";
import { registriereLagerTabelle } from "../../src/lager/tabellen.js";
import { erstelleEreignisRouten } from "../../src/routes/lager/ereignisse.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL, BESITZER_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { leseStrom } from "./sse.js";

bereiteAuthTestsVor();

// Server-Sent Events des Lagers (#367) gegen die ganze App mit echten Sitzungen. Zwei Tabellen nur dieses Tests (Schema lager_ereignisse_test): «objekt» mit Leserecht aufgaben.lesen_alle (das Team hat es nicht) und «offen» mit pinnwand.lesen (alle Rollen)
const sql = postgres(API_URL);
const besitzer = postgres(BESITZER_URL, { max: 1, onnotice: () => {} });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
const SCHEMA = "lager_ereignisse_test";
afterAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.end();
  await sql.end();
});

const testSchema = pgSchema(SCHEMA);
const objekt = testSchema.table("objekt", {
  ...lagerSpalten(),
  titel: text("titel").notNull(),
});
const offen = testSchema.table("offen", {
  ...lagerSpalten(),
  titel: text("titel").notNull(),
});
const tabelleSql = (name: string) => `
  create table ${SCHEMA}.${name} (
    id uuid primary key default uuidv7(),
    lager_id uuid not null references public.lager(id) on delete cascade,
    version integer not null default 1,
    erstellt_am timestamptz not null default now(),
    erstellt_von uuid,
    geaendert_am timestamptz not null default now(),
    geaendert_von uuid,
    geloescht_am timestamptz,
    geloescht_von uuid,
    lager_seq bigint not null,
    titel text not null
  )`;

let welt: Welt;
let admin: PersonaKonto;
let lagerleitung: PersonaKonto;
let leitung: PersonaKonto;
let team: PersonaKonto;
let lesen: PersonaKonto;
let ohneMitgliedschaft: PersonaKonto;
let fremd: PersonaKonto;
let ohneLogin: PersonaKonto;
let lagerId: string;
let geschlossenId: string;

beforeAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.unsafe(`create schema ${SCHEMA}`);
  await besitzer.unsafe(tabelleSql("objekt"));
  await besitzer.unsafe(tabelleSql("offen"));
  await besitzer.unsafe(
    `grant usage on schema ${SCHEMA} to cevi_os_api; grant select, insert, update, delete on all tables in schema ${SCHEMA} to cevi_os_api`,
  );
  registriereLagerTabelle({ tabelle: objekt, recht: "aufgaben.lesen_alle" });
  registriereLagerTabelle({ tabelle: offen, recht: "pinnwand.lesen" });

  welt = await erstelleWelt(db, auth);
  [admin, lagerleitung, leitung, team, lesen, ohneMitgliedschaft, fremd] =
    await Promise.all(
      (
        [
          "admin",
          "slA",
          "slB",
          "leitendeA",
          "leitendeB",
          "elternA",
          "demoEltern",
        ] as const
      ).map((p) => legePersonaAn(welt, p)),
    );
  ohneLogin = await legePersonaAn(welt, "ohneLogin");
  const legeLager = async (status: "aktiv" | "abgeschlossen") => {
    const [zeile] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Ereignislager",
        von: "2027-07-10",
        bis: "2027-07-24",
        status,
      })
      .returning({ id: schema.lager.id });
    for (const [konto, rolle] of [
      [lagerleitung, "lagerleitung"],
      [leitung, "leitung"],
      [team, "team"],
      [lesen, "lesen"],
    ] as const) {
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId: zeile.id, personId: konto.id!, rolle });
    }
    return zeile.id;
  };
  lagerId = await legeLager("aktiv");
  geschlossenId = await legeLager("abgeschlossen");
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  ereignisverteiler.schliesseAlle();
  ausgabe.mockRestore();
});

// Nur die Route mit einem eigenen Verteiler (kleinen Grenzen), Person und Sitzung aus dem Header
const miniApp = (
  verteiler: Ereignisverteiler,
  konten: Record<string, PersonaKonto>,
) =>
  new Hono()
    .use(async (c, next) => {
      const konto = konten[c.req.header("x-konto") ?? "t"]!;
      c.set(
        "person" as never,
        {
          id: konto.id,
          abteilungId: welt.testabteilungId,
          admin: false,
          zweiterFaktor: false,
          rollen: [],
        } as never,
      );
      c.set("sitzungId" as never, randomUUID() as never);
      await next();
    })
    .route("/", erstelleEreignisRouten({ db, verteiler }));

const oeffne = (
  konto: PersonaKonto,
  id = lagerId,
  kopf: Record<string, string> = {},
  abfrage = "",
) =>
  app.request(`/api/v1/lager/${id}/ereignisse${abfrage}`, {
    headers: { ...konto.headers, ...kopf },
  });
// Verbindet und liest die erste Nachricht
async function verbinde(
  konto: PersonaKonto,
  id = lagerId,
  kopf: Record<string, string> = {},
  abfrage = "",
) {
  const antwort = await oeffne(konto, id, kopf, abfrage);
  expect(antwort.status).toBe(200);
  const strom = leseStrom(antwort);
  const erste = await strom.naechster();
  if (typeof erste !== "object") throw new Error("keine erste Nachricht");
  return { strom, erste, antwort };
}

// Schreibt über den Sync-Kern, wie ein Modul es täte
const schreibe = (
  tabelle: typeof objekt | typeof offen,
  titel = "Geheimer Titel",
  id = lagerId,
) =>
  db.transaction((tx) =>
    legeZeileAn(
      tx,
      tabelle,
      { lagerId: id, personId: lagerleitung.id! },
      {
        titel,
      },
    ),
  );
const seq = async (id = lagerId) =>
  (
    await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id))
  )[0]!.seq;

describe("GET /api/v1/lager/{id}/ereignisse", () => {
  test("öffnet einen Event-Stream, die erste Nachricht nennt nur den Stand", async () => {
    await schreibe(objekt);
    const { erste, antwort, strom } = await verbinde(lagerleitung);
    expect(antwort.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(antwort.headers.get("cache-control")).toContain("no-cache");
    expect(erste).toMatchObject({
      event: "bereit",
      retry: "5000",
      data: { bis: await seq() },
      id: String(await seq()),
    });
    await strom.schliesse();
  });

  test("ein Schreibvorgang erreicht jede Verbindung des Lagers, gefiltert nach lesbaren Typen, ohne Inhalt", async () => {
    const [l, t, ls] = await Promise.all(
      [lagerleitung, team, lesen].map((k) => verbinde(k)),
    );
    const zeile = await schreibe(objekt, "Geheimer Titel");

    const fuerLeitung = await l.strom.naechstesEreignis();
    expect(fuerLeitung).toMatchObject({
      event: "aenderung",
      data: { bis: await seq(), objekttypen: ["objekt"] },
    });
    expect((await ls.strom.naechstesEreignis()) as object).toMatchObject({
      data: { objekttypen: ["objekt"] },
    });
    // Das Team darf «objekt» nicht lesen: Es erfährt nichts, auch nicht, dass etwas geschah
    expect(await t.strom.naechstesEreignis(300)).toBeUndefined();

    // Nie Inhalt, ID oder Name; genau diese beiden Felder
    for (const block of [fuerLeitung]) {
      if (typeof block !== "object") throw new Error("kein Block");
      expect(Object.keys(block.data as object).sort()).toEqual([
        "bis",
        "objekttypen",
      ]);
      expect(block.roh).not.toContain("Geheimer");
      expect(block.roh).not.toContain(zeile.id);
    }

    // Ein Typ, den alle lesen, erreicht auch das Team
    await schreibe(offen);
    expect(await t.strom.naechstesEreignis()).toMatchObject({
      data: { objekttypen: ["offen"] },
    });
    await Promise.all([l, t, ls].map((x) => x.strom.schliesse()));
  });

  test("mehrere Schreibvorgänge in kurzer Zeit ergeben eine Meldung bis zur letzten Folgenummer", async () => {
    const { strom } = await verbinde(lagerleitung);
    await db.transaction(async (tx) => {
      for (const titel of ["a", "b", "c"]) {
        await legeZeileAn(
          tx,
          objekt,
          { lagerId, personId: lagerleitung.id! },
          { titel },
        );
      }
    });
    const block = await strom.naechstesEreignis();
    expect(block).toMatchObject({ data: { bis: await seq() } });
    expect(await strom.naechstesEreignis(300)).toBeUndefined();
    await strom.schliesse();
  });

  test("eine zurückgerollte Transaktion meldet nichts", async () => {
    const { strom } = await verbinde(lagerleitung);
    await expect(
      db.transaction(async (tx) => {
        await legeZeileAn(
          tx,
          objekt,
          { lagerId, personId: lagerleitung.id! },
          { titel: "weg" },
        );
        throw new Error("abbrechen");
      }),
    ).rejects.toThrow("abbrechen");
    expect(await strom.naechstesEreignis(300)).toBeUndefined();
    await strom.schliesse();
  });

  test("ein anderes Lager meldet an dieses nichts", async () => {
    const { strom } = await verbinde(lagerleitung);
    const [anderes] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Anderes",
        von: "2027-07-10",
        bis: "2027-07-24",
      })
      .returning({ id: schema.lager.id });
    await schreibe(objekt, "x", anderes.id);
    expect(await strom.naechstesEreignis(300)).toBeUndefined();
    await strom.schliesse();
  });

  describe("Wiederverbinden", () => {
    test("mit Last-Event-ID holt die Verbindung nach, was inzwischen geschah", async () => {
      const erste = await verbinde(team);
      const alt = Number(erste.erste.id);
      await erste.strom.schliesse();
      await schreibe(offen);
      await schreibe(objekt);

      const neu = await verbinde(team, lagerId, {
        "Last-Event-ID": String(alt),
      });
      expect(neu.erste).toMatchObject({
        event: "aenderung",
        id: String(await seq()),
        // Alle Typen, die das Team lesen darf (auch die der echten Module, zum Beispiel Aufgaben und Dateien), nicht mehr: nicht «objekt»
        data: {
          bis: await seq(),
          objekttypen: expect.arrayContaining(["offen"]),
        },
      });
      expect(neu.erste).not.toMatchObject({
        data: { objekttypen: expect.arrayContaining(["objekt"]) },
      });
      await neu.strom.schliesse();
    });

    test("ist die Folgenummer aktuell, kommt «bereit»; auch mit ?seit=", async () => {
      await schreibe(offen);
      const jetzt = await seq();
      const a = await verbinde(team, lagerId, {
        "Last-Event-ID": String(jetzt),
      });
      expect(a.erste).toMatchObject({ event: "bereit", data: { bis: jetzt } });
      const b = await verbinde(team, lagerId, {}, `?seit=${jetzt - 1}`);
      expect(b.erste).toMatchObject({
        event: "aenderung",
        data: { bis: jetzt },
      });
      await Promise.all([a.strom.schliesse(), b.strom.schliesse()]);
    });

    test("eine Folgenummer aus der Zukunft heisst neu laden", async () => {
      const { erste, strom } = await verbinde(team, lagerId, {
        "Last-Event-ID": String((await seq()) + 100),
      });
      expect(erste).toMatchObject({
        event: "neu-laden",
        data: { bis: await seq() },
      });
      await strom.schliesse();
    });

    test("ein ungültiger Last-Event-ID zählt nicht", async () => {
      const { erste, strom } = await verbinde(team, lagerId, {
        "Last-Event-ID": "abc",
      });
      expect(erste).toMatchObject({ event: "bereit" });
      await strom.schliesse();
    });
  });

  describe("Rechte", () => {
    test("jedes Mitglied und die Abteilungsleitung dürfen verbinden", async () => {
      for (const konto of [admin, lagerleitung, leitung, team, lesen]) {
        const { strom } = await verbinde(konto);
        await strom.schliesse();
      }
    });

    test("Nicht-Mitglied und fremde Abteilung 404, ohne Anmeldung 401, ungültige ID und Abfrage 400", async () => {
      expect((await oeffne(ohneMitgliedschaft)).status).toBe(404);
      expect((await oeffne(fremd)).status).toBe(404);
      expect((await oeffne(ohneLogin)).status).toBe(401);
      expect((await oeffne(team, "keine-id")).status).toBe(400);
      expect((await oeffne(team, lagerId, {}, "?seit=-1")).status).toBe(400);
      expect((await oeffne(team, lagerId, {}, "?x=1")).status).toBe(400);
      expect((await oeffne(team, randomUUID())).status).toBe(404);
      expect(ereignisverteiler.anzahl).toBe(0);
    });

    test("ein abgeschlossenes Lager ist lesbar", async () => {
      const { erste, strom } = await verbinde(team, geschlossenId);
      expect(erste).toMatchObject({ event: "bereit" });
      await strom.schliesse();
    });
  });

  describe("Obergrenzen", () => {
    test("das vierte Gerät eines Kontos beendet die älteste Verbindung", async () => {
      const a = await verbinde(team);
      const b = await verbinde(team);
      const c = await verbinde(team);
      expect(ereignisverteiler.anzahlKonto(team.id!)).toBe(3);
      const d = await verbinde(team);
      expect(ereignisverteiler.anzahlKonto(team.id!)).toBe(3);
      // Die älteste endet mit der Aufforderung, neu zu verbinden
      expect(await a.strom.naechstesEreignis()).toMatchObject({
        event: "ende",
        data: { grund: "neu-verbinden" },
      });
      expect(await a.strom.naechster()).toBe("ende");
      // Die anderen laufen weiter
      await schreibe(offen);
      for (const x of [b, c, d]) {
        expect(await x.strom.naechstesEreignis()).toMatchObject({
          event: "aenderung",
        });
      }
      // Eine zweite Person ist davon nicht betroffen
      const andere = await verbinde(lesen);
      expect(ereignisverteiler.anzahlKonto(lesen.id!)).toBe(1);
      await Promise.all([b, c, d, andere].map((x) => x.strom.schliesse()));
    });

    test("je Lager und je Instanz lehnt die neue Verbindung ab (429)", async () => {
      const klein = new Ereignisverteiler({
        proLager: 2,
        proInstanz: 3,
        kontrolleMs: 3_600_000,
      });
      const mini = miniApp(klein, { l: lagerleitung, t: team, le: lesen });
      const frage = (konto: string, id = lagerId) =>
        mini.request(`/${id}/ereignisse`, { headers: { "x-konto": konto } });
      const a = await frage("l");
      const b = await frage("t");
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const zuViele = await frage("le");
      expect(zuViele.status).toBe(429);
      expect(zuViele.headers.get("retry-after")).toBe("30");
      expect(await zuViele.json()).toMatchObject({
        code: "ZU_VIELE_VERBINDUNGEN",
      });
      // Ein anderes Lager hat noch Platz, bis die Instanz voll ist
      const c = await frage("l", geschlossenId);
      expect(c.status).toBe(200);
      expect((await frage("t", geschlossenId)).status).toBe(429);
      expect(klein.anzahl).toBe(3);
      // Wer auflegt, macht Platz
      await a.body!.cancel();
      expect(klein.anzahlLager(lagerId)).toBe(1);
      expect((await frage("le")).status).toBe(200);
      klein.schliesseAlle();
    });

    test("ein Client, der nicht abholt, verliert seine Verbindung", async () => {
      const klein = new Ereignisverteiler({ entprellMs: 0 });
      const mini = miniApp(klein, { t: lagerleitung });
      const antwort = await mini.request(`/${lagerId}/ereignisse`);
      expect(klein.anzahl).toBe(1);
      // Der Client liest nichts: nach 16 unabgeholten Meldungen ist Schluss
      for (let i = 1; i <= 30 && klein.anzahl > 0; i++) {
        klein.melde(lagerId, 1000 + i, "objekt");
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(klein.anzahl).toBe(0);
      await antwort.body!.cancel();
    });
  });

  describe("Herzschlag", () => {
    test("kommt ohne Zugriff auf die Datenbank", async () => {
      const klein = new Ereignisverteiler({
        herzschlagMs: 20,
        kontrolleMs: 3_600_000,
      });
      const mini = miniApp(klein, { t: team });
      const antwort = await mini.request(`/${lagerId}/ereignisse`);
      const strom = leseStrom(antwort);
      expect(await strom.naechster()).toMatchObject({ event: "bereit" });
      const abfragen = vi.spyOn(db, "select");
      const ausfuehren = vi.spyOn(db, "execute");
      const herz = await strom.naechster();
      const zweiter = await strom.naechster();
      expect(herz).toMatchObject({ kommentar: "herzschlag" });
      expect(zweiter).toMatchObject({ kommentar: "herzschlag" });
      expect(abfragen).not.toHaveBeenCalled();
      expect(ausfuehren).not.toHaveBeenCalled();
      abfragen.mockRestore();
      ausfuehren.mockRestore();
      await strom.schliesse();
      klein.schliesseAlle();
    });
  });

  describe("Mitgliedschaft, Rolle und Sitzung wechseln", () => {
    const setzeRolle = (personId: string, rolle: string) =>
      app.request(`/api/v1/admin/lager/${lagerId}/mitglieder/${personId}`, {
        method: "PUT",
        headers: { ...admin.headers, "content-type": "application/json" },
        body: JSON.stringify({ rolle }),
      });

    async function endet(strom: ReturnType<typeof leseStrom>) {
      expect(await strom.naechstesEreignis()).toMatchObject({
        event: "ende",
        data: { grund: "neu-verbinden" },
      });
      expect(await strom.naechster()).toBe("ende");
    }

    test("ein Rollenwechsel durch die Verwaltung beendet nur die Verbindungen dieser Person", async () => {
      const t = await verbinde(team);
      const l = await verbinde(lesen);
      expect((await setzeRolle(team.id!, "leitung")).status).toBe(204);
      await endet(t.strom);
      expect(ereignisverteiler.anzahlKonto(team.id!)).toBe(0);
      // Beim Neuverbinden gilt die neue Rolle: Leitung liest «objekt»
      const neu = await verbinde(team);
      await schreibe(objekt);
      expect(await neu.strom.naechstesEreignis()).toMatchObject({
        data: { objekttypen: ["objekt"] },
      });
      // Eine andere Person bleibt verbunden
      expect(ereignisverteiler.anzahlKonto(lesen.id!)).toBe(1);
      await setzeRolle(team.id!, "team");
      await Promise.all([l.strom.schliesse(), neu.strom.schliesse()]);
    });

    test("Entfernen beendet die Verbindung, das Neuverbinden endet mit 404", async () => {
      // Das Konto wird entfernt und danach wiederhergestellt
      const t = await verbinde(team);
      const antwort = await app.request(
        `/api/v1/admin/lager/${lagerId}/mitglieder/${team.id}`,
        { method: "DELETE", headers: admin.headers },
      );
      expect(antwort.status).toBe(204);
      await endet(t.strom);
      expect((await oeffne(team)).status).toBe(404);
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId, personId: team.id!, rolle: "team" });
    });

    test("eine Änderung der Rechte beendet alle Verbindungen des Lagers, danach gelten die neuen", async () => {
      const t = await verbinde(team);
      const l = await verbinde(lagerleitung);
      const andereLager = await verbinde(team, geschlossenId);
      const antwort = await app.request(`/api/v1/lager/${lagerId}/rechte`, {
        method: "PUT",
        headers: {
          ...lagerleitung.headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rechte: [
            { rolle: "team", recht: "aufgaben.lesen_alle", erlaubt: true },
          ],
        }),
      });
      expect(antwort.status).toBe(204);
      await endet(t.strom);
      await endet(l.strom);
      const neu = await verbinde(team);
      await schreibe(objekt);
      expect(await neu.strom.naechstesEreignis()).toMatchObject({
        data: { objekttypen: ["objekt"] },
      });
      expect(ereignisverteiler.anzahlLager(geschlossenId)).toBe(1);
      await andereLager.strom.schliesse();
      await neu.strom.schliesse();
      await db
        .delete(schema.lagerRolleRecht)
        .where(eq(schema.lagerRolleRecht.lagerId, lagerId));
    });

    test("die Kontrolle beendet Verbindungen, deren Sitzung weg ist, und lässt gültige in Ruhe", async () => {
      const wegwerf = await legePersonaAn(welt, "leitendeB");
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId, personId: wegwerf.id!, rolle: "lesen" });
      const w = await verbinde(wegwerf);
      const t = await verbinde(team);
      await db
        .delete(schema.session)
        .where(eq(schema.session.userId, wegwerf.id!));
      await ereignisverteiler.kontrolliere();
      await endet(w.strom);
      expect(await t.strom.naechstesEreignis(300)).toBeUndefined();
      expect(ereignisverteiler.anzahlKonto(team.id!)).toBe(1);
      await t.strom.schliesse();
    });

    test.each([
      [
        "gesperrtem Konto",
        (id: string) =>
          db
            .update(schema.user)
            .set({ banned: true })
            .where(eq(schema.user.id, id)),
        (id: string) =>
          db
            .update(schema.user)
            .set({ banned: false })
            .where(eq(schema.user.id, id)),
      ],
      [
        "geänderter Rolle in der Datenbank",
        (id: string) =>
          db
            .update(schema.lagerMitglied)
            .set({ rolle: "lesen" })
            .where(eq(schema.lagerMitglied.personId, id)),
        (id: string) =>
          db
            .update(schema.lagerMitglied)
            .set({ rolle: "leitung" })
            .where(eq(schema.lagerMitglied.personId, id)),
      ],
      [
        "einem Konto, das Abteilungsleitung wird",
        (id: string) =>
          db
            .update(schema.user)
            .set({ role: "admin" })
            .where(eq(schema.user.id, id)),
        (id: string) =>
          db
            .update(schema.user)
            .set({ role: "user" })
            .where(eq(schema.user.id, id)),
      ],
      [
        "abgelaufener Sitzung",
        (id: string) =>
          db
            .update(schema.session)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(schema.session.userId, id)),
        async () => {},
      ],
    ])("die Kontrolle beendet bei %s", async (_name, aendere, zurueck) => {
      const person = await legePersonaAn(welt, "slB");
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId, personId: person.id!, rolle: "leitung" });
      const v = await verbinde(person);
      await aendere(person.id!);
      await ereignisverteiler.kontrolliere();
      await endet(v.strom);
      await zurueck(person.id!);
    });

    test("scheitert die Kontrolle selbst, enden alle Verbindungen (SR-54)", async () => {
      const v = await verbinde(team);
      const kaputt = vi.spyOn(db, "select").mockImplementation(() => {
        throw new Error("Datenbank weg");
      });
      await ereignisverteiler.kontrolliere();
      kaputt.mockRestore();
      await endet(v.strom);
    });
  });

  test("ohne Verbindung läuft kein Zeitgeber und nichts hält den Verteiler", async () => {
    const klein = new Ereignisverteiler();
    klein.melde(lagerId, 5, "objekt");
    expect(klein.anzahl).toBe(0);
    const zeitgeber = vi.spyOn(globalThis, "setTimeout");
    klein.melde(lagerId, 6, "objekt");
    // Ohne Verbindung im Lager wird nichts eingeplant
    expect(zeitgeber).not.toHaveBeenCalled();
    zeitgeber.mockRestore();
  });

  test("der Client legt auf: Die Verbindung verschwindet", async () => {
    const { strom } = await verbinde(team);
    expect(ereignisverteiler.anzahlKonto(team.id!)).toBe(1);
    await strom.schliesse();
    await vi.waitFor(() =>
      expect(ereignisverteiler.anzahlKonto(team.id!)).toBe(0),
    );
  });
});
