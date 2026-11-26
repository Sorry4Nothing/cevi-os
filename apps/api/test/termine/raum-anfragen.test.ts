import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import type { Db } from "../../src/db/client.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import { loescheAlteBuchungen } from "../../src/termine/raum-buchung.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  fcmNachricht,
} from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

const fcmAttrappe = bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = {
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  fcm: fcmAttrappe,
  seiten: ladeSeiten(),
};
const app = erstelleApp(optionen);
afterAll(() => sql.end());

const BASIS = "/api/v1/raeume/anfragen";

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
let teamTagId: string;
// Mitglieder des Teams: leitendeA und leitendeB
let leitungA: PersonaKonto;
let leitungB: PersonaKonto;
let eltern: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(PERSONAS.map((p) => legePersonaAn(welt, p)));
  konten = Object.fromEntries(
    PERSONAS.map((p, i) => [p, liste[i]]),
  ) as typeof konten;
  teamTagId = await neuerTeamTag(welt.testabteilungId);
  leitungA = konten.leitendeA;
  leitungB = konten.leitendeB;
  eltern = konten.elternA;
  await db.insert(schema.personTag).values([
    { userId: leitungA.id!, tagId: teamTagId },
    { userId: leitungB.id!, tagId: teamTagId },
  ]);
});
beforeEach(() => fcmAttrappe.zuruecksetzen());

async function neuerTeamTag(abteilungId: string) {
  const [t] = await db
    .insert(schema.tag)
    .values({
      abteilungId,
      typ: "team",
      name: `Raumteam ${randomUUID().slice(0, 8)}`,
      kuerzel: "RT",
    })
    .returning({ id: schema.tag.id });
  return t!.id;
}

async function neuerRaum(
  opt: { team?: boolean; aktiv?: boolean; abteilungId?: string } = {},
) {
  const [r] = await db
    .insert(schema.raum)
    .values({
      abteilungId: opt.abteilungId ?? welt.testabteilungId,
      name: `Raum ${randomUUID().slice(0, 8)}`,
      teamTagId: opt.team === false ? null : teamTagId,
      aktiv: opt.aktiv ?? true,
    })
    .returning({ id: schema.raum.id });
  return r!.id;
}

// Eine Zeit weit in der Zukunft, je Tag und Stunde frei wählbar
const zeit = (tag: number, stunde: number, dauerStunden = 2) => {
  const beginn = new Date(Date.UTC(2100, 0, 1 + tag, stunde));
  return {
    beginn: beginn.toISOString(),
    ende: new Date(beginn.getTime() + dauerStunden * 36e5).toISOString(),
  };
};

const aufruf = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
  anwendung = app,
) =>
  anwendung.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Anfrage = { id: string } & Record<string, unknown>;
type Json = {
  id: string;
  status: string;
  code: string;
  weitere: boolean;
  naechste: string | null;
  anfragen: Anfrage[];
};
const json = async (r: Response) => (await r.json()) as Json;

const anfragen = async (
  konto: PersonaKonto,
  raumId: string,
  z = zeit(0, 10),
  zweck = "Gruppenabend",
) =>
  aufruf(konto, "POST", `/api/v1/raeume/${raumId}/anfragen`, { ...z, zweck });

const entscheide = (
  konto: PersonaKonto,
  id: string,
  b: Record<string, unknown> = { entscheid: "annehmen" },
) => aufruf(konto, "POST", `${BASIS}/${id}/entscheid`, b);

// Direkt in die Datenbank: eine Anfrage, ohne dass die Route sie zählt
async function fuegeEin(
  raumId: string,
  vonId: string,
  z: { beginn: string; ende: string },
  status: "angefragt" | "bestaetigt" | "abgelehnt" | "storniert" = "angefragt",
) {
  const [b] = await db
    .insert(schema.raumBuchung)
    .values({
      raumId,
      userId: vonId,
      beginn: new Date(z.beginn),
      ende: new Date(z.ende),
      zweck: "Direkt",
      status,
      entschiedenAm:
        status === "bestaetigt" || status === "abgelehnt" ? new Date() : null,
    })
    .returning({ id: schema.raumBuchung.id });
  return b!.id;
}

const stand = async (id: string) =>
  (
    await db
      .select({ status: schema.raumBuchung.status })
      .from(schema.raumBuchung)
      .where(eq(schema.raumBuchung.id, id))
  )[0]?.status;

