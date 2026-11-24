import { randomUUID } from "node:crypto";
import { and, eq, sql as rohsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import type { Db } from "../../src/db/client.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import { zaehleOffeneAnfragen } from "../../src/termine/raum.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

// Offene Raumanfragen gibt es erst mit #447: Die Tests stellen sie vor
vi.mock("../../src/termine/raum.js", async (original) => {
  const echt = await original<typeof import("../../src/termine/raum.js")>();
  return { ...echt, zaehleOffeneAnfragen: vi.fn(async () => 0) };
});

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = {
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
};
const app = erstelleApp(optionen);
afterAll(() => sql.end());

let welt: Welt;
let leitung: PersonaKonto;
let ohneFaktor: PersonaKonto;
let stufenleitung: PersonaKonto;
let eltern: PersonaKonto;
let fremdeLeitung: PersonaKonto;
let fremdeEltern: PersonaKonto;
// Die Tests teilen die Abteilung mit anderen Dateien: Alle Namen tragen diesen Vorsatz, die Listen beginnen dahinter
const VORSATZ = `zzraum${randomUUID().slice(0, 8)}`;
let nr = 0;
const name = (rest = "") => `${VORSATZ}${(nr++).toString(36)}${rest}`;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  leitung = await legePersonaAn(welt, "admin");
  ohneFaktor = await legePersonaAn(welt, "adminOhneZweitenFaktor");
  stufenleitung = await legePersonaAn(welt, "slA");
  eltern = await legePersonaAn(welt, "elternA");
  fremdeLeitung = await legePersonaAn(welt, "demoAdmin");
  fremdeEltern = await legePersonaAn(welt, "demoEltern");
});
beforeEach(() => vi.mocked(zaehleOffeneAnfragen).mockResolvedValue(0));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
  anwendung = app,
): Promise<Antwort> {
  const res = await anwendung.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const BASIS = "/api/v1/admin/raeume";
const anlegen = (werte: Record<string, unknown> = {}, konto = leitung) =>
  anfrage(konto, "POST", BASIS, { name: name(), ...werte });
async function neuerRaum(werte: Record<string, unknown> = {}) {
  const r = await anlegen(werte);
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const zeile = async (id: string) =>
  (await db.select().from(schema.raum).where(eq(schema.raum.id, id)))[0];
async function neuerTag(abteilungId = welt.testabteilungId) {
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId,
      typ: "team",
      name: `Team ${randomUUID().slice(0, 8)}`,
      kuerzel: "T",
    })
    .returning({ id: schema.tag.id, name: schema.tag.name });
  return t;
}
const mit = (vorsatz: string, raeume: { name: string }[]) =>
  raeume.filter((r) => r.name.startsWith(vorsatz));

