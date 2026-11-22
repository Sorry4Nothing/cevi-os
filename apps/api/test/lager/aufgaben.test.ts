import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TokenMessage } from "firebase-admin/messaging";
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
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import type { Fcm } from "../../src/push.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Jede Abfrage an die Datenbank zählt mit: Die Tests der Datenbanklast vergleichen die Zahl für kleine und grosse Listen
let abfragen = 0;
const sql = postgres(API_URL, {
  debug: () => {
    abfragen++;
  },
});
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

// Eine Attrappe statt firebase-admin: Kein Netz, keine Schlüssel
let gesendet: TokenMessage[] = [];
const fcm: Fcm = {
  async sendEach(nachrichten) {
    gesendet.push(...nachrichten);
    return { responses: nachrichten.map(() => ({ success: true })) };
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  fcm,
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let andereLagerId: string;
let fremdLagerId: string;

beforeEach(() => {
  gesendet = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;

async function neuesLager(
  abteilungId = welt.testabteilungId,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Aufgabenlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  if (abteilungId !== welt.testabteilungId) return id;
  // Die falsche Zeile der fremden Abteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of MITGLIEDER) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: konten[persona].id!, rolle });
  }
  return id;
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await neuesLager();
  geschlossenId = await neuesLager(welt.testabteilungId, "abgeschlossen");
  andereLagerId = await neuesLager();
  fremdLagerId = await neuesLager(welt.demoAbteilungId);
});

// Die Bodys prüfen die Tests Feld für Feld; ein Typ je Route brächte hier nichts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
const team = () => konten.team;
type AufgabeAntwort = {
  id: string;
  version: number;
  titel: string;
  status: string;
  frist: string | null;
  stern: boolean;
  reihenfolge: number;
  erledigtAm: string | null;
  verantwortlichPersonId: string | null;
  verantwortlich: { id: string; name: string; automatisch: boolean } | null;
  ressort: { id: string; kuerzel: string } | null;
  unterstuetzung: { id: string; name: string }[];
};
async function neu(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/aufgaben`, {
    titel: "Aufgabe",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as AufgabeAntwort;
}
async function mitglied(
  lager = lagerId,
  abteilungId = welt.testabteilungId,
  rolle: "team" | "leitung" = "team",
) {
  const [p] = await db
    .insert(schema.user)
    .values({
      name: "Mitglied Test",
      email: `${randomUUID()}@example.org`,
      username: `m.${randomUUID().slice(0, 8)}`,
      abteilungId,
      mussPasswortAendern: false,
    })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId: lager, personId: p!.id, rolle });
  return p!.id;
}
async function ressort(leitungPersonId?: string, lager = lagerId) {
  const [r] = await db
    .insert(schema.ressort)
    .values({
      lagerId: lager,
      kuerzel: `R${randomUUID().slice(0, 8)}`,
      name: "Küche",
      leitungPersonId,
      lagerSeq: 0,
    })
    .returning({ id: schema.ressort.id });
  return r!.id;
}
const tag = (verschiebung: number) =>
  new Date(Date.now() + verschiebung * 86_400_000).toISOString().slice(0, 10);

describe("Rechte je Lager-Persona", () => {
  // Standard: Lagerleitung, Abteilungsleitung und Leitung lesen und bearbeiten alle Aufgaben, Lesen liest alle, Team hat nur aufgaben.eigene
  const liste: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 200,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const schreiben: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 201,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };

  test.each(LAGER_PERSONAS)("%s: Liste lesen", async (p) => {
    const a = await anfrage(konten[p], "GET", `${L()}/aufgaben`);
    expect(a.status).toBe(liste[p]);
  });

  test.each(LAGER_PERSONAS)("%s: anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${L()}/aufgaben`, {
      titel: "X",
    });
    expect(a.status).toBe(schreiben[p]);
  });

  test.each(LAGER_PERSONAS)(
    "%s: ändern, löschen und Reihenfolge",
    async (p) => {
      const [t1, t2, t3] = [await neu(), await neu(), await neu()];
      const patch = await anfrage(
        konten[p],
        "PATCH",
        `${L()}/aufgaben/${t1.id}`,
        { version: 1, titel: "Neu" },
      );
      const reihenfolge = await anfrage(
        konten[p],
        "PUT",
        `${L()}/aufgaben/reihenfolge`,
        { eintraege: [{ id: t2.id, version: 1 }] },
      );
      const loeschen = await anfrage(
        konten[p],
        "DELETE",
        `${L()}/aufgaben/${t3.id}?version=1`,
      );
      const erfolg = schreiben[p] === 201;
      expect([patch.status, reihenfolge.status, loeschen.status]).toEqual(
        erfolg ? [200, 204, 204] : [schreiben[p], schreiben[p], schreiben[p]],
      );
    },
  );

  test("abgeschlossenes Lager: schreiben 409, lesen 200", async () => {
    const [zeile] = await db
      .insert(schema.aufgabe)
      .values({ lagerId: geschlossenId, titel: "Alt", lagerSeq: 0 })
      .returning({ id: schema.aufgabe.id });
    const pfad = `${L(geschlossenId)}/aufgaben`;
    for (const [methode, url, body] of [
      ["POST", pfad, { titel: "X" }],
      ["PATCH", `${pfad}/${zeile!.id}`, { version: 1, titel: "X" }],
      ["PUT", `${pfad}/${zeile!.id}/status`, { version: 1, status: "laeuft" }],
      ["DELETE", `${pfad}/${zeile!.id}?version=1`, undefined],
    ] as const) {
      const a = await anfrage(leiter(), methode, url, body);
      expect(a.status, `${methode} ${url}`).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
    // Auch das Team mit dem Recht «eigene» darf im geschlossenen Lager keinen Status setzen
    const teamStatus = await anfrage(
      team(),
      "PUT",
      `${pfad}/${zeile!.id}/status`,
      { version: 1, status: "laeuft" },
    );
    expect(teamStatus.status).toBe(409);
    const get = await anfrage(konten.lesen, "GET", `${pfad}/${zeile!.id}`);
    expect(get.status).toBe(200);
  });

  test("Lager der fremden Abteilung: 404, auch für die Lagerleitung des anderen Lagers", async () => {
    const [fremd] = await db
      .insert(schema.aufgabe)
      .values({ lagerId: fremdLagerId, titel: "Fremd", lagerSeq: 0 })
      .returning({ id: schema.aufgabe.id });
    for (const [konto, methode, url] of [
      [leiter(), "GET", `${L(fremdLagerId)}/aufgaben`],
      [konten.abteilungsleitung, "GET", `${L(fremdLagerId)}/aufgaben`],
      [
        konten.abteilungsleitung,
        "GET",
        `${L(fremdLagerId)}/aufgaben/${fremd!.id}`,
      ],
      [
        konten.abteilungsleitung,
        "DELETE",
        `${L(fremdLagerId)}/aufgaben/${fremd!.id}?version=1`,
      ],
    ] as const) {
      expect((await anfrage(konto, methode, url)).status).toBe(404);
    }
  });

  test("eine Aufgabe eines anderen Lagers ist über dieses Lager nie erreichbar (SR-11)", async () => {
    const andere = await neu({}, andereLagerId);
    const pfad = `${L()}/aufgaben/${andere.id}`;
    expect((await anfrage(leiter(), "GET", pfad)).status).toBe(404);
    expect(
      (await anfrage(leiter(), "PATCH", pfad, { version: 1, titel: "X" }))
        .status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PUT", `${pfad}/status`, {
          version: 1,
          status: "laeuft",
        })
      ).status,
    ).toBe(404);
    expect(
      (await anfrage(leiter(), "DELETE", `${pfad}?version=1`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PUT", `${L()}/aufgaben/reihenfolge`, {
          eintraege: [{ id: andere.id, version: 1 }],
        })
      ).status,
    ).toBe(404);
    // Unverändert
    const heil = await anfrage(
      leiter(),
      "GET",
      `${L(andereLagerId)}/aufgaben/${andere.id}`,
    );
    expect(heil.body).toMatchObject({ titel: "Aufgabe", version: 1 });
  });
});