async function token(konto: PersonaKonto) {
  const wert = `fcm-test-${randomUUID()}`;
  const antwort = await aufruf(konto, "PUT", "/api/v1/push-token", {
    token: wert,
    plattform: "android",
  });
  expect(antwort.status).toBe(204);
  return wert;
}

describe("Anfragen: Eingabe und Grenzen", () => {
  test("eine Anfrage wird 201 und steht in «meine»", async () => {
    const raum = await neuerRaum();
    const r = await anfragen(eltern, raum);
    expect(r.status).toBe(201);
    const { id, status } = await json(r);
    expect(status).toBe("angefragt");
    const meine = await json(await aufruf(eltern, "GET", `${BASIS}/meine`));
    expect(meine.anfragen[0]).toMatchObject({
      id,
      raumId: raum,
      status: "angefragt",
      zweck: "Gruppenabend",
      begruendung: null,
    });
    expect(meine.anfragen[0]).not.toHaveProperty("vonName");
  });

  test.each([
    [
      "Zeit in der Vergangenheit",
      { beginn: "2020-01-01T10:00:00Z", ende: "2020-01-01T12:00:00Z" },
      "ZEIT_VERGANGEN",
    ],
    [
      "mehr als 14 Tage",
      { beginn: zeit(0, 10).beginn, ende: zeit(15, 10).beginn },
      "ZEIT_ZU_LANG",
    ],
  ])("%s ist 400 mit Code", async (_n, z, code) => {
    const raum = await neuerRaum();
    const r = await aufruf(eltern, "POST", `/api/v1/raeume/${raum}/anfragen`, {
      ...z,
      zweck: "x",
    });
    expect(r.status).toBe(400);
    expect((await json(r)).code).toBe(code);
  });

  test("genau 14 Tage sind erlaubt", async () => {
    const raum = await neuerRaum();
    const r = await aufruf(eltern, "POST", `/api/v1/raeume/${raum}/anfragen`, {
      beginn: zeit(0, 10).beginn,
      ende: zeit(14, 10).beginn,
      zweck: "Lager im Haus",
    });
    expect(r.status).toBe(201);
  });

  test.each([
    [
      "Ende vor Beginn",
      { beginn: zeit(1, 12).beginn, ende: zeit(1, 10).beginn, zweck: "x" },
    ],
    [
      "Ende gleich Beginn",
      { beginn: zeit(1, 10).beginn, ende: zeit(1, 10).beginn, zweck: "x" },
    ],
    ["Zweck leer", { ...zeit(1, 10), zweck: "  " }],
    ["Zweck 201 Zeichen", { ...zeit(1, 10), zweck: "a".repeat(201) }],
    ["Zweck mit Zeilenumbruch", { ...zeit(1, 10), zweck: "a\nb" }],
    ["Zweck mit NUL", { ...zeit(1, 10), zweck: "a\u0000b" }],
    ["fremdes Feld", { ...zeit(1, 10), zweck: "x", status: "bestaetigt" }],
    [
      "Zeit ohne Zeitzone",
      {
        beginn: "2100-01-01T10:00:00",
        ende: "2100-01-01T12:00:00",
        zweck: "x",
      },
    ],
    ["Zeit fehlt", { zweck: "x" }],
  ])("%s ist 400", async (_n, body) => {
    const raum = await neuerRaum();
    const r = await aufruf(
      eltern,
      "POST",
      `/api/v1/raeume/${raum}/anfragen`,
      body,
    );
    expect(r.status).toBe(400);
  });

  test("Zweck mit 200 Zeichen geht, getrimmt", async () => {
    const raum = await neuerRaum();
    expect(
      (await anfragen(eltern, raum, zeit(2, 10), ` ${"a".repeat(200)} `))
        .status,
    ).toBe(201);
  });

  test("fremder, unbekannter und inaktiver Raum sind 404", async () => {
    const fremd = await neuerRaum({ abteilungId: welt.demoAbteilungId });
    expect((await anfragen(eltern, fremd)).status).toBe(404);
    expect((await anfragen(eltern, randomUUID())).status).toBe(404);
    const inaktiv = await neuerRaum({ aktiv: false });
    expect((await anfragen(eltern, inaktiv)).status).toBe(404);
  });

  test("höchstens 10 offene Anfragen je Person; vergangene und erledigte zählen nicht", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    for (let i = 0; i < 9; i++) await fuegeEin(raum, person.id!, zeit(i, 10));
    // Nicht mehr offen: abgesagt, abgelehnt, Zeit vorbei
    await fuegeEin(raum, person.id!, zeit(20, 10), "storniert");
    await fuegeEin(raum, person.id!, zeit(21, 10), "abgelehnt");
    await fuegeEin(raum, person.id!, {
      beginn: "2020-01-01T10:00:00Z",
      ende: "2020-01-01T12:00:00Z",
    });
    expect((await anfragen(person, raum, zeit(30, 10))).status).toBe(201);
    const elfte = await anfragen(person, raum, zeit(31, 10));
    expect(elfte.status).toBe(409);
    expect((await json(elfte)).code).toBe("ANFRAGE_LIMIT");
  });

  test("gleichzeitige Anfragen überspringen die Obergrenze nicht", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    for (let i = 0; i < 8; i++) await fuegeEin(raum, person.id!, zeit(i, 10));
    const antworten = await Promise.all(
      [40, 41, 42, 43].map((t) => anfragen(person, raum, zeit(t, 10))),
    );
    const stati = antworten.map((a) => a.status).sort();
    expect(stati).toEqual([201, 201, 409, 409]);
  });

  test("Rate-Limit: höchstens 20 Anfragen je Konto in 10 Minuten (429)", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    let letzte = 0;
    for (let i = 0; i < 21; i++) {
      letzte = (await anfragen(person, raum, zeit(50 + i, 10))).status;
    }
    expect(letzte).toBe(429);
  });
});