describe("Räume anlegen", () => {
  test("legt einen Raum mit allen Angaben an und zeigt ihn in der Liste mit dem Team", async () => {
    const team = await neuerTag();
    const n = name();
    const a = await anlegen({
      name: ` ${n} `,
      ort: "Pfarrhaus, 1. Stock",
      beschreibung: "Mit Beamer",
      kapazitaet: 25,
      teamId: team.id,
    });
    expect(a.status).toBe(201);
    expect(await zeile(a.body.id)).toMatchObject({
      abteilungId: welt.testabteilungId,
      name: n,
      ort: "Pfarrhaus, 1. Stock",
      beschreibung: "Mit Beamer",
      kapazitaet: 25,
      teamTagId: team.id,
      aktiv: true,
    });
    const liste = await anfrage(
      leitung,
      "GET",
      `${BASIS}?nach=${encodeURIComponent(VORSATZ)}&limit=100`,
    );
    expect(
      liste.body.raeume.find((r: { id: string }) => r.id === a.body.id),
    ).toEqual({
      id: a.body.id,
      name: n,
      ort: "Pfarrhaus, 1. Stock",
      beschreibung: "Mit Beamer",
      kapazitaet: 25,
      aktiv: true,
      team: { id: team.id, name: team.name },
    });
  });

  test("nur der Name ist Pflicht; der Rest ist leer und der Raum aktiv", async () => {
    const id = await neuerRaum();
    expect(await zeile(id)).toMatchObject({
      ort: null,
      beschreibung: null,
      kapazitaet: null,
      teamTagId: null,
      aktiv: true,
    });
  });

  test("derselbe Name ist ohne Gross-/Kleinschreibung nur einmal möglich, in einer anderen Abteilung aber frei", async () => {
    const n = name("Saal");
    await neuerRaum({ name: n });
    expect((await anlegen({ name: n.toUpperCase() })).status).toBe(409);
    expect((await anlegen({ name: n.toUpperCase() })).body.code).toBe(
      "RAUM_VORHANDEN",
    );
    const anderswo = await anlegen({ name: n }, fremdeLeitung);
    expect(anderswo.status).toBe(201);
    expect((await zeile(anderswo.body.id))?.abteilungId).not.toBe(
      welt.testabteilungId,
    );
  });

  test.each([
    ["leerer Name", { name: "   " }],
    ["Name über 100 Zeichen", { name: "x".repeat(101) }],
    ["Ort über 200 Zeichen", { ort: "x".repeat(201) }],
    ["Beschreibung über 1000 Zeichen", { beschreibung: "x".repeat(1001) }],
    ["Kapazität 0", { kapazitaet: 0 }],
    ["Kapazität über 1000", { kapazitaet: 1001 }],
    ["Kapazität mit Komma", { kapazitaet: 2.5 }],
    ["Team keine UUID", { teamId: "team" }],
    ["unbekanntes Feld", { farbe: "rot" }],
  ])("%s: 400", async (_f, werte) => {
    expect((await anlegen(werte)).status).toBe(400);
  });

  test("ein Team einer anderen Abteilung ist 400 TEAM_UNBEKANNT", async () => {
    const fremd = await neuerTag(welt.demoAbteilungId);
    const a = await anlegen({ teamId: fremd.id });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("TEAM_UNBEKANNT");
  });

  test("schreibt einen Audit-Eintrag ohne Namen", async () => {
    const n = name();
    const id = await neuerRaum({ name: n });
    const [eintrag] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, id),
          eq(schema.auditLog.aktion, "raum_angelegt"),
        ),
      );
    expect(eintrag).toMatchObject({
      akteurId: leitung.id,
      zielTyp: "raum",
      abteilungId: welt.testabteilungId,
    });
    expect(JSON.stringify(eintrag)).not.toContain(n);
  });
});

describe("Räume ändern", () => {
  test("ändert nur die genannten Angaben; null leert Ort, Beschreibung, Kapazität und Team", async () => {
    const team = await neuerTag();
    const id = await neuerRaum({
      ort: "Keller",
      beschreibung: "Kalt",
      kapazitaet: 8,
      teamId: team.id,
    });
    const n = name();
    expect(
      (
        await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {
          name: n,
          aktiv: false,
        })
      ).status,
    ).toBe(204);
    expect(await zeile(id)).toMatchObject({
      name: n,
      aktiv: false,
      ort: "Keller",
      kapazitaet: 8,
      teamTagId: team.id,
    });
    await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {
      ort: null,
      beschreibung: null,
      kapazitaet: null,
      teamId: null,
    });
    expect(await zeile(id)).toMatchObject({
      ort: null,
      beschreibung: null,
      kapazitaet: null,
      teamTagId: null,
    });
  });

  test("ein leerer Körper ist 204 ohne Schreibzugriff", async () => {
    const id = await neuerRaum();
    const vorher = await db.execute(
      rohsql`select xmin::text as x from raum where id = ${id}`,
    );
    expect((await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {})).status).toBe(
      204,
    );
    const nachher = await db.execute(
      rohsql`select xmin::text as x from raum where id = ${id}`,
    );
    expect(nachher[0]).toEqual(vorher[0]);
  });

  test("ein vergebener Name ist 409, ein fremdes Team 400, ein ungültiger Wert 400", async () => {
    const n = name("Eins");
    await neuerRaum({ name: n });
    const id = await neuerRaum();
    const gleich = await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {
      name: n.toLowerCase(),
    });
    expect(gleich.status).toBe(409);
    expect(gleich.body.code).toBe("RAUM_VORHANDEN");
    const fremd = await neuerTag(welt.demoAbteilungId);
    expect(
      (await anfrage(leitung, "PATCH", `${BASIS}/${id}`, { teamId: fremd.id }))
        .status,
    ).toBe(400);
    expect(
      (await anfrage(leitung, "PATCH", `${BASIS}/${id}`, { kapazitaet: 0 }))
        .status,
    ).toBe(400);
  });

  test("ein Raum behält seinen Namen, wenn die Schreibweise gleich bleibt", async () => {
    const n = name();
    const id = await neuerRaum({ name: n });
    expect(
      (
        await anfrage(leitung, "PATCH", `${BASIS}/${id}`, {
          name: n.toUpperCase(),
        })
      ).status,
    ).toBe(204);
  });

  test("fällt der Tag des Teams weg, bleibt der Raum ohne Team", async () => {
    const team = await neuerTag();
    const id = await neuerRaum({ teamId: team.id });
    await db.delete(schema.tag).where(eq(schema.tag.id, team.id));
    expect((await zeile(id))?.teamTagId).toBeNull();
  });
});