describe("Anlegen und lesen", () => {
  test("legt mit Vorgaben an und hängt ans Ende", async () => {
    const a = await neu();
    const b = await neu();
    expect(a).toMatchObject({
      version: 1,
      status: "offen",
      stern: false,
      frist: null,
      erledigtAm: null,
      verantwortlich: null,
      unterstuetzung: [],
      ressort: null,
    });
    expect(b.reihenfolge).toBe(a.reihenfolge + 1);
  });

  test("Verantwortliche und Unterstützung als Personen-IDs, Namen werden beim Lesen aufgelöst", async () => {
    const v = await mitglied();
    const u1 = await mitglied();
    const u2 = await mitglied();
    const a = await neu({
      verantwortlichPersonId: v,
      unterstuetzungPersonIds: [u1, u2],
      frist: tag(5),
      notiz: "Mit Plane",
      teil: "Zelte",
      stern: true,
      laufend: true,
      wiederholung: "w1",
    });
    expect(a).toMatchObject({
      verantwortlichPersonId: v,
      verantwortlich: { id: v, name: "Mitglied Test", automatisch: false },
      frist: tag(5),
      stern: true,
      laufend: true,
      wiederholung: "w1",
      teil: "Zelte",
    });
    expect(a.unterstuetzung.map((p) => p.id).sort()).toEqual([u1, u2].sort());
    // Umbenennen bricht nichts
    await db
      .update(schema.user)
      .set({ name: "Neuer Name" })
      .where(eq(schema.user.id, v));
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.body.verantwortlichPersonId).toBe(v);
    expect(get.body.verantwortlich.name).toBe("Neuer Name");
  });

  test("ohne Person gilt die Leitung des Ressorts als Verantwortliche, serverseitig und nicht gespeichert", async () => {
    const leitung = await mitglied();
    const neueLeitung = await mitglied();
    const r = await ressort(leitung);
    const a = await neu({ ressortId: r });
    expect(a.verantwortlichPersonId).toBeNull();
    expect(a.verantwortlich).toMatchObject({ id: leitung, automatisch: true });
    expect(a.ressort).toMatchObject({ id: r });
    const [roh] = await db
      .select()
      .from(schema.aufgabe)
      .where(eq(schema.aufgabe.id, a.id));
    expect(roh!.verantwortlichPersonId).toBeNull();
    // Wechselt die Leitung, wechselt die Aufgabe mit
    await db
      .update(schema.ressort)
      .set({ leitungPersonId: neueLeitung })
      .where(eq(schema.ressort.id, r));
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.body.verantwortlich).toMatchObject({
      id: neueLeitung,
      automatisch: true,
    });
    // Eine gesetzte Person geht vor
    const eigene = await mitglied();
    const b = await neu({ ressortId: r, verantwortlichPersonId: eigene });
    expect(b.verantwortlich).toMatchObject({ id: eigene, automatisch: false });
  });

  test("erledigt beim Anlegen setzt den Zeitpunkt", async () => {
    const a = await neu({ status: "erledigt" });
    expect(a.status).toBe("erledigt");
    expect(a.erledigtAm).not.toBeNull();
  });

  test("Eingaben sind strikt: unbekannte Felder und ungültige Werte 400", async () => {
    const schlecht: Record<string, unknown>[] = [
      { titel: "" },
      { titel: "x".repeat(201) },
      { titel: "A", lagerId: randomUUID() },
      { titel: "A", erledigtAm: new Date().toISOString() },
      { titel: "A", quelle: "x" },
      { titel: "A", fristErinnertAm: new Date().toISOString() },
      { titel: "A", version: 5 },
      { titel: "A", status: "fertig" },
      { titel: "A", frist: "morgen" },
      { titel: "A", frist: "2027-02-30" },
      { titel: "A", wiederholung: "d1" },
      { titel: "A", reihenfolge: -1 },
      { titel: "A", notiz: "x".repeat(5001) },
      { titel: "A", unterstuetzungPersonIds: ["kein-uuid"] },
      { titel: "A", unterstuetzungPersonIds: [randomUUID(), "nein"] },
    ];
    for (const werte of schlecht) {
      const a = await anfrage(leiter(), "POST", `${L()}/aufgaben`, werte);
      expect(a.status, JSON.stringify(werte)).toBe(400);
    }
    const doppelt = await mitglied();
    const a = await anfrage(leiter(), "POST", `${L()}/aufgaben`, {
      titel: "A",
      unterstuetzungPersonIds: [doppelt, doppelt],
    });
    expect(a.status).toBe(400);
  });

  test("Verantwortliche und Unterstützung müssen Mitglieder dieses Lagers sein, das Ressort muss dazugehören", async () => {
    const nichtMitglied = konten.ohneMitgliedschaft.id!;
    const fremd = await mitglied(fremdLagerId, welt.demoAbteilungId);
    const anderes = await mitglied(andereLagerId);
    for (const person of [nichtMitglied, fremd, anderes, randomUUID()]) {
      const v = await anfrage(leiter(), "POST", `${L()}/aufgaben`, {
        titel: "X",
        verantwortlichPersonId: person,
      });
      const u = await anfrage(leiter(), "POST", `${L()}/aufgaben`, {
        titel: "X",
        unterstuetzungPersonIds: [person],
      });
      expect([v.status, v.body.code, u.status, u.body.code]).toEqual([
        400,
        "KEIN_MITGLIED",
        400,
        "KEIN_MITGLIED",
      ]);
    }
    for (const r of [
      await ressort(undefined, andereLagerId),
      await ressort(undefined, fremdLagerId),
      randomUUID(),
    ]) {
      const a = await anfrage(leiter(), "POST", `${L()}/aufgaben`, {
        titel: "X",
        ressortId: r,
      });
      expect([a.status, a.body.code]).toEqual([400, "RESSORT_UNBEKANNT"]);
    }
  });
});