describe("Ablauf: anfragen, entscheiden, Push", () => {
  test("Anfrage, Liste der Entscheidenden, Annahme, Push mit festem Text", async () => {
    const raum = await neuerRaum();
    const tokenA = await token(leitungA);
    const tokenB = await token(leitungB);
    const tokenEltern = await token(eltern);
    const tokenFremd = await token(konten.slA);

    const { id } = await json(await anfragen(eltern, raum));
    // Push an das Team, nie an die anfragende Person oder Fremde; fester Text, nie Name oder Zweck
    expect(fcmAttrappe.nachrichten).toHaveLength(2);
    for (const t of [tokenA, tokenB]) {
      expect(fcmAttrappe.nachrichten).toContainEqual(
        fcmNachricht(
          t,
          "Neue Raumanfrage",
          { typ: "raum_anfrage", id },
          "raeume",
          "Eine Raumanfrage wartet auf deinen Entscheid.",
        ),
      );
    }
    const gesendet = JSON.stringify(fcmAttrappe.nachrichten);
    expect(gesendet).not.toContain("Gruppenabend");
    expect(gesendet).not.toContain(tokenEltern);
    expect(gesendet).not.toContain(tokenFremd);

    const offen = await json(await aufruf(leitungB, "GET", `${BASIS}/offen`));
    expect(offen.anfragen.map((a: { id: string }) => a.id)).toContain(id);
    expect(
      offen.anfragen.find((a: { id: string }) => a.id === id),
    ).toMatchObject({
      raumId: raum,
      zweck: "Gruppenabend",
      vonName: expect.any(String),
    });
    // Wer nichts entscheidet, bekommt eine leere Liste
    for (const k of [eltern, konten.slA, konten.leitendeAElternB]) {
      const leer = await json(await aufruf(k, "GET", `${BASIS}/offen`));
      expect(leer.anfragen.map((a: { id: string }) => a.id)).not.toContain(id);
    }

    fcmAttrappe.zuruecksetzen();
    const r = await entscheide(leitungA, id);
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ id, status: "bestaetigt" });
    expect(fcmAttrappe.nachrichten).toEqual([
      fcmNachricht(
        tokenEltern,
        "Entscheid zu deiner Raumanfrage",
        { typ: "raum_entscheid", id },
        "raeume",
        "Deine Raumanfrage ist angenommen.",
      ),
    ]);
    const meine = await json(await aufruf(eltern, "GET", `${BASIS}/meine`));
    expect(
      meine.anfragen.find((a: { id: string }) => a.id === id),
    ).toMatchObject({
      status: "bestaetigt",
      begruendung: null,
    });
    // Nicht mehr offen, und ein zweiter Entscheid ist 409
    const danach = await json(await aufruf(leitungB, "GET", `${BASIS}/offen`));
    expect(danach.anfragen.map((a: { id: string }) => a.id)).not.toContain(id);
    expect((await entscheide(leitungB, id)).status).toBe(409);
  });

  test("Ablehnen braucht eine Begründung, Annehmen darf keine haben", async () => {
    const raum = await neuerRaum();
    const { id } = await json(await anfragen(eltern, raum));
    for (const b of [
      { entscheid: "ablehnen" },
      { entscheid: "ablehnen", begruendung: " " },
      { entscheid: "annehmen", begruendung: "Doch" },
      { entscheid: "ablehnen", begruendung: "x".repeat(501) },
      { entscheid: "vielleicht" },
      { entscheid: "annehmen", extra: 1 },
    ]) {
      expect((await entscheide(leitungA, id, b)).status).toBe(400);
    }
    const tokenEltern = await token(eltern);
    fcmAttrappe.zuruecksetzen();
    const r = await entscheide(leitungA, id, {
      entscheid: "ablehnen",
      begruendung: "Der Raum ist im Umbau.",
    });
    expect(r.status).toBe(200);
    expect((await json(r)).status).toBe("abgelehnt");
    // Die Begründung steht nur bei der anfragenden Person, nie im Push
    expect(JSON.stringify(fcmAttrappe.nachrichten)).not.toContain("Umbau");
    expect(fcmAttrappe.nachrichten[0]?.notification?.body).toBe(
      "Deine Raumanfrage ist abgelehnt.",
    );
    expect(fcmAttrappe.nachrichten[0]?.token).toBe(tokenEltern);
    const meine = await json(await aufruf(eltern, "GET", `${BASIS}/meine`));
    expect(
      meine.anfragen.find((a: { id: string }) => a.id === id),
    ).toMatchObject({
      status: "abgelehnt",
      begruendung: "Der Raum ist im Umbau.",
    });
  });

  test("die eigene Anfrage entscheidet nie dieselbe Person, auch nicht im Team", async () => {
    const raum = await neuerRaum();
    const tokenA = await token(leitungA);
    const tokenB = await token(leitungB);
    const { id } = await json(await anfragen(leitungA, raum));
    // Push nicht an die anfragende Person
    expect(fcmAttrappe.nachrichten.map((n) => n.token)).toEqual([tokenB]);
    expect(fcmAttrappe.nachrichten.map((n) => n.token)).not.toContain(tokenA);
    const eigene = await entscheide(leitungA, id);
    expect(eigene.status).toBe(403);
    expect((await json(eigene)).code).toBe("EIGENE_ANFRAGE");
    // Die eigene Anfrage steht nicht in der eigenen Liste der Entscheidenden
    const offen = await json(await aufruf(leitungA, "GET", `${BASIS}/offen`));
    expect(offen.anfragen.map((a: { id: string }) => a.id)).not.toContain(id);
    expect((await entscheide(leitungB, id)).status).toBe(200);
  });

  test("Raum ohne Team: nur die Abteilungsleitung mit zweitem Faktor entscheidet und bekommt den Push", async () => {
    const raum = await neuerRaum({ team: false });
    const tokenAdmin = await token(konten.admin);
    const tokenOhneFaktor = await token(konten.adminOhneZweitenFaktor);
    const tokenTeam = await token(leitungA);
    const { id } = await json(await anfragen(eltern, raum));
    expect(fcmAttrappe.nachrichten.map((n) => n.token)).toContain(tokenAdmin);
    expect(fcmAttrappe.nachrichten.map((n) => n.token)).not.toContain(
      tokenOhneFaktor,
    );
    expect(fcmAttrappe.nachrichten.map((n) => n.token)).not.toContain(
      tokenTeam,
    );

    const offen = async (k: PersonaKonto) =>
      (await json(await aufruf(k, "GET", `${BASIS}/offen`))).anfragen.map(
        (a: { id: string }) => a.id,
      );
    expect(await offen(konten.admin)).toContain(id);
    expect(await offen(konten.adminOhneZweitenFaktor)).not.toContain(id);
    expect(await offen(leitungA)).not.toContain(id);

    for (const k of [
      leitungA,
      konten.adminOhneZweitenFaktor,
      konten.slA,
      eltern,
    ]) {
      expect((await entscheide(k, id)).status).toBe(403);
    }
    expect((await entscheide(konten.admin, id)).status).toBe(200);
  });

  test("mit Team entscheidet die Abteilungsleitung nicht", async () => {
    const raum = await neuerRaum();
    const { id } = await json(await anfragen(eltern, raum));
    expect((await entscheide(konten.admin, id)).status).toBe(403);
    expect(await stand(id)).toBe("angefragt");
  });

  test("fremde Abteilung: Anfrage unsichtbar (404 vor dem Recht)", async () => {
    const raum = await neuerRaum();
    const { id } = await json(await anfragen(eltern, raum));
    expect((await entscheide(konten.demoAdmin, id)).status).toBe(404);
    expect(
      (await aufruf(konten.demoAdmin, "DELETE", `${BASIS}/${id}`)).status,
    ).toBe(404);
  });

  test("deaktiviertes Konto der anfragenden Person: kein Push, Entscheid geht", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    await token(person);
    const { id } = await json(await anfragen(person, raum));
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, person.id!));
    fcmAttrappe.zuruecksetzen();
    expect((await entscheide(leitungA, id)).status).toBe(200);
    expect(fcmAttrappe.nachrichten).toEqual([]);
  });

  test("Schalter pushRaumEntscheid aus (#847): kein Push, Entscheid geht", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    await token(person);
    const { id } = await json(await anfragen(person, raum));
    expect(
      (
        await aufruf(person, "PATCH", "/api/v1/ich", {
          pushRaumEntscheid: false,
        })
      ).status,
    ).toBe(204);
    fcmAttrappe.zuruecksetzen();
    expect((await entscheide(leitungA, id)).status).toBe(200);
    expect(fcmAttrappe.nachrichten).toEqual([]);
  });

  test("ein Ausfall von FCM ändert den Entscheid nicht", async () => {
    const raum = await neuerRaum();
    await token(eltern);
    const { id } = await json(await anfragen(eltern, raum));
    fcmAttrappe.ausfall = true;
    expect((await entscheide(leitungA, id)).status).toBe(200);
    expect(await stand(id)).toBe("bestaetigt");
  });
});