describe("Räume löschen", () => {
  test("löscht endgültig und schreibt einen Audit-Eintrag", async () => {
    const id = await neuerRaum();
    expect((await anfrage(leitung, "DELETE", `${BASIS}/${id}`)).status).toBe(
      204,
    );
    expect(await zeile(id)).toBeUndefined();
    const einträge = await db
      .select({ aktion: schema.auditLog.aktion })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(einträge.map((e) => e.aktion).sort()).toEqual([
      "raum_angelegt",
      "raum_geloescht",
    ]);
    // Zweites Löschen: unbekannt
    expect((await anfrage(leitung, "DELETE", `${BASIS}/${id}`)).status).toBe(
      404,
    );
  });

  test("offene Anfragen sperren das Löschen: 409 ANFRAGEN_OFFEN, der Raum bleibt", async () => {
    const id = await neuerRaum();
    vi.mocked(zaehleOffeneAnfragen).mockResolvedValue(2);
    const r = await anfrage(leitung, "DELETE", `${BASIS}/${id}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ANFRAGEN_OFFEN");
    expect(await zeile(id)).toBeDefined();
  });
});

describe("Rechte", () => {
  test("nur die Abteilungsleitung verwaltet; jede andere Person der Abteilung ist 403", async () => {
    const id = await neuerRaum();
    for (const konto of [ohneFaktor, stufenleitung, eltern]) {
      expect((await anlegen({}, konto)).status).toBe(403);
      expect((await anfrage(konto, "GET", BASIS)).status).toBe(403);
      expect(
        (await anfrage(konto, "PATCH", `${BASIS}/${id}`, { aktiv: false }))
          .status,
      ).toBe(403);
      expect((await anfrage(konto, "DELETE", `${BASIS}/${id}`)).status).toBe(
        403,
      );
    }
    expect((await zeile(id))?.aktiv).toBe(true);
  });

  test("ein Raum einer anderen Abteilung ist 404, auch für deren Abteilungsleitung, und bleibt unberührt", async () => {
    const id = await neuerRaum();
    for (const konto of [fremdeLeitung, fremdeEltern]) {
      expect(
        (await anfrage(konto, "PATCH", `${BASIS}/${id}`, { aktiv: false }))
          .status,
      ).toBe(404);
      expect((await anfrage(konto, "DELETE", `${BASIS}/${id}`)).status).toBe(
        404,
      );
    }
    expect((await zeile(id))?.aktiv).toBe(true);
  });
});

describe("Räume auflisten", () => {
  test("Mitglieder sehen nur aktive Räume der eigenen Abteilung, nach Name geordnet; die Verwaltung sieht alle", async () => {
    const pre = `${VORSATZ}-l`;
    const b = await neuerRaum({ name: `${pre}b` });
    const a = await neuerRaum({ name: `${pre}A` });
    const c = await neuerRaum({ name: `${pre}c`, aktiv: false });
    expect(
      (await anlegen({ name: `${pre}andere` }, fremdeLeitung)).status,
    ).toBe(201);
    const pfad = `?nach=${encodeURIComponent(pre)}&limit=100`;
    const ids = (r: Antwort) =>
      mit(pre, r.body.raeume).map((x) => (x as unknown as { id: string }).id);

    for (const konto of [eltern, stufenleitung, leitung]) {
      const r = await anfrage(konto, "GET", `/api/v1/raeume${pfad}`);
      expect(r.status).toBe(200);
      expect(ids(r)).toEqual([a, b]);
      expect(r.body.raeume.every((x: { aktiv: boolean }) => x.aktiv)).toBe(
        true,
      );
    }
    const alle = await anfrage(leitung, "GET", `${BASIS}${pfad}`);
    expect(ids(alle)).toEqual([a, b, c]);
    // Die fremde Abteilung sieht nur ihren eigenen Raum, nie die der Testabteilung
    const drueben = await anfrage(fremdeEltern, "GET", `/api/v1/raeume${pfad}`);
    expect(mit(pre, drueben.body.raeume).map((x) => x.name)).toEqual([
      `${pre}andere`,
    ]);
  });

  test("Seitenwechsel: limit und naechste führen lückenlos und ohne Doppelte durch die Liste", async () => {
    const vorsatz = `${VORSATZ}-p`;
    const namen = ["Ae", "ba", "Bb", "cc", "Dd"].map((s) => `${vorsatz}${s}`);
    for (const n of namen) await neuerRaum({ name: n });
    const gesehen: string[] = [];
    let nach: string | null = vorsatz;
    let seiten = 0;
    // Die Seiten laufen über die Räume anderer Tests der Datei hinaus: Wir zählen nur die eigenen, bis alle da sind
    while (nach !== null && seiten < 20 && gesehen.length < namen.length) {
      const r: Antwort = await anfrage(
        eltern,
        "GET",
        `/api/v1/raeume?limit=2&nach=${encodeURIComponent(nach)}`,
      );
      expect(r.status).toBe(200);
      expect(r.body.raeume.length).toBeLessThanOrEqual(2);
      gesehen.push(
        ...r.body.raeume
          .map((x: { name: string }) => x.name)
          .filter((n: string) => n.startsWith(vorsatz)),
      );
      expect(r.body.weitere).toBe(r.body.naechste !== null);
      nach = r.body.naechste;
      seiten++;
    }
    // Nach Namen ohne Gross-/Kleinschreibung: Ae, ba, Bb, cc, Dd
    expect(gesehen).toEqual(namen);
    expect(seiten).toBeGreaterThanOrEqual(3);
  });

  test("ungültige Abfrage: 400", async () => {
    for (const q of ["limit=0", "limit=101", "limit=x", "nach=", "farbe=rot"]) {
      expect((await anfrage(eltern, "GET", `/api/v1/raeume?${q}`)).status).toBe(
        400,
      );
    }
  });

  test("ohne Sitzung 401", async () => {
    expect((await app.request("/api/v1/raeume")).status).toBe(401);
  });
});

describe("Abfragen je Aufruf", () => {
  test("Liste: eine Abfrage auf raum, nie je Zeile; Anlegen, Ändern und Löschen höchstens drei", async () => {
    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    const team = await neuerTag();
    for (let i = 0; i < 5; i++) await neuerRaum({ teamId: team.id });
    const betrifft = (q: string) => /"raum"|"tag"/.test(q);
    const zaehle = async (
      konto: PersonaKonto,
      m: string,
      p: string,
      b?: Record<string, unknown>,
    ) => {
      abfragen.length = 0;
      const r = await anfrage(konto, m, p, b, zaehlApp);
      expect(r.status).toBeLessThan(300);
      return { r, n: abfragen.filter(betrifft).length };
    };
    expect((await zaehle(eltern, "GET", "/api/v1/raeume?limit=100")).n).toBe(1);
    // Die Liste der Verwaltung: die Teams der Räume, der RechteSatz und die Seite (nie je Zeile)
    expect(
      (await zaehle(leitung, "GET", `${BASIS}?limit=100`)).n,
    ).toBeLessThanOrEqual(3);
    const neu = await zaehle(leitung, "POST", BASIS, {
      name: name(),
      teamId: team.id,
    });
    expect(neu.n).toBeLessThanOrEqual(3);
    const id = neu.r.body.id;
    expect(
      (await zaehle(leitung, "PATCH", `${BASIS}/${id}`, { aktiv: false })).n,
    ).toBeLessThanOrEqual(3);
    expect(
      (await zaehle(leitung, "DELETE", `${BASIS}/${id}`)).n,
    ).toBeLessThanOrEqual(4);
  });
});