describe("Ändern, Status und Versionskonflikt", () => {
  test("ändert Felder, zählt die Version und nimmt null als Leeren", async () => {
    const v = await mitglied();
    const a = await neu({
      verantwortlichPersonId: v,
      frist: tag(3),
      teil: "X",
    });
    const b = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: a.version,
      titel: "Zelte prüfen",
      frist: null,
      teil: null,
      verantwortlichPersonId: null,
      stern: true,
      notiz: "Wichtig",
    });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({
      version: 2,
      titel: "Zelte prüfen",
      frist: null,
      teil: null,
      verantwortlichPersonId: null,
      stern: true,
      notiz: "Wichtig",
    });
  });

  test("leere Änderung und unbekannte Felder 400", async () => {
    const a = await neu();
    for (const body of [
      { version: 1 },
      { version: 1, titel: "X", erledigtAm: new Date().toISOString() },
      { version: 1, lagerId: randomUUID() },
      { titel: "ohne Version" },
    ]) {
      const r = await anfrage(
        leiter(),
        "PATCH",
        `${L()}/aufgaben/${a.id}`,
        body,
      );
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  test("Status wechselt: erledigt setzt den Zeitpunkt, ein anderer Status leert ihn, derselbe Status lässt ihn stehen", async () => {
    const a = await neu();
    const e = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      status: "erledigt",
    });
    expect(e.body.status).toBe("erledigt");
    const zeit = e.body.erledigtAm as string;
    expect(zeit).not.toBeNull();
    const gleich = await anfrage(
      leiter(),
      "PUT",
      `${L()}/aufgaben/${a.id}/status`,
      { version: 2, status: "erledigt" },
    );
    expect(gleich.body.erledigtAm).toBe(zeit);
    const offen = await anfrage(
      leiter(),
      "PUT",
      `${L()}/aufgaben/${a.id}/status`,
      { version: 3, status: "naechster_hoeck" },
    );
    expect(offen.body).toMatchObject({
      status: "naechster_hoeck",
      erledigtAm: null,
      version: 4,
    });
  });

  test("alle fünf Status sind möglich, ein anderer 400", async () => {
    const a = await neu();
    let version = 1;
    for (const status of [
      "laeuft",
      "wartet",
      "erledigt",
      "naechster_hoeck",
      "offen",
    ]) {
      const r = await anfrage(
        leiter(),
        "PUT",
        `${L()}/aufgaben/${a.id}/status`,
        { version, status },
      );
      expect(r.status).toBe(200);
      version = r.body.version;
    }
    const schlecht = await anfrage(
      leiter(),
      "PUT",
      `${L()}/aufgaben/${a.id}/status`,
      { version, status: "fertig" },
    );
    expect(schlecht.status).toBe(400);
  });

  test("veraltete Version: 409 mit aktuellem Stand und den abweichenden Feldern", async () => {
    const a = await neu({ titel: "Eins" });
    await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      titel: "Zwei",
      stern: true,
    });
    const k = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      titel: "Drei",
      stern: true,
      notiz: null,
    });
    expect(k.status).toBe(409);
    expect(k.body.code).toBe("VERSION_KONFLIKT");
    expect(k.body.aktuell).toMatchObject({
      id: a.id,
      version: 2,
      titel: "Zwei",
      stern: true,
    });
    // Nur Felder, die jetzt anders stehen als gewollt: der Titel; Stern und Notiz stimmen schon
    expect(k.body.abweichend).toEqual(["titel"]);
    // Nichts wurde geändert
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.body.titel).toBe("Zwei");
    // Auch beim Status und beim Löschen
    const s = await anfrage(leiter(), "PUT", `${L()}/aufgaben/${a.id}/status`, {
      version: 1,
      status: "laeuft",
    });
    expect(s.status).toBe(409);
    expect(s.body.aktuell.status).toBe("offen");
    const d = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/aufgaben/${a.id}?version=1`,
    );
    expect(d.status).toBe(409);
  });

  test("gleichzeitige Änderungen mit derselben Version: genau eine gewinnt", async () => {
    const a = await neu();
    const antworten = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
          version: 1,
          titel: `Titel ${i}`,
        }),
      ),
    );
    expect(antworten.filter((r) => r.status === 200)).toHaveLength(1);
    expect(antworten.filter((r) => r.status === 409)).toHaveLength(5);
  });

  test("Unterstützung ersetzen zählt die Version und lässt sich leeren", async () => {
    const u1 = await mitglied();
    const u2 = await mitglied();
    const a = await neu({ unterstuetzungPersonIds: [u1] });
    const b = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      unterstuetzungPersonIds: [u2],
    });
    expect(b.status).toBe(200);
    expect(b.body.version).toBe(2);
    expect(b.body.unterstuetzung.map((p: { id: string }) => p.id)).toEqual([
      u2,
    ]);
    const c = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 2,
      unterstuetzungPersonIds: [],
    });
    expect(c.body.unterstuetzung).toEqual([]);
  });

  test("ein Konflikt lässt auch die Unterstützung unberührt", async () => {
    const u1 = await mitglied();
    const u2 = await mitglied();
    const a = await neu({ unterstuetzungPersonIds: [u1] });
    await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      stern: true,
    });
    const k = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      unterstuetzungPersonIds: [u2],
    });
    expect(k.status).toBe(409);
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.body.unterstuetzung.map((p: { id: string }) => p.id)).toEqual([
      u1,
    ]);
  });
});

describe("Team: nur Eigenes", () => {
  test("liest nur Aufgaben, bei denen es Verantwortliche ist, unterstützt oder als Ressortleitung gilt", async () => {
    const andere = await mitglied();
    const eigene = await neu({ verantwortlichPersonId: team().id });
    const unterstuetzt = await neu({
      verantwortlichPersonId: andere,
      unterstuetzungPersonIds: [team().id],
    });
    const ueberRessort = await neu({ ressortId: await ressort(team().id!) });
    const fremd = await neu({ verantwortlichPersonId: andere });
    const ohne = await neu();
    const hatRessortAberPerson = await neu({
      ressortId: await ressort(team().id!),
      verantwortlichPersonId: andere,
    });

    const liste = await anfrage(team(), "GET", `${L()}/aufgaben?limit=200`);
    expect(liste.status).toBe(200);
    const ids = liste.body.aufgaben.map((a: { id: string }) => a.id);
    for (const sichtbar of [eigene, unterstuetzt, ueberRessort]) {
      expect(ids).toContain(sichtbar.id);
    }
    for (const unsichtbar of [fremd, ohne, hatRessortAberPerson]) {
      expect(ids).not.toContain(unsichtbar.id);
    }

    for (const t of [eigene, unterstuetzt, ueberRessort]) {
      expect(
        (await anfrage(team(), "GET", `${L()}/aufgaben/${t.id}`)).status,
      ).toBe(200);
    }
    // Eine fremde Aufgabe ist unbekannt: dieselbe 404 wie eine, die es nicht gibt
    const fremdGet = await anfrage(
      team(),
      "GET",
      `${L()}/aufgaben/${fremd.id}`,
    );
    const nichtDa = await anfrage(
      team(),
      "GET",
      `${L()}/aufgaben/${randomUUID()}`,
    );
    expect([fremdGet.status, fremdGet.body]).toEqual([
      nichtDa.status,
      nichtDa.body,
    ]);
    expect(fremdGet.status).toBe(404);
  });

  test("auch die Filter der Liste geben dem Team nichts Fremdes", async () => {
    const andere = await mitglied();
    const fremd = await neu({ verantwortlichPersonId: andere, stern: true });
    for (const abfrage of [
      `personId=${andere}`,
      "stern=true",
      "status=offen",
      "ueberfaellig=false",
    ]) {
      const r = await anfrage(
        team(),
        "GET",
        `${L()}/aufgaben?${abfrage}&limit=200`,
      );
      expect(r.status).toBe(200);
      expect(
        r.body.aufgaben.map((a: { id: string }) => a.id),
        abfrage,
      ).not.toContain(fremd.id);
    }
  });

  test("setzt den Status der eigenen Aufgabe, und nur diesen", async () => {
    const a = await neu({ verantwortlichPersonId: team().id });
    const s = await anfrage(team(), "PUT", `${L()}/aufgaben/${a.id}/status`, {
      version: 1,
      status: "erledigt",
    });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: "erledigt", version: 2 });
    expect(s.body.erledigtAm).not.toBeNull();
    // Andere Felder über diese Route 400, über PATCH und DELETE 403
    const mehr = await anfrage(
      team(),
      "PUT",
      `${L()}/aufgaben/${a.id}/status`,
      { version: 2, status: "offen", titel: "Umgetauft" },
    );
    expect(mehr.status).toBe(400);
    const patch = await anfrage(team(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 2,
      titel: "Umgetauft",
    });
    const del = await anfrage(
      team(),
      "DELETE",
      `${L()}/aufgaben/${a.id}?version=2`,
    );
    expect([patch.status, del.status]).toEqual([403, 403]);
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.body).toMatchObject({ titel: "Aufgabe", status: "erledigt" });
  });

  test("setzt den Status auch, wenn es die Aufgabe nur unterstützt", async () => {
    const a = await neu({
      verantwortlichPersonId: await mitglied(),
      unterstuetzungPersonIds: [team().id],
    });
    const s = await anfrage(team(), "PUT", `${L()}/aufgaben/${a.id}/status`, {
      version: 1,
      status: "laeuft",
    });
    expect(s.status).toBe(200);
  });

  test("der Status einer fremden Aufgabe: 404, die Aufgabe bleibt unverändert", async () => {
    const a = await neu({ verantwortlichPersonId: await mitglied() });
    const s = await anfrage(team(), "PUT", `${L()}/aufgaben/${a.id}/status`, {
      version: 1,
      status: "erledigt",
    });
    expect(s.status).toBe(404);
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.body).toMatchObject({ status: "offen", version: 1 });
  });

  test("Lesen sieht alle Aufgaben, setzt aber keinen Status", async () => {
    const a = await neu({ verantwortlichPersonId: konten.lesen.id });
    const get = await anfrage(konten.lesen, "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.status).toBe(200);
    const s = await anfrage(
      konten.lesen,
      "PUT",
      `${L()}/aufgaben/${a.id}/status`,
      { version: 1, status: "erledigt" },
    );
    expect(s.status).toBe(403);
  });

  test("eingestellte Rechte wirken bei der nächsten Anfrage", async () => {
    const id = await neuesLager();
    const eigene = await anfrage(leiter(), "POST", `${L(id)}/aufgaben`, {
      titel: "Eigene",
      verantwortlichPersonId: team().id,
    });
    const fremde = await anfrage(leiter(), "POST", `${L(id)}/aufgaben`, {
      titel: "Fremde",
    });
    const liste = async () =>
      (await anfrage(team(), "GET", `${L(id)}/aufgaben`)).body.aufgaben.map(
        (a: { id: string }) => a.id,
      );
    expect(await liste()).toEqual([eigene.body.id]);
    // Das Team darf alle lesen
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "team",
      recht: "aufgaben.lesen_alle",
      erlaubt: true,
    });
    expect((await liste()).sort()).toEqual(
      [eigene.body.id, fremde.body.id].sort(),
    );
    // ... aber nicht mehr eigene Aufgaben (und ohne lesen_alle gar nichts): 403
    await db
      .update(schema.lagerRolleRecht)
      .set({ erlaubt: false })
      .where(
        and(
          eq(schema.lagerRolleRecht.lagerId, id),
          eq(schema.lagerRolleRecht.rolle, "team"),
        ),
      );
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "team",
      recht: "aufgaben.eigene",
      erlaubt: false,
    });
    expect((await anfrage(team(), "GET", `${L(id)}/aufgaben`)).status).toBe(
      403,
    );
    // Die Lagerleitung lässt sich nicht aussperren
    expect((await anfrage(leiter(), "GET", `${L(id)}/aufgaben`)).status).toBe(
      200,
    );
  });
});

describe("Liste, Filter und Seitenwechsel", () => {
  let lid: string;
  let r1: string;
  let r2: string;
  let p1: string;
  let p2: string;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    lid = await neuesLager();
    p1 = await mitglied(lid);
    p2 = await mitglied(lid);
    [r1, r2] = [await ressort(undefined, lid), await ressort(p2, lid)];
    const a = async (name: string, werte: Record<string, unknown>) => {
      ids[name] = (await neu({ titel: name, ...werte }, lid)).id;
    };
    await a("a", {
      ressortId: r1,
      verantwortlichPersonId: p1,
      frist: tag(-3),
      stern: true,
    });
    await a("b", { ressortId: r1, frist: tag(4), status: "laeuft" });
    await a("c", {
      ressortId: r2,
      unterstuetzungPersonIds: [p1],
      frist: tag(-2),
      status: "erledigt",
    });
    await a("d", { ressortId: r2, status: "wartet" });
    await a("e", { verantwortlichPersonId: p2, frist: tag(10) });
    await a("f", { frist: tag(-1), status: "naechster_hoeck" });
  });
  const titel = async (abfrage: string) =>
    (
      (await anfrage(leiter(), "GET", `${L(lid)}/aufgaben?${abfrage}`)).body
        .aufgaben as { titel: string }[]
    )
      .map((t) => t.titel)
      .sort();

  test("ohne Filter alle in der Reihenfolge der Anlage", async () => {
    const r = await anfrage(leiter(), "GET", `${L(lid)}/aufgaben`);
    expect(r.body.aufgaben.map((t: { titel: string }) => t.titel)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(r.body.naechster).toBeNull();
  });

  test("nach Ressort, Status, Stern", async () => {
    expect(await titel(`ressortId=${r1}`)).toEqual(["a", "b"]);
    expect(await titel("status=erledigt")).toEqual(["c"]);
    expect(await titel("status=offen")).toEqual(["a", "e"]);
    expect(await titel("stern=true")).toEqual(["a"]);
    expect(await titel("stern=false")).toEqual(["b", "c", "d", "e", "f"]);
  });

  test("nach Person: Verantwortliche, Unterstützung und die Leitung des Ressorts", async () => {
    // p1: verantwortlich für a, unterstützt c. p2: verantwortlich für e und über die Leitung von r2 für d (c hat Unterstützung, aber auch r2: ohne gesetzte Person gilt die Ressortleitung)
    expect(await titel(`personId=${p1}`)).toEqual(["a", "c"]);
    expect(await titel(`personId=${p2}`)).toEqual(["c", "d", "e"]);
  });

  test("überfällig: Frist vorbei und nicht erledigt", async () => {
    expect(await titel("ueberfaellig=true")).toEqual(["a", "f"]);
    expect(await titel("ueberfaellig=false")).toEqual(["b", "c", "d", "e"]);
  });

  test("Fristbereich und Kombination", async () => {
    expect(await titel(`fristVon=${tag(0)}&fristBis=${tag(5)}`)).toEqual(["b"]);
    expect(await titel(`fristBis=${tag(-2)}`)).toEqual(["a", "c"]);
    expect(await titel(`ressortId=${r2}&status=wartet`)).toEqual(["d"]);
    expect(await titel(`ressortId=${r1}&ueberfaellig=true&stern=true`)).toEqual(
      ["a"],
    );
  });

  test("ungültige Filter 400", async () => {
    for (const q of [
      "status=fertig",
      "ressortId=x",
      "personId=x",
      "stern=ja",
      "fristVon=morgen",
      "limit=0",
      "limit=201",
      "unbekannt=1",
    ]) {
      expect(
        (await anfrage(leiter(), "GET", `${L(lid)}/aufgaben?${q}`)).status,
        q,
      ).toBe(400);
    }
  });

  test("Seitenwechsel mit Cursor, ohne Lücke und ohne Doppelte, auch mit Filter", async () => {
    const alle: string[] = [];
    let nach: string | null = null;
    let seiten = 0;
    do {
      const r: Antwort = await anfrage(
        leiter(),
        "GET",
        `${L(lid)}/aufgaben?limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      expect(r.status).toBe(200);
      alle.push(...r.body.aufgaben.map((t: { titel: string }) => t.titel));
      nach = r.body.naechster;
      seiten++;
    } while (nach);
    expect(alle).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(seiten).toBe(3);
    const gefiltert = await anfrage(
      leiter(),
      "GET",
      `${L(lid)}/aufgaben?limit=1&ueberfaellig=false`,
    );
    expect(gefiltert.body.aufgaben).toHaveLength(1);
    expect(gefiltert.body.naechster).toBe(gefiltert.body.aufgaben[0].id);
    // Ein unbekannter Cursor: leere Seite
    const leer = await anfrage(
      leiter(),
      "GET",
      `${L(lid)}/aufgaben?nach=${randomUUID()}`,
    );
    expect(leer.body).toEqual({ aufgaben: [], naechster: null });
    // Der Cursor eines anderen Lagers gibt nichts preis
    const fremd = await anfrage(
      leiter(),
      "GET",
      `${L(lid)}/aufgaben?nach=${ids.a}`,
    );
    expect(fremd.body.aufgaben.length).toBe(5);
    const anderswo = await neu({}, andereLagerId);
    const ausLager = await anfrage(
      leiter(),
      "GET",
      `${L(lid)}/aufgaben?nach=${anderswo.id}`,
    );
    expect(ausLager.body.aufgaben).toEqual([]);
  });

  test("Datenbanklast: die Zahl der Abfragen hängt nicht von der Zahl der Aufgaben ab", async () => {
    const id = await neuesLager();
    const personen = [await mitglied(id), await mitglied(id)];
    const messe = async () => {
      const vorher = abfragen;
      const r = await anfrage(leiter(), "GET", `${L(id)}/aufgaben?limit=200`);
      expect(r.status).toBe(200);
      return { n: abfragen - vorher, zeilen: r.body.aufgaben.length };
    };
    const r = await ressort(personen[0], id);
    await neu({ ressortId: r, unterstuetzungPersonIds: personen }, id);
    const wenige = await messe();
    for (let i = 0; i < 40; i++) {
      await neu(
        {
          ressortId: r,
          verantwortlichPersonId: personen[i % 2],
          unterstuetzungPersonIds: personen,
        },
        id,
      );
    }
    const viele = await messe();
    expect(wenige.zeilen).toBe(1);
    expect(viele.zeilen).toBe(41);
    expect(viele.n).toBe(wenige.n);
    // Anmeldung, Policy (Lager mit Mitgliedschaft, Rechte der Rolle), Liste und Unterstützung; nie eine Abfrage je Aufgabe
    expect(viele.n).toBeLessThanOrEqual(8);
  });
});

