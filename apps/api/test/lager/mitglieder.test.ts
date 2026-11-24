import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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

// Zählt jede Abfrage der API (für den Test «Abfragen unabhängig von der Zahl der Mitglieder»)
let abfragen = 0;
const sql = postgres(API_URL, { debug: () => void abfragen++ });
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
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

// Ein frisches Lager mit den vier Lager-Rollen
async function neuesLager(status: "aktiv" | "abgeschlossen" = "aktiv") {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Mitgliederlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
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
});

type Mitglied = {
  personId: string;
  name: string;
  rolle: string;
  ressorts: string[];
};
async function liste(persona: LagerPersona, lagerId: string) {
  const res = await app.request(`/api/v1/lager/${lagerId}/mitglieder`, {
    headers: konten[persona].headers,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    mitglieder: (res.status === 200
      ? JSON.parse(text).mitglieder
      : []) as Mitglied[],
  };
}

describe("GET /api/v1/lager/{id}/mitglieder", () => {
  test("Rechte je Lager-Persona", async () => {
    const id = await neuesLager();
    const erwartet: Record<LagerPersona, number> = {
      abteilungsleitung: 200,
      lagerleitung: 200,
      leitung: 200,
      team: 200,
      lesen: 200,
      ohneMitgliedschaft: 404,
      fremdeAbteilung: 404,
      ohneLogin: 401,
    };
    for (const p of LAGER_PERSONAS) {
      expect([p, (await liste(p, id)).status]).toEqual([p, erwartet[p]]);
    }
    // Ohne einteilung.lesen ist die Liste verboten
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "lesen",
      recht: "einteilung.lesen",
      erlaubt: false,
    });
    expect((await liste("lesen", id)).status).toBe(403);
  });

  test("die Leitung sieht alle Mitglieder mit Rolle und Anzeigenamen, nie Kontaktdaten", async () => {
    const id = await neuesLager();
    const antwort = await liste("leitung", id);
    expect(antwort.mitglieder.map((m) => m.personId).sort()).toEqual(
      [
        konten.lagerleitung.id,
        konten.leitung.id,
        konten.team.id,
        konten.lesen.id,
      ].sort(),
    );
    const rollen = Object.fromEntries(
      antwort.mitglieder.map((m) => [m.personId, m.rolle]),
    );
    expect(rollen[konten.team.id!]).toBe("team");
    expect(rollen[konten.lagerleitung.id!]).toBe("lagerleitung");
    for (const m of antwort.mitglieder) {
      expect(Object.keys(m).sort()).toEqual([
        "bildUrl",
        "name",
        "personId",
        "ressorts",
        "rolle",
      ]);
      expect(m.name.length).toBeGreaterThan(0);
    }
    expect(antwort.text).not.toMatch(
      /mail|telefon|phone|passw|hash|username|abteilung/i,
    );
    // Sortiert nach Name
    const namen = antwort.mitglieder.map((m) => m.name);
    expect(namen).toEqual([...namen].sort((a, b) => a.localeCompare(b, "de")));
  });

  test("der Cevi-Name eines Kontos ist der Anzeigename", async () => {
    const id = await neuesLager();
    await db
      .update(schema.user)
      .set({ ceviName: "Pfeil" })
      .where(eq(schema.user.id, konten.leitung.id!));
    const m = (await liste("lesen", id)).mitglieder.find(
      (x) => x.personId === konten.leitung.id,
    );
    expect(m?.name).toBe("Pfeil");
  });

  test("Ressort-Kürzel: Zuordnung, Leitung und Stellvertretung", async () => {
    const id = await neuesLager();
    const [a] = await db
      .insert(schema.ressort)
      .values({
        lagerId: id,
        kuerzel: "KÜ",
        name: "Küche",
        leitungPersonId: konten.leitung.id!,
        lagerSeq: 0,
      })
      .returning({ id: schema.ressort.id });
    const [b] = await db
      .insert(schema.ressort)
      .values({
        lagerId: id,
        kuerzel: "AB",
        name: "Abenteuer",
        stvPersonId: konten.leitung.id!,
        lagerSeq: 0,
      })
      .returning({ id: schema.ressort.id });
    await db
      .update(schema.lagerMitglied)
      .set({ ressortId: b!.id })
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, id),
          eq(schema.lagerMitglied.personId, konten.lesen.id!),
        ),
      );
    expect(a).toBeDefined();
    const alle = (await liste("lagerleitung", id)).mitglieder;
    const von = (p: PersonaKonto) =>
      alle.find((m) => m.personId === p.id)!.ressorts;
    expect(von(konten.leitung)).toEqual(["AB", "KÜ"]);
    expect(von(konten.lesen)).toEqual(["AB"]);
    expect(von(konten.team)).toEqual([]);
  });

  test("ein deaktiviertes Konto fehlt, ein Konto der Zeile ohne Abteilung gibt nichts frei", async () => {
    const id = await neuesLager();
    const [p] = await db
      .insert(schema.user)
      .values({
        name: "Weg Person",
        email: `${randomUUID()}@example.org`,
        abteilungId: welt.testabteilungId,
        deaktiviertAm: new Date(),
      })
      .returning({ id: schema.user.id });
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: id, personId: p!.id, rolle: "team" });
    const ids = (await liste("lagerleitung", id)).mitglieder.map(
      (m) => m.personId,
    );
    expect(ids).not.toContain(p!.id);
  });

  test("das Team sieht nur sich und wen es schon aus Zimmern, Gruppen oder dem Schichtplan kennt", async () => {
    const id = await neuesLager();
    const ids = async () =>
      (await liste("team", id)).mitglieder.map((m) => m.personId).sort();
    expect(await ids()).toEqual([konten.team.id]);
    // Dieselbe Gruppe
    const [g] = await db
      .insert(schema.gruppe)
      .values({ lagerId: id, name: "G", lagerSeq: 0 })
      .returning({ id: schema.gruppe.id });
    await db.insert(schema.gruppeZuordnung).values({
      lagerId: id,
      gruppeId: g!.id,
      personId: konten.lesen.id!,
      lagerSeq: 0,
    });
    expect(await ids()).toEqual([konten.team.id, konten.lesen.id].sort());
    // Dasselbe Zimmer
    const [z] = await db
      .insert(schema.zimmer)
      .values({
        lagerId: id,
        name: "Zelt 1",
        art: "zelt",
        plaetze: 4,
        lagerSeq: 0,
      })
      .returning({ id: schema.zimmer.id });
    for (const p of [konten.team, konten.leitung]) {
      await db.insert(schema.zimmerZuordnung).values({
        lagerId: id,
        zimmerId: z!.id,
        personId: p.id!,
        lagerSeq: 0,
      });
    }
    expect(await ids()).toEqual(
      [konten.team.id, konten.lesen.id, konten.leitung.id].sort(),
    );
    // Wer in einem anderen Zimmer liegt, bleibt unsichtbar
    const [z2] = await db
      .insert(schema.zimmer)
      .values({
        lagerId: id,
        name: "Zelt 2",
        art: "zelt",
        plaetze: 4,
        lagerSeq: 0,
      })
      .returning({ id: schema.zimmer.id });
    await db.insert(schema.zimmerZuordnung).values({
      lagerId: id,
      zimmerId: z2!.id,
      personId: konten.lagerleitung.id!,
      lagerSeq: 0,
    });
    expect(await ids()).not.toContain(konten.lagerleitung.id);
    // Die Lesenden sehen dagegen alle
    expect((await liste("lesen", id)).mitglieder).toHaveLength(4);
  });

  test("die Zahl der Abfragen hängt nicht von der Zahl der Mitglieder ab", async () => {
    const id = await neuesLager();
    const zaehle = async () => {
      await liste("leitung", id);
      const vorher = abfragen;
      const a = await liste("leitung", id);
      expect(a.status).toBe(200);
      return { n: abfragen - vorher, mitglieder: a.mitglieder.length };
    };
    const klein = await zaehle();
    for (let i = 0; i < 8; i++) {
      const [p] = await db
        .insert(schema.user)
        .values({
          name: `Zusatz Person ${i}`,
          email: `${randomUUID()}@example.org`,
          abteilungId: welt.testabteilungId,
        })
        .returning({ id: schema.user.id });
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId: id, personId: p!.id, rolle: "team" });
    }
    const gross = await zaehle();
    expect(gross.mitglieder).toBe(klein.mitglieder + 8);
    expect(gross.n).toBe(klein.n);
  });
});
