import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Jede Abfrage an die Datenbank zählt mit: Die Liste braucht gleich viele für kleine und grosse Listen
let abfragen = 0;
const sql = postgres(API_URL, {
  debug: () => {
    abfragen++;
  },
});
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;
// Jede Persona, die im Lager arbeiten darf: die vier Rollen und die Abteilungsleitung ohne Mitgliedschaft
const ARBEITER: LagerPersona[] = [
  "abteilungsleitung",
  "lagerleitung",
  "leitung",
  "team",
  "lesen",
];

async function neuesLager(status: "aktiv" | "abgeschlossen" = "aktiv") {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "To-do-Lager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
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
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await neuesLager();
  geschlossenId = await neuesLager("abgeschlossen");
});

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
const T = (id = lagerId) => `/api/v1/lager/${id}/todos`;
type Todo = {
  id: string;
  text: string;
  erledigt: boolean;
  reihenfolge: number;
};
const liste = async (p: LagerPersona, id = lagerId) =>
  (await anfrage(konten[p], "GET", T(id))).body.todos as Todo[];

describe("Private To-dos: nur für die Person selbst", () => {
  const eigene = new Map<LagerPersona, Todo>();

  test.each(ARBEITER)(
    "%s legt ein To-do an, liest es, ändert und hakt es ab",
    async (p) => {
      const neu = await anfrage(konten[p], "POST", T(), {
        text: `To-do von ${p}`,
      });
      expect(neu.status).toBe(201);
      expect(neu.body).toEqual({
        id: expect.any(String),
        text: `To-do von ${p}`,
        erledigt: false,
        reihenfolge: expect.any(Number),
      });
      eigene.set(p, neu.body);
      const geaendert = await anfrage(
        konten[p],
        "PATCH",
        `${T()}/${neu.body.id}`,
        { text: `Geändert von ${p}`, erledigt: true },
      );
      expect(geaendert.status).toBe(200);
      expect(geaendert.body).toMatchObject({
        id: neu.body.id,
        text: `Geändert von ${p}`,
        erledigt: true,
      });
      eigene.set(p, geaendert.body);
    },
  );

  // Der Kern des Issues: auch die Lagerleitung und die Abteilungsleitung sehen nie ein fremdes To-do
  test.each(ARBEITER)("%s sieht in der Liste nur die eigenen", async (p) => {
    const meine = await liste(p);
    expect(meine.map((t) => t.id)).toEqual([eigene.get(p)!.id]);
    const fremdeTexte = ARBEITER.filter((q) => q !== p).map(
      (q) => `Geändert von ${q}`,
    );
    for (const t of meine) expect(fremdeTexte).not.toContain(t.text);
  });

  test.each(ARBEITER)(
    "%s liest, ändert und löscht kein To-do einer anderen Person (404, unverändert)",
    async (p) => {
      for (const q of ARBEITER.filter((q) => q !== p)) {
        const fremd = eigene.get(q)!;
        const pfad = `${T()}/${fremd.id}`;
        expect(
          (await anfrage(konten[p], "PATCH", pfad, { text: "Übernommen" }))
            .status,
        ).toBe(404);
        expect((await anfrage(konten[p], "DELETE", pfad)).status).toBe(404);
      }
      const zeilen = await db.select().from(schema.todoPrivat);
      for (const q of ARBEITER) {
        expect(zeilen.find((z) => z.id === eigene.get(q)!.id)).toMatchObject({
          text: `Geändert von ${q}`,
          personId: konten[q].id,
        });
      }
    },
  );

  test("kein Sync-Kern: weder Folgenummer noch Feed-Eintrag", async () => {
    const vorher = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    const neu = await anfrage(konten.lagerleitung, "POST", T(), {
      text: "Ohne Feed",
    });
    expect(neu.status).toBe(201);
    await anfrage(konten.lagerleitung, "PATCH", `${T()}/${neu.body.id}`, {
      erledigt: true,
    });
    await anfrage(konten.lagerleitung, "DELETE", `${T()}/${neu.body.id}`);
    const nachher = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    expect(nachher[0]!.seq).toBe(vorher[0]!.seq);
    const feed = await anfrage(
      konten.lagerleitung,
      "GET",
      `/api/v1/lager/${lagerId}/aenderungen`,
    );
    expect(feed.status).toBe(200);
    expect(JSON.stringify(feed.body)).not.toContain("todo");
  });

  test("Nicht-Mitglied und fremde Abteilung bekommen 404, ohne Anmeldung 401", async () => {
    for (const p of ["ohneMitgliedschaft", "fremdeAbteilung"] as const) {
      expect((await anfrage(konten[p], "GET", T())).status).toBe(404);
      expect(
        (await anfrage(konten[p], "POST", T(), { text: "x" })).status,
      ).toBe(404);
    }
    expect((await anfrage(konten.ohneLogin, "GET", T())).status).toBe(401);
  });
});