describe("Reihenfolge", () => {
  test("setzt die Reihenfolge in der Liste, was schon stimmt, bleibt unberührt", async () => {
    const id = await neuesLager();
    const [a, b, c] = [
      await neu({ titel: "a" }, id),
      await neu({ titel: "b" }, id),
      await neu({ titel: "c" }, id),
    ];
    const r = await anfrage(leiter(), "PUT", `${L(id)}/aufgaben/reihenfolge`, {
      eintraege: [
        { id: c.id, version: 1 },
        { id: a.id, version: 1 },
        { id: b.id, version: 1 },
      ],
    });
    expect(r.status).toBe(204);
    const liste = await anfrage(leiter(), "GET", `${L(id)}/aufgaben`);
    expect(liste.body.aufgaben.map((t: { titel: string }) => t.titel)).toEqual([
      "c",
      "a",
      "b",
    ]);
    // c stand schon an der ersten Stelle seiner Liste nicht, a und b auch nicht; c ist neu an Stelle 0 (war 2), a an 1 (war 0), b an 2 (war 1)
    expect(
      liste.body.aufgaben.map((t: { version: number }) => t.version),
    ).toEqual([2, 2, 2]);
    // Dieselbe Reihenfolge noch einmal ändert nichts mehr
    const nochmal = await anfrage(
      leiter(),
      "PUT",
      `${L(id)}/aufgaben/reihenfolge`,
      {
        eintraege: [
          { id: c.id, version: 2 },
          { id: a.id, version: 2 },
          { id: b.id, version: 2 },
        ],
      },
    );
    expect(nochmal.status).toBe(204);
    const danach = await anfrage(leiter(), "GET", `${L(id)}/aufgaben`);
    expect(
      danach.body.aufgaben.map((t: { version: number }) => t.version),
    ).toEqual([2, 2, 2]);
  });

  test("eine unbekannte Aufgabe oder eine doppelte ID macht die ganze Änderung rückgängig", async () => {
    const id = await neuesLager();
    const [a, b] = [await neu({}, id), await neu({}, id)];
    const unbekannt = await anfrage(
      leiter(),
      "PUT",
      `${L(id)}/aufgaben/reihenfolge`,
      {
        eintraege: [
          { id: b.id, version: 1 },
          { id: randomUUID(), version: 1 },
        ],
      },
    );
    expect(unbekannt.status).toBe(404);
    const doppelt = await anfrage(
      leiter(),
      "PUT",
      `${L(id)}/aufgaben/reihenfolge`,
      {
        eintraege: [
          { id: a.id, version: 1 },
          { id: a.id, version: 1 },
        ],
      },
    );
    expect(doppelt.status).toBe(400);
    // Versionskonflikt mitten in der Liste: nichts ändert sich
    const konflikt = await anfrage(
      leiter(),
      "PUT",
      `${L(id)}/aufgaben/reihenfolge`,
      {
        eintraege: [
          { id: b.id, version: 1 },
          { id: a.id, version: 7 },
        ],
      },
    );
    expect(konflikt.status).toBe(409);
    const liste = await anfrage(leiter(), "GET", `${L(id)}/aufgaben`);
    expect(liste.body.aufgaben.map((t: { id: string }) => t.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(
      liste.body.aufgaben.map((t: { version: number }) => t.version),
    ).toEqual([1, 1]);
  });
});

describe("Löschen", () => {
  test("löscht über den Sync-Kern: weg aus Liste und Einzelabruf, der Feed meldet «geloescht», erneutes Löschen 404", async () => {
    const id = await neuesLager();
    const a = await neu({}, id);
    const [lagerVorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    const d = await anfrage(
      leiter(),
      "DELETE",
      `${L(id)}/aufgaben/${a.id}?version=1`,
    );
    expect(d.status).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/aufgaben/${a.id}`)).status,
    ).toBe(404);
    expect(
      (await anfrage(leiter(), "GET", `${L(id)}/aufgaben`)).body.aufgaben,
    ).toEqual([]);
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/aenderungen?seit=${lagerVorher!.seq}`,
    );
    expect(feed.body.eintraege).toEqual([
      expect.objectContaining({
        objekttyp: "aufgabe",
        id: a.id,
        art: "geloescht",
      }),
    ]);
    expect(
      (await anfrage(leiter(), "DELETE", `${L(id)}/aufgaben/${a.id}?version=2`))
        .status,
    ).toBe(404);
    // Ändern und Status einer gelöschten Aufgabe: 404
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(id)}/aufgaben/${a.id}`, {
          version: 2,
          titel: "X",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "PUT", `${L(id)}/aufgaben/${a.id}/status`, {
          version: 2,
          status: "laeuft",
        })
      ).status,
    ).toBe(404);
  });

  test("Version fehlt oder ist ungültig: 400; veraltet: 409 und die Aufgabe bleibt", async () => {
    const a = await neu();
    for (const q of ["", "?version=0", "?version=x"]) {
      expect(
        (await anfrage(leiter(), "DELETE", `${L()}/aufgaben/${a.id}${q}`))
          .status,
      ).toBe(400);
    }
    await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      stern: true,
    });
    const k = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/aufgaben/${a.id}?version=1`,
    );
    expect(k.status).toBe(409);
    expect(k.body.aktuell).toMatchObject({ stern: true, version: 2 });
    expect(
      (await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`)).status,
    ).toBe(200);
  });
});

describe("Änderungsfeed", () => {
  test("das Team bekommt nur die Einträge eigener Aufgaben, Lesen alle", async () => {
    const id = await neuesLager();
    const [vorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id));
    const eigene = await neu({ verantwortlichPersonId: team().id }, id);
    const fremde = await neu({}, id);
    await anfrage(leiter(), "PATCH", `${L(id)}/aufgaben/${fremde.id}`, {
      version: 1,
      stern: true,
    });
    const feed = async (konto: PersonaKonto) =>
      (
        await anfrage(konto, "GET", `${L(id)}/aenderungen?seit=${vorher!.seq}`)
      ).body.eintraege.map((e: { id: string }) => e.id);
    expect(await feed(team())).toEqual([eigene.id]);
    expect((await feed(konten.lesen)).sort()).toEqual(
      [eigene.id, fremde.id, fremde.id].sort(),
    );
    // Ohne seit: Das Team sieht den Typ, weil es eigene Aufgaben lesen darf
    const typen = await anfrage(team(), "GET", `${L(id)}/aenderungen`);
    expect(typen.body.objekttypen).toContain("aufgabe");
  });

  test("Lesen ohne Aufgabenrecht sieht den Typ nicht", async () => {
    const id = await neuesLager();
    await db.insert(schema.lagerRolleRecht).values([
      {
        lagerId: id,
        rolle: "lesen",
        recht: "aufgaben.lesen_alle",
        erlaubt: false,
      },
    ]);
    const typen = await anfrage(konten.lesen, "GET", `${L(id)}/aenderungen`);
    expect(typen.body.objekttypen).not.toContain("aufgabe");
  });
});

describe("Mitglied entfernt", () => {
  test("die Aufgabe verliert die Verantwortliche und die Unterstützung, fällt aber nicht weg", async () => {
    const v = await mitglied();
    const u = await mitglied();
    const a = await neu({
      verantwortlichPersonId: v,
      unterstuetzungPersonIds: [u],
    });
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, v),
        ),
      );
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, u),
        ),
      );
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${a.id}`);
    expect(get.status).toBe(200);
    expect(get.body.verantwortlichPersonId).toBeNull();
    expect(get.body.unterstuetzung).toEqual([]);
  });
});

describe("Benachrichtigungen", () => {
  async function legeToken(userId: string) {
    const [sitzung] = await db
      .insert(schema.session)
      .values({
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
        updatedAt: new Date(),
        userId,
      })
      .returning({ id: schema.session.id });
    const token = `fcm-test-${randomUUID()}`;
    await db.insert(schema.pushToken).values({
      sessionId: sitzung!.id,
      token,
      userId,
      plattform: "android",
    });
    return token;
  }
  const zeilen = (personId: string, aufgabeId?: string) =>
    db
      .select()
      .from(schema.lagerBenachrichtigung)
      .where(
        and(
          eq(schema.lagerBenachrichtigung.personId, personId),
          aufgabeId
            ? eq(schema.lagerBenachrichtigung.objektId, aufgabeId)
            : undefined,
        ),
      );
  const arten = async (personId: string, aufgabeId: string) =>
    (await zeilen(personId, aufgabeId)).map((z) => z.art).sort();

  test("Zuteilung: die Verantwortliche und die Unterstützung bekommen «aufgabe_zugeteilt», der Auslöser nie; der Push nennt den Titel nicht", async () => {
    const v = await mitglied();
    const u = await mitglied();
    const tokenV = await legeToken(v);
    await legeToken(u);
    const a = await neu({
      titel: "Streng geheimer Titel",
      verantwortlichPersonId: v,
      unterstuetzungPersonIds: [u],
    });
    expect(await arten(v, a.id)).toEqual(["aufgabe_zugeteilt"]);
    expect(await arten(u, a.id)).toEqual(["aufgabe_zugeteilt"]);
    expect(await zeilen(leiter().id!, a.id)).toEqual([]);
    expect(gesendet).toHaveLength(2);
    const nachricht = gesendet.find((n) => n.token === tokenV)!;
    expect(nachricht.data).toEqual({ typ: "lager_aufgabe", id: a.id });
    expect(nachricht.notification).toEqual({
      title: "Neue Aufgabe für dich",
      body: "Aufgabenlager",
    });
    expect(JSON.stringify(gesendet)).not.toMatch(/geheim/i);
    const [z] = await zeilen(v, a.id);
    expect(z).toMatchObject({ objektTyp: "aufgabe", lagerId });
  });

  test("ohne Person wird die Leitung des Ressorts benachrichtigt", async () => {
    const leitung = await mitglied();
    const a = await neu({ ressortId: await ressort(leitung) });
    expect(await arten(leitung, a.id)).toEqual(["aufgabe_zugeteilt"]);
  });

  test("wer sich selbst zuteilt, bekommt nichts", async () => {
    const eigene = await neu({ verantwortlichPersonId: leiter().id });
    expect(await zeilen(leiter().id!, eigene.id)).toEqual([]);
  });

  test("Änderung durch andere: «aufgabe_geaendert» an die Beteiligten, nicht an den Auslöser", async () => {
    const v = await mitglied();
    const u = await mitglied();
    const a = await neu({
      verantwortlichPersonId: v,
      unterstuetzungPersonIds: [u],
    });
    gesendet = [];
    await legeToken(v);
    const r = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      titel: "Anderer Titel",
    });
    expect(r.status).toBe(200);
    expect(await arten(v, a.id)).toEqual([
      "aufgabe_geaendert",
      "aufgabe_zugeteilt",
    ]);
    expect(await arten(u, a.id)).toEqual([
      "aufgabe_geaendert",
      "aufgabe_zugeteilt",
    ]);
    expect(await zeilen(leiter().id!, a.id)).toEqual([]);
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]!.notification?.title).toBe("Aufgabe geändert");
    expect(JSON.stringify(gesendet)).not.toContain("Anderer Titel");
  });

  test("Team setzt den Status der eigenen Aufgabe: die anderen Beteiligten erfahren es, es selbst nicht", async () => {
    const u = await mitglied();
    const a = await neu({
      verantwortlichPersonId: team().id,
      unterstuetzungPersonIds: [u],
    });
    const s = await anfrage(team(), "PUT", `${L()}/aufgaben/${a.id}/status`, {
      version: 1,
      status: "erledigt",
    });
    expect(s.status).toBe(200);
    expect(await arten(u, a.id)).toEqual([
      "aufgabe_geaendert",
      "aufgabe_zugeteilt",
    ]);
    expect(
      (await arten(team().id!, a.id)).filter((x) => x === "aufgabe_geaendert"),
    ).toEqual([]);
  });

  test("Umbesetzung: neue Verantwortliche «zugeteilt», bisherige «geaendert», neue Unterstützung «zugeteilt»", async () => {
    const alt = await mitglied();
    const neuePerson = await mitglied();
    const unterstuetzer = await mitglied();
    const a = await neu({ verantwortlichPersonId: alt });
    await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      verantwortlichPersonId: neuePerson,
      unterstuetzungPersonIds: [unterstuetzer],
    });
    expect(await arten(neuePerson, a.id)).toEqual(["aufgabe_zugeteilt"]);
    expect(await arten(unterstuetzer, a.id)).toEqual(["aufgabe_zugeteilt"]);
    expect(await arten(alt, a.id)).toEqual([
      "aufgabe_geaendert",
      "aufgabe_zugeteilt",
    ]);
  });

  test("eine abgeschaltete Art bekommt weder Eintrag noch Push", async () => {
    const v = await mitglied();
    await legeToken(v);
    await db.insert(schema.lagerBenachrichtigungEinstellung).values({
      personId: v,
      art: "aufgabe_zugeteilt",
      aktiv: false,
    });
    gesendet = [];
    const a = await neu({ verantwortlichPersonId: v });
    expect(await zeilen(v, a.id)).toEqual([]);
    expect(gesendet).toEqual([]);
  });

  test("ein Konflikt oder ein Fehler schreibt keine Benachrichtigung", async () => {
    const v = await mitglied();
    const a = await neu({ verantwortlichPersonId: v });
    const vorher = (await zeilen(v, a.id)).length;
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/aufgaben/${a.id}`,
      {
        version: 9,
        titel: "X",
      },
    );
    expect(konflikt.status).toBe(409);
    const kein = await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      verantwortlichPersonId: konten.ohneMitgliedschaft.id,
    });
    expect(kein.status).toBe(400);
    expect((await zeilen(v, a.id)).length).toBe(vorher);
  });
});

describe("Warteschlange für Offline-Änderungen", () => {
  type Ergebnis = {
    clientOpId: string;
    status: string;
    code?: string;
    ergebnis?: { id: string; version: number };
    aktuell?: { titel: string };
    abweichend?: string[];
  };
  async function sende(
    konto: PersonaKonto,
    operationen: { typ: string; nutzlast: Record<string, unknown> }[],
    clientOpIds = operationen.map(() => randomUUID()),
    id = lagerId,
  ) {
    const a = await anfrage(konto, "POST", `${L(id)}/aenderungen`, {
      operationen: operationen.map((o, i) => ({
        clientOpId: clientOpIds[i],
        ...o,
      })),
    });
    expect(a.status).toBe(200);
    return a.body.ergebnisse as Ergebnis[];
  }

  test("anlegen, ändern, Status und löschen laufen wie über die Routen", async () => {
    const v = await mitglied();
    const [angelegt] = await sende(leiter(), [
      {
        typ: "aufgabe.anlegen",
        nutzlast: { titel: "Offline angelegt", verantwortlichPersonId: v },
      },
    ]);
    expect(angelegt).toMatchObject({ status: "ok", ergebnis: { version: 1 } });
    const id = angelegt!.ergebnis!.id;
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${id}`);
    expect(get.body).toMatchObject({
      titel: "Offline angelegt",
      verantwortlichPersonId: v,
    });

    const [geaendert, status] = await sende(leiter(), [
      { typ: "aufgabe.aendern", nutzlast: { id, version: 1, stern: true } },
      {
        typ: "aufgabe.status",
        nutzlast: { id, version: 2, status: "erledigt" },
      },
    ]);
    expect(geaendert).toMatchObject({
      status: "ok",
      ergebnis: { id, version: 2 },
    });
    expect(status).toMatchObject({ status: "ok", ergebnis: { version: 3 } });
    const nachher = await anfrage(leiter(), "GET", `${L()}/aufgaben/${id}`);
    expect(nachher.body).toMatchObject({ stern: true, status: "erledigt" });
    expect(nachher.body.erledigtAm).not.toBeNull();
    // Die Glocke der Verantwortlichen hat den Eintrag, auch wenn die Warteschlange keinen Push sendet
    const zeilen = await db
      .select()
      .from(schema.lagerBenachrichtigung)
      .where(eq(schema.lagerBenachrichtigung.personId, v));
    expect(zeilen.map((z) => z.art)).toContain("aufgabe_zugeteilt");

    const [weg] = await sende(leiter(), [
      { typ: "aufgabe.loeschen", nutzlast: { id, version: 3 } },
    ]);
    expect(weg!.status).toBe("ok");
    expect(
      (await anfrage(leiter(), "GET", `${L()}/aufgaben/${id}`)).status,
    ).toBe(404);
  });

  test("eine Wiederholung mit derselben clientOpId schreibt nicht doppelt", async () => {
    const op = randomUUID();
    const nutzlast = { titel: "Einmalig" };
    const erste = await sende(
      leiter(),
      [{ typ: "aufgabe.anlegen", nutzlast }],
      [op],
    );
    const zweite = await sende(
      leiter(),
      [{ typ: "aufgabe.anlegen", nutzlast }],
      [op],
    );
    expect(zweite).toEqual(erste);
    const liste = await anfrage(leiter(), "GET", `${L()}/aufgaben?limit=200`);
    expect(
      liste.body.aufgaben.filter(
        (a: { titel: string }) => a.titel === "Einmalig",
      ),
    ).toHaveLength(1);
  });

  test("eine veraltete Version ist ein Konflikt mit dem Stand und den abweichenden Feldern", async () => {
    const a = await neu({ titel: "Eins" });
    await anfrage(leiter(), "PATCH", `${L()}/aufgaben/${a.id}`, {
      version: 1,
      titel: "Zwei",
    });
    const [k] = await sende(leiter(), [
      {
        typ: "aufgabe.aendern",
        nutzlast: { id: a.id, version: 1, titel: "Drei" },
      },
    ]);
    expect(k).toMatchObject({
      status: "konflikt",
      code: "VERSION_KONFLIKT",
      aktuell: { titel: "Zwei" },
      abweichend: ["titel"],
    });
  });

  test("die Rechte der Rolle gelten wie an den Routen", async () => {
    const eigene = await neu({ verantwortlichPersonId: team().id });
    const fremde = await neu();
    const [anlegen, aendern, statusEigene, statusFremde, loeschen] =
      await sende(team(), [
        { typ: "aufgabe.anlegen", nutzlast: { titel: "X" } },
        {
          typ: "aufgabe.aendern",
          nutzlast: { id: eigene.id, version: 1, titel: "X" },
        },
        {
          typ: "aufgabe.status",
          nutzlast: { id: eigene.id, version: 1, status: "laeuft" },
        },
        {
          typ: "aufgabe.status",
          nutzlast: { id: fremde.id, version: 1, status: "laeuft" },
        },
        { typ: "aufgabe.loeschen", nutzlast: { id: eigene.id, version: 1 } },
      ]);
    expect(anlegen).toMatchObject({
      status: "abgelehnt",
      code: "KEINE_BERECHTIGUNG",
    });
    expect(aendern!.code).toBe("KEINE_BERECHTIGUNG");
    expect(statusEigene).toMatchObject({ status: "ok" });
    expect(statusFremde).toMatchObject({
      status: "abgelehnt",
      code: "NICHT_GEFUNDEN",
    });
    expect(loeschen!.code).toBe("KEINE_BERECHTIGUNG");
    // Lesen hat weder bearbeiten noch eigene
    const [lesen] = await sende(konten.lesen, [
      {
        typ: "aufgabe.status",
        nutzlast: { id: fremde.id, version: 1, status: "laeuft" },
      },
    ]);
    expect(lesen!.code).toBe("KEINE_BERECHTIGUNG");
    const get = await anfrage(leiter(), "GET", `${L()}/aufgaben/${fremde.id}`);
    expect(get.body.status).toBe("offen");
  });

  test("ungültige Nutzlast und Nicht-Mitglieder werden abgelehnt, Fremdes bleibt unberührt", async () => {
    const andere = await neu({}, andereLagerId);
    const [unbekannt, fremdesLager, keinMitglied] = await sende(leiter(), [
      {
        typ: "aufgabe.anlegen",
        nutzlast: { titel: "X", erledigtAm: new Date().toISOString() },
      },
      {
        typ: "aufgabe.aendern",
        nutzlast: { id: andere.id, version: 1, titel: "Fremd" },
      },
      {
        typ: "aufgabe.anlegen",
        nutzlast: {
          titel: "X",
          verantwortlichPersonId: konten.ohneMitgliedschaft.id,
        },
      },
    ]);
    expect(unbekannt).toMatchObject({
      status: "abgelehnt",
      code: "UNGUELTIGE_EINGABE",
    });
    expect(fremdesLager).toMatchObject({
      status: "abgelehnt",
      code: "NICHT_GEFUNDEN",
    });
    expect(keinMitglied).toMatchObject({
      status: "abgelehnt",
      code: "UNGUELTIGE_EINGABE",
    });
    const get = await anfrage(
      leiter(),
      "GET",
      `${L(andereLagerId)}/aufgaben/${andere.id}`,
    );
    expect(get.body.titel).toBe("Aufgabe");
  });

  test("im abgeschlossenen Lager nimmt die Warteschlange nichts an", async () => {
    const a = await anfrage(
      leiter(),
      "POST",
      `${L(geschlossenId)}/aenderungen`,
      {
        operationen: [
          {
            clientOpId: randomUUID(),
            typ: "aufgabe.anlegen",
            nutzlast: { titel: "X" },
          },
        ],
      },
    );
    expect(a.status).toBe(409);
  });
});