describe("Doppelbuchung: RAUM_BELEGT", () => {
  test("Anfrage und Annahme überschneidender Zeiten sind 409; angrenzende gehen", async () => {
    const raum = await neuerRaum();
    const a = await json(await anfragen(eltern, raum, zeit(0, 10)));
    expect((await entscheide(leitungA, a.id)).status).toBe(200);

    // Sofort 409 bei der Anfrage, auch halb überlappend und eingeschlossen
    for (const z of [zeit(0, 11), zeit(0, 9), zeit(0, 10, 1), zeit(0, 8, 8)]) {
      const r = await anfragen(konten.elternB, raum, z);
      expect(r.status).toBe(409);
      expect((await json(r)).code).toBe("RAUM_BELEGT");
    }
    // Die Zeit endet, wo die andere beginnt: frei
    const davor = await anfragen(konten.elternB, raum, zeit(0, 8));
    const danach = await anfragen(konten.elternB, raum, zeit(0, 12));
    expect(davor.status).toBe(201);
    expect(danach.status).toBe(201);
    // Ein anderer Raum ist frei
    expect(
      (await anfragen(konten.elternB, await neuerRaum(), zeit(0, 10))).status,
    ).toBe(201);

    // Zwei offene Anfragen derselben Zeit: Die erste Annahme gewinnt, die zweite ist 409 und bleibt offen
    const b = await fuegeEin(raum, konten.elternB.id!, zeit(5, 10));
    const c = await fuegeEin(raum, konten.slB.id!, zeit(5, 11));
    expect((await entscheide(leitungA, b)).status).toBe(200);
    const zweite = await entscheide(leitungB, c);
    expect(zweite.status).toBe(409);
    expect((await json(zweite)).code).toBe("RAUM_BELEGT");
    expect(await stand(c)).toBe("angefragt");
    // Ablehnen geht trotzdem
    expect(
      (
        await entscheide(leitungB, c, {
          entscheid: "ablehnen",
          begruendung: "Belegt.",
        })
      ).status,
    ).toBe(200);
  });

  test("eine stornierte Buchung gibt die Zeit wieder frei", async () => {
    const raum = await neuerRaum();
    const a = await json(await anfragen(eltern, raum, zeit(7, 10)));
    await entscheide(leitungA, a.id);
    expect((await anfragen(konten.elternB, raum, zeit(7, 10))).status).toBe(
      409,
    );
    expect((await aufruf(eltern, "DELETE", `${BASIS}/${a.id}`)).status).toBe(
      204,
    );
    const neu = await json(await anfragen(konten.elternB, raum, zeit(7, 10)));
    expect((await entscheide(leitungA, neu.id)).status).toBe(200);
  });

  test("abgelehnte und offene Anfragen belegen nichts", async () => {
    const raum = await neuerRaum();
    await fuegeEin(raum, konten.elternB.id!, zeit(8, 10));
    await fuegeEin(raum, konten.elternB.id!, zeit(8, 10), "abgelehnt");
    await fuegeEin(raum, konten.elternB.id!, zeit(8, 10), "storniert");
    expect((await anfragen(eltern, raum, zeit(8, 10))).status).toBe(201);
  });

  test("Concurrency: zwei gleichzeitige Bestätigungen überlappender Zeiten, genau eine gewinnt (5 Runden)", async () => {
    const raum = await neuerRaum();
    // Eigene Personen: Die Verliererin bleibt offen und zählt sonst gegen die Obergrenze der Konten, die andere Tests teilen
    const personA = await legePersonaAn(welt, "elternA");
    const personB = await legePersonaAn(welt, "elternB");
    for (let runde = 0; runde < 5; runde++) {
      const a = await fuegeEin(raum, personA.id!, zeit(20 + runde, 10));
      const b = await fuegeEin(raum, personB.id!, zeit(20 + runde, 11));
      const antworten = await Promise.all([
        entscheide(leitungA, a),
        entscheide(leitungB, b),
        entscheide(leitungB, a),
        entscheide(leitungA, b),
      ]);
      const stati = antworten.map((r) => r.status);
      // Genau eine Bestätigung; die übrigen sind 409 (RAUM_BELEGT oder schon entschieden)
      expect(stati.filter((s) => s === 200)).toHaveLength(1);
      expect(
        stati.filter((s) => s === 409),
        JSON.stringify(stati),
      ).toHaveLength(3);
      const zeilen = await db
        .select({ status: schema.raumBuchung.status })
        .from(schema.raumBuchung)
        .where(inArray(schema.raumBuchung.id, [a, b]));
      expect(zeilen.filter((z) => z.status === "bestaetigt")).toHaveLength(1);
      expect(zeilen.filter((z) => z.status === "angefragt")).toHaveLength(1);
    }
  });

  test("Concurrency: ein gleichzeitiges Annehmen und Ablehnen derselben Anfrage ergibt einen Sieger", async () => {
    const raum = await neuerRaum();
    const a = await fuegeEin(
      raum,
      (await legePersonaAn(welt, "elternA")).id!,
      zeit(30, 10),
    );
    const [x, y] = await Promise.all([
      entscheide(leitungA, a),
      entscheide(leitungB, a, { entscheid: "ablehnen", begruendung: "Nein." }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const protokoll = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.zielId, a),
          eq(schema.auditLog.aktion, "raum_entschieden"),
        ),
      );
    expect(protokoll).toHaveLength(1);
  });
});