describe("Eingabe, Reihenfolge und Grenzen", () => {
  test("strikte Eingabe: unbekannte Felder, leerer und zu langer Text, leere Änderung", async () => {
    const t = konten.team;
    for (const body of [
      { text: "a", personId: randomUUID() },
      { text: "" },
      { text: "   " },
      { text: "x".repeat(501) },
      { text: "a", reihenfolge: -1 },
      {},
    ]) {
      expect((await anfrage(t, "POST", T(), body)).status, `${body}`).toBe(400);
    }
    const neu = await anfrage(t, "POST", T(), { text: "Prüfen" });
    for (const body of [{}, { text: "" }, { lagerId: randomUUID() }]) {
      expect(
        (await anfrage(t, "PATCH", `${T()}/${neu.body.id}`, body)).status,
      ).toBe(400);
    }
  });

  test("ohne Angabe ans Ende, mit Angabe an die genannte Stelle", async () => {
    const id = await neuesLager();
    const a = await anfrage(konten.lesen, "POST", T(id), { text: "A" });
    const b = await anfrage(konten.lesen, "POST", T(id), { text: "B" });
    const c = await anfrage(konten.lesen, "POST", T(id), {
      text: "C",
      reihenfolge: 0,
    });
    expect([
      a.body.reihenfolge,
      b.body.reihenfolge,
      c.body.reihenfolge,
    ]).toEqual([0, 1, 0]);
    // Gleiche Stelle: die ID (zeitlich geordnet) entscheidet
    expect((await liste("lesen", id)).map((t) => t.text)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  test("höchstens 200 To-dos je Person und Lager (409 LIMIT_ERREICHT), eine Liste ohne Seitenwechsel", async () => {
    const id = await neuesLager();
    await db.insert(schema.todoPrivat).values(
      Array.from({ length: 200 }, (_, i) => ({
        lagerId: id,
        personId: konten.team.id!,
        text: `To-do ${i}`,
        reihenfolge: i,
      })),
    );
    const zuViel = await anfrage(konten.team, "POST", T(id), { text: "201" });
    expect(zuViel.status).toBe(409);
    expect(zuViel.body.code).toBe("LIMIT_ERREICHT");
    expect(await liste("team", id)).toHaveLength(200);
    // Die Obergrenze gilt je Person
    expect(
      (await anfrage(konten.lesen, "POST", T(id), { text: "Mein erstes" }))
        .status,
    ).toBe(201);
  });

  test("die Liste braucht gleich viele Abfragen bei einem und bei vielen To-dos", async () => {
    const id = await neuesLager();
    const gezaehlt = async () => {
      abfragen = 0;
      expect((await anfrage(konten.leitung, "GET", T(id))).status).toBe(200);
      return abfragen;
    };
    await anfrage(konten.leitung, "POST", T(id), { text: "Eins" });
    const wenig = await gezaehlt();
    await db.insert(schema.todoPrivat).values(
      Array.from({ length: 60 }, (_, i) => ({
        lagerId: id,
        personId: konten.leitung.id!,
        text: `Viele ${i}`,
        reihenfolge: i + 1,
      })),
    );
    expect(await gezaehlt()).toBe(wenig);
  });
});

describe("Abgeschlossenes Lager", () => {
  test("lesen geht, schreiben ist gesperrt (409), die Liste bleibt unverändert", async () => {
    await db.insert(schema.todoPrivat).values({
      lagerId: geschlossenId,
      personId: konten.lesen.id!,
      text: "Aus der Zeit davor",
    });
    expect((await liste("lesen", geschlossenId)).map((t) => t.text)).toEqual([
      "Aus der Zeit davor",
    ]);
    const [zeile] = await db
      .select()
      .from(schema.todoPrivat)
      .where(eq(schema.todoPrivat.lagerId, geschlossenId));
    const pfad = `${T(geschlossenId)}/${zeile!.id}`;
    for (const [methode, url, body] of [
      ["POST", T(geschlossenId), { text: "Neu" }],
      ["PATCH", pfad, { erledigt: true }],
      ["DELETE", pfad, undefined],
    ] as const) {
      const a = await anfrage(konten.lesen, methode, url, body);
      expect(a.status, methode).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
    expect(await liste("lesen", geschlossenId)).toHaveLength(1);
  });
});

describe("Löschen", () => {
  test("das eigene To-do ist endgültig weg; wiederholt: 404", async () => {
    const neu = await anfrage(konten.team, "POST", T(), { text: "Weg damit" });
    const pfad = `${T()}/${neu.body.id}`;
    expect((await anfrage(konten.team, "DELETE", pfad)).status).toBe(204);
    expect((await anfrage(konten.team, "DELETE", pfad)).status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.todoPrivat)
        .where(eq(schema.todoPrivat.id, neu.body.id)),
    ).toHaveLength(0);
  });

  test("das Lager nimmt die To-dos mit (CASCADE)", async () => {
    const id = await neuesLager();
    await anfrage(konten.team, "POST", T(id), { text: "Geht mit" });
    await db.delete(schema.lager).where(eq(schema.lager.id, id));
    expect(
      await db
        .select()
        .from(schema.todoPrivat)
        .where(eq(schema.todoPrivat.lagerId, id)),
    ).toHaveLength(0);
  });
});