describe("Stornieren", () => {
  test("die eigene Anfrage und Buchung; ein zweites Mal ist ebenfalls 204; fremde sind 404", async () => {
    const raum = await neuerRaum();
    const { id } = await json(await anfragen(eltern, raum, zeit(60, 10)));
    // Auch die Abteilungsleitung und das Team sehen fremde Anfragen hier nicht
    for (const k of [konten.admin, leitungA, konten.elternB]) {
      expect((await aufruf(k, "DELETE", `${BASIS}/${id}`)).status).toBe(404);
    }
    expect((await aufruf(eltern, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    expect(await stand(id)).toBe("storniert");
    expect((await aufruf(eltern, "DELETE", `${BASIS}/${id}`)).status).toBe(204);
    // Nicht mehr offen für das Team
    const offen = await json(await aufruf(leitungA, "GET", `${BASIS}/offen`));
    expect(offen.anfragen.map((a: { id: string }) => a.id)).not.toContain(id);
  });

  test("abgelehnt und vorbei lassen sich nicht stornieren (409)", async () => {
    const raum = await neuerRaum();
    const abgelehnt = await fuegeEin(
      raum,
      eltern.id!,
      zeit(61, 10),
      "abgelehnt",
    );
    const vorbei = await fuegeEin(raum, eltern.id!, {
      beginn: "2020-01-01T10:00:00Z",
      ende: "2020-01-01T12:00:00Z",
    });
    for (const id of [abgelehnt, vorbei]) {
      const r = await aufruf(eltern, "DELETE", `${BASIS}/${id}`);
      expect(r.status).toBe(409);
      expect((await json(r)).code).toBe("STATUS_UNGUELTIG");
    }
  });

  test("eine Anfrage, deren Zeit vorbei ist, lässt sich nicht mehr entscheiden (409) und steht nicht in der Liste", async () => {
    const raum = await neuerRaum();
    const alt = await fuegeEin(raum, eltern.id!, {
      beginn: "2020-01-01T10:00:00Z",
      ende: "2020-01-01T12:00:00Z",
    });
    expect((await entscheide(leitungA, alt)).status).toBe(409);
    const offen = await json(
      await aufruf(leitungA, "GET", `${BASIS}/offen?limit=100`),
    );
    expect(offen.anfragen.map((a: { id: string }) => a.id)).not.toContain(alt);
  });
});

describe("Listen", () => {
  test("«meine»: eigene, neueste zuerst, in Seiten ohne Doppelte, nie fremde", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(await fuegeEin(raum, person.id!, zeit(i, 10)));
    await fuegeEin(raum, eltern.id!, zeit(9, 10));
    const gesehen: string[] = [];
    let nach: string | null = null;
    for (let i = 0; i < 4; i++) {
      const seite: Json = await json(
        await aufruf(
          person,
          "GET",
          `${BASIS}/meine?limit=2${nach ? `&nach=${nach}` : ""}`,
        ),
      );
      gesehen.push(...seite.anfragen.map((a: { id: string }) => a.id));
      nach = seite.naechste;
      if (!seite.weitere) break;
    }
    expect(gesehen).toEqual([...ids].reverse());
  });

  test("«offen»: älteste zuerst, in Seiten", async () => {
    // Eigenes Team mit einer eigenen Person: Die gemeinsame Warteschlange des Teams enthält Zeilen anderer Tests
    const entscheidend = await legePersonaAn(welt, "leitendeB");
    const eigenesTeam = await neuerTeamTag(welt.testabteilungId);
    await db
      .insert(schema.personTag)
      .values({ userId: entscheidend.id!, tagId: eigenesTeam });
    const [r] = await db
      .insert(schema.raum)
      .values({
        abteilungId: welt.testabteilungId,
        name: `Raum ${randomUUID().slice(0, 8)}`,
        teamTagId: eigenesTeam,
      })
      .returning({ id: schema.raum.id });
    const raum = r!.id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(await fuegeEin(raum, konten.slB.id!, zeit(70 + i, 10)));
    const gesehen: string[] = [];
    let nach: string | null = null;
    for (let i = 0; i < 20; i++) {
      const seite: Json = await json(
        await aufruf(
          entscheidend,
          "GET",
          `${BASIS}/offen?limit=1${nach ? `&nach=${nach}` : ""}`,
        ),
      );
      gesehen.push(...seite.anfragen.map((a: { id: string }) => a.id));
      nach = seite.naechste;
      if (!seite.weitere) break;
    }
    expect(gesehen).toEqual(ids);
  });

  test.each([["limit=0"], ["limit=101"], ["nach=kaputt"], ["extra=1"]])(
    "ungültige Abfrage %s ist 400",
    async (q) => {
      expect((await aufruf(eltern, "GET", `${BASIS}/meine?${q}`)).status).toBe(
        400,
      );
      expect((await aufruf(eltern, "GET", `${BASIS}/offen?${q}`)).status).toBe(
        400,
      );
    },
  );
});

describe("Räume löschen und Löschfrist", () => {
  test("offene Anfragen und künftige Buchungen sperren das Löschen eines Raums, vergangene nicht", async () => {
    const raum = await neuerRaum();
    const { id } = await json(await anfragen(eltern, raum, zeit(80, 10)));
    const weg = () =>
      aufruf(konten.admin, "DELETE", `/api/v1/admin/raeume/${raum}`);
    let r = await weg();
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe("ANFRAGEN_OFFEN");
    await entscheide(leitungA, id);
    expect((await weg()).status).toBe(409);
    await aufruf(eltern, "DELETE", `${BASIS}/${id}`);
    // Storniert, dazu eine vergangene Buchung: nichts hält den Raum fest
    await db
      .update(schema.raumBuchung)
      .set({
        beginn: new Date("2020-01-01T10:00:00Z"),
        ende: new Date("2020-01-01T12:00:00Z"),
      })
      .where(eq(schema.raumBuchung.id, id));
    r = await weg();
    expect(r.status).toBe(204);
    // Die Zeilen fallen mit dem Raum weg
    expect(await stand(id)).toBeUndefined();
  });

  test("der Löschlauf entfernt Zeilen 180 Tage nach dem Ende, jeden Stand, sonst nichts", async () => {
    const raum = await neuerRaum();
    const tage = (n: number) => new Date(Date.now() - n * 864e5);
    const mit = async (
      endeVorTagen: number,
      status: "angefragt" | "bestaetigt" | "storniert",
    ) => {
      const ende = tage(endeVorTagen);
      const [b] = await db
        .insert(schema.raumBuchung)
        .values({
          raumId: raum,
          userId: eltern.id!,
          beginn: new Date(ende.getTime() - 36e5),
          ende,
          zweck: "Alt",
          status,
          entschiedenAm: status === "bestaetigt" ? ende : null,
        })
        .returning({ id: schema.raumBuchung.id });
      return b!.id;
    };
    const alt1 = await mit(181, "bestaetigt");
    const alt2 = await mit(200, "storniert");
    const alt3 = await mit(400, "angefragt");
    const neu1 = await mit(179, "bestaetigt");
    const neu2 = await mit(1, "angefragt");
    const gezaehlt = await loescheAlteBuchungen(db);
    expect(gezaehlt).toBeGreaterThanOrEqual(3);
    for (const id of [alt1, alt2, alt3])
      expect(await stand(id)).toBeUndefined();
    for (const id of [neu1, neu2]) expect(await stand(id)).toBeDefined();
  });
});

describe("Datenschutz", () => {
  test("das Protokoll führt nie Zweck, Begründung oder Namen", async () => {
    const raum = await neuerRaum();
    const { id } = await json(
      await anfragen(eltern, raum, zeit(90, 10), "Geheimer-Zweck-XY"),
    );
    await entscheide(leitungA, id, {
      entscheid: "ablehnen",
      begruendung: "Geheime-Begruendung-XY",
    });
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([
      "raum_angefragt",
      "raum_entschieden",
    ]);
    const text = JSON.stringify(zeilen);
    expect(text).not.toContain("XY");
    expect(text).not.toContain("Gruppenabend");
  });

  test("mit dem Konto fallen die Anfragen weg, die Angabe des Entscheidenden bleibt leer", async () => {
    const person = await legePersonaAn(welt, "elternB");
    const entscheidend = await legePersonaAn(welt, "leitendeB");
    const raum = await neuerRaum();
    const a = await fuegeEin(raum, person.id!, zeit(95, 10));
    const b = await fuegeEin(raum, konten.elternA.id!, zeit(96, 10));
    await db
      .update(schema.raumBuchung)
      .set({
        status: "abgelehnt",
        entschiedenVon: entscheidend.id!,
        entschiedenAm: new Date(),
      })
      .where(eq(schema.raumBuchung.id, b));
    await db.delete(schema.user).where(eq(schema.user.id, entscheidend.id!));
    const [zeile] = await db
      .select()
      .from(schema.raumBuchung)
      .where(eq(schema.raumBuchung.id, b));
    expect(zeile?.entschiedenVon).toBeNull();
    await db.delete(schema.user).where(eq(schema.user.id, person.id!));
    expect(await stand(a)).toBeUndefined();
  });
});

describe("Abfragen je Aufruf", () => {
  test("Listen eine Abfrage, Anfragen und Entscheid wenige, nie je Zeile", async () => {
    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    const person = await legePersonaAn(welt, "elternB");
    const raum = await neuerRaum();
    for (let i = 0; i < 6; i++)
      await fuegeEin(raum, person.id!, zeit(100 + i, 10));
    const zaehle = async (
      k: PersonaKonto,
      m: string,
      p: string,
      b?: unknown,
    ) => {
      abfragen.length = 0;
      const r = await aufruf(k, m, p, b, zaehlApp);
      expect(r.status).toBeLessThan(300);
      return { r, n: abfragen.filter((q) => /"raum_buchung"/.test(q)).length };
    };
    // Zwei Anfragen, sechs Zeilen: trotzdem eine Abfrage je Seite
    expect((await zaehle(person, "GET", `${BASIS}/meine?limit=100`)).n).toBe(1);
    expect((await zaehle(leitungA, "GET", `${BASIS}/offen?limit=100`)).n).toBe(
      1,
    );
    // Anfragen: Zählen offener, Überschneidung, Einfügen (je höchstens eine) und das Protokoll gehört dem audit_log
    const neu = await zaehle(
      eltern,
      "POST",
      `/api/v1/raeume/${raum}/anfragen`,
      {
        ...zeit(110, 10),
        zweck: "Zählen",
      },
    );
    expect(neu.n).toBeLessThanOrEqual(3);
    const id = (await json(neu.r)).id as string;
    // Entscheid: Laden (Join), bedingtes UPDATE; dazu die Prüfung des Team-Tags (person_tag)
    expect(
      (
        await zaehle(leitungA, "POST", `${BASIS}/${id}/entscheid`, {
          entscheid: "annehmen",
        })
      ).n,
    ).toBeLessThanOrEqual(2);
    expect(
      (await zaehle(eltern, "DELETE", `${BASIS}/${id}`)).n,
    ).toBeLessThanOrEqual(2);
  });
});
