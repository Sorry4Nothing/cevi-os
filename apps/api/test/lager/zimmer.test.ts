import { and, eq } from "drizzle-orm";
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
import {
  anzeigeNamenLager,
  berechneAnzeigenamen,
  type Anzeigeperson,
} from "../../src/lager/zimmer.js";
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

const sql = postgres(API_URL);
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
let geschlossenId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Zimmerlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}

async function mitgliederEintragen(id: string) {
  // Die falsche Zeile der fremden Abteilung gibt nichts frei
  await db.insert(schema.lagerMitglied).values({
    lagerId: id,
    personId: konten.fremdeAbteilung.id!,
    rolle: "lagerleitung",
  });
  for (const [persona, rolle] of [
    ["lagerleitung", "lagerleitung"],
    ["leitung", "leitung"],
    ["team", "team"],
    ["lesen", "lesen"],
  ] as const) {
    await db.insert(schema.lagerMitglied).values({
      lagerId: id,
      personId: konten[persona].id!,
      rolle,
    });
  }
}

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  await mitgliederEintragen(geschlossenId);
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

const L = (id: string) => `/api/v1/lager/${id}`;
const leiter = () => konten.lagerleitung;
// Jeder Test arbeitet in einem frischen Lager, damit Listen und Zähler nicht von anderen Tests abhängen
async function frischesLager() {
  const id = await legeLager(welt.testabteilungId);
  await mitgliederEintragen(id);
  return id;
}
async function neuesZimmer(
  lagerId: string,
  werte: Record<string, unknown> = {},
  konto = leiter(),
) {
  const a = await anfrage(konto, "POST", `${L(lagerId)}/zimmer`, {
    name: "Zimmer 1",
    art: "zimmer",
    plaetze: 4,
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as { id: string; version: number };
}
async function neuerTeilnehmer(
  lagerId: string,
  vorname: string,
  nachname = "Muster",
  ceviName: string | null = null,
) {
  const [z] = await db
    .insert(schema.teilnehmer)
    .values({ lagerId, vorname, nachname, ceviName, lagerSeq: 0 })
    .returning({ id: schema.teilnehmer.id });
  return z!.id;
}
const einteilen = (
  lagerId: string,
  zimmerId: string,
  ziele: { teilnehmerIds?: string[]; personIds?: string[] },
  konto = leiter(),
) =>
  anfrage(konto, "POST", `${L(lagerId)}/zimmer/${zimmerId}/zuordnung`, ziele);
const entfernen = (
  lagerId: string,
  zimmerId: string,
  ziele: { teilnehmerIds?: string[]; personIds?: string[] },
) =>
  anfrage(
    leiter(),
    "POST",
    `${L(lagerId)}/zimmer/${zimmerId}/zuordnung/entfernen`,
    ziele,
  );
const liste = (lagerId: string, konto = leiter()) =>
  anfrage(konto, "GET", `${L(lagerId)}/zimmer`);

describe("Zimmer anlegen, ändern, löschen", () => {
  test("anlegen, lesen, ändern mit Version, löschen", async () => {
    const id = await frischesLager();
    const z = await neuesZimmer(id, {
      name: "  Zelt   3 ",
      art: "zelt",
      plaetze: 6,
      notiz: "am Waldrand",
    });
    expect(z).toMatchObject({
      name: "Zelt 3",
      art: "zelt",
      plaetze: 6,
      notiz: "am Waldrand",
      version: 1,
      reihenfolge: 0,
    });
    const l = await liste(id);
    expect(l.status).toBe(200);
    expect(l.body.zimmer).toEqual([
      expect.objectContaining({
        id: z.id,
        belegt: 0,
        ueberbelegt: false,
        mitglieder: [],
      }),
    ]);
    expect(l.body.offen).toEqual({ teilnehmer: 0, team: 4 });

    const p = await anfrage(leiter(), "PATCH", `${L(id)}/zimmer/${z.id}`, {
      version: 1,
      plaetze: 8,
      notiz: null,
    });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ plaetze: 8, notiz: null, version: 2 });
    // Veraltete Version: 409 mit dem aktuellen Stand
    const alt = await anfrage(leiter(), "PATCH", `${L(id)}/zimmer/${z.id}`, {
      version: 1,
      name: "Anders",
    });
    expect(alt.status).toBe(409);
    expect(alt.body).toMatchObject({
      code: "VERSION_KONFLIKT",
      aktuell: { version: 2, plaetze: 8 },
      abweichend: ["name"],
    });

    expect(
      (await anfrage(leiter(), "DELETE", `${L(id)}/zimmer/${z.id}?version=1`))
        .status,
    ).toBe(409);
    expect(
      (await anfrage(leiter(), "DELETE", `${L(id)}/zimmer/${z.id}?version=2`))
        .status,
    ).toBe(204);
    expect((await liste(id)).body.zimmer).toEqual([]);
    // Endgültig: Die Zeile ist weg
    expect(await db.$count(schema.zimmer, eq(schema.zimmer.id, z.id))).toBe(0);
  });

  test("ungültige Eingaben: 400", async () => {
    const id = await frischesLager();
    const post = (body: Record<string, unknown>) =>
      anfrage(leiter(), "POST", `${L(id)}/zimmer`, body);
    for (const body of [
      {},
      { name: "", art: "zimmer", plaetze: 2 },
      { name: "A", art: "huette", plaetze: 2 },
      { name: "A", art: "zimmer", plaetze: 0 },
      { name: "A", art: "zimmer", plaetze: 1001 },
      { name: "A", art: "zimmer", plaetze: 1.5 },
      { name: "x".repeat(101), art: "zimmer", plaetze: 2 },
      { name: "A", art: "zimmer", plaetze: 2, notiz: "" },
      { name: "A", art: "zimmer", plaetze: 2, notiz: "x".repeat(501) },
      { name: "A\u0007", art: "zimmer", plaetze: 2 },
      // Unbekanntes Feld
      { name: "A", art: "zimmer", plaetze: 2, lagerId: "x" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    const z = await neuesZimmer(id);
    // Nur die Version ist keine Änderung
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(id)}/zimmer/${z.id}`, {
          version: 1,
        })
      ).status,
    ).toBe(400);
    // Keine ID
    expect(
      (await anfrage(leiter(), "PATCH", `${L(id)}/zimmer/keine-id`, {})).status,
    ).toBe(400);
  });

  test("ein Zimmer eines anderen Lagers ist 404", async () => {
    const a = await frischesLager();
    const b = await frischesLager();
    const z = await neuesZimmer(a);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L(b)}/zimmer/${z.id}`, {
          version: 1,
          plaetze: 2,
        })
      ).status,
    ).toBe(404);
    expect(
      (await einteilen(b, z.id, { personIds: [konten.team.id!] })).status,
    ).toBe(404);
  });

  test("im abgeschlossenen Lager liest man, schreibt aber nicht", async () => {
    const [z] = await db
      .insert(schema.zimmer)
      .values({
        lagerId: geschlossenId,
        name: "Alt",
        art: "zimmer",
        plaetze: 2,
        lagerSeq: 0,
      })
      .returning();
    expect((await liste(geschlossenId)).status).toBe(200);
    for (const [methode, pfad, body] of [
      [
        "POST",
        `${L(geschlossenId)}/zimmer`,
        { name: "N", art: "zelt", plaetze: 2 },
      ],
      [
        "PATCH",
        `${L(geschlossenId)}/zimmer/${z!.id}`,
        { version: 1, plaetze: 3 },
      ],
      ["DELETE", `${L(geschlossenId)}/zimmer/${z!.id}?version=1`, undefined],
    ] as const) {
      const a = await anfrage(leiter(), methode, pfad, body);
      expect(a.status).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
  });
});

describe("Einteilen, Belegung und Überbelegung", () => {
  test("mehrere Personen in einer Anfrage; Überbelegung ist nur eine Warnung", async () => {
    const id = await frischesLager();
    const z = await neuesZimmer(id, { plaetze: 2 });
    const kinder = await Promise.all(
      ["Anna", "Ben", "Cleo"].map((v) => neuerTeilnehmer(id, v)),
    );
    // Zwei Teilnehmende und ein Mitglied: 3 > 2 Plätze, trotzdem 200
    const a = await einteilen(id, z.id, {
      teilnehmerIds: kinder.slice(0, 2),
      personIds: [konten.team.id!],
    });
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      eingeteilt: 3,
      belegt: 3,
      plaetze: 2,
      ueberbelegt: true,
    });
    const l = await liste(id);
    expect(l.body.zimmer[0]).toMatchObject({
      belegt: 3,
      plaetze: 2,
      ueberbelegt: true,
    });
    expect(l.body.zimmer[0].mitglieder).toHaveLength(3);
    // Wer schon im Zimmer liegt, wird nicht doppelt gezählt (wiederholbar)
    const nochmal = await einteilen(id, z.id, {
      teilnehmerIds: kinder,
    });
    expect(nochmal.body).toMatchObject({ eingeteilt: 1, belegt: 4 });
    // Entfernen senkt die Belegung; wer nicht drin liegt, wird übergangen
    const weg = await entfernen(id, z.id, {
      teilnehmerIds: [kinder[0]!, kinder[0]!].slice(0, 1),
      personIds: [konten.lesen.id!],
    });
    expect(weg.body).toEqual({
      entfernt: 1,
      belegt: 3,
      plaetze: 2,
      ueberbelegt: true,
    });
    expect((await entfernen(id, z.id, { teilnehmerIds: kinder })).body).toEqual(
      { entfernt: 2, belegt: 1, plaetze: 2, ueberbelegt: false },
    );
  });

  test("die Auswahl enthält nur Nichteingeteilte, die Zähler stimmen", async () => {
    const id = await frischesLager();
    const z = await neuesZimmer(id);
    const [a, b, c] = await Promise.all(
      ["Anna", "Ben", "Cleo"].map((v) => neuerTeilnehmer(id, v)),
    );
    await einteilen(id, z.id, {
      teilnehmerIds: [a!],
      personIds: [konten.team.id!],
    });
    const offen = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/zimmer/offen?art=teilnehmer`,
    );
    expect(offen.status).toBe(200);
    expect(
      offen.body.eintraege.map((e: { id: string }) => e.id).sort(),
    ).toEqual([b, c].sort());
    expect(offen.body.eintraege[0]).toHaveProperty("ceviName");
    const team = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/zimmer/offen?art=team`,
    );
    const ids = team.body.eintraege.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(konten.team.id);
    expect(ids).toContain(konten.leitung.id);
    expect((await liste(id)).body.offen).toEqual({ teilnehmer: 2, team: 3 });
    // Seitenwechsel
    const s1 = await anfrage(leiter(), "GET", `${L(id)}/zimmer/offen?limit=1`);
    expect(s1.body.eintraege).toHaveLength(1);
    expect(s1.body.naechster).toBe(s1.body.eintraege[0].id);
    const s2 = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/zimmer/offen?limit=1&nach=${s1.body.naechster}`,
    );
    expect(s2.body.eintraege[0].id).not.toBe(s1.body.eintraege[0].id);
    expect(s2.body.naechster).toBeNull();
    // Ein gelöschter Teilnehmender fällt aus Auswahl und Belegung
    await db.delete(schema.teilnehmer).where(eq(schema.teilnehmer.id, a!));
    expect((await liste(id)).body.zimmer[0].belegt).toBe(1);
  });

  test("jede Person liegt nur in einem Zimmer: 409 SCHON_EINGETEILT, nichts wird geschrieben", async () => {
    const id = await frischesLager();
    const eins = await neuesZimmer(id, { name: "Eins" });
    const zwei = await neuesZimmer(id, { name: "Zwei" });
    const [a, b] = await Promise.all(
      ["Anna", "Ben"].map((v) => neuerTeilnehmer(id, v)),
    );
    await einteilen(id, eins.id, {
      teilnehmerIds: [a!],
      personIds: [konten.team.id!],
    });
    const k = await einteilen(id, zwei.id, {
      teilnehmerIds: [a!, b!],
      personIds: [konten.team.id!],
    });
    expect(k.status).toBe(409);
    expect(k.body).toMatchObject({
      code: "SCHON_EINGETEILT",
      teilnehmerIds: [a],
      personIds: [konten.team.id],
    });
    // Auch Ben, der frei war, ist nicht eingeteilt
    const zeilen = await db
      .select()
      .from(schema.zimmerZuordnung)
      .where(eq(schema.zimmerZuordnung.lagerId, id));
    expect(zeilen).toHaveLength(2);
    // Erst entfernen, dann einteilen
    await entfernen(id, eins.id, { teilnehmerIds: [a!] });
    expect((await einteilen(id, zwei.id, { teilnehmerIds: [a!] })).status).toBe(
      200,
    );
  });

  test("die Datenbank hält die Einmaligkeit auch ohne die Route", async () => {
    const id = await frischesLager();
    const eins = await neuesZimmer(id, { name: "Eins" });
    const zwei = await neuesZimmer(id, { name: "Zwei" });
    const a = await neuerTeilnehmer(id, "Anna");
    const einfuegen = (zimmerId: string, werte: object) =>
      db.insert(schema.zimmerZuordnung).values({
        lagerId: id,
        zimmerId,
        lagerSeq: 0,
        ...werte,
      });
    await einfuegen(eins.id, { teilnehmerId: a });
    await expect(einfuegen(zwei.id, { teilnehmerId: a })).rejects.toThrow();
    await einfuegen(eins.id, { personId: konten.team.id });
    await expect(
      einfuegen(zwei.id, { personId: konten.team.id }),
    ).rejects.toThrow();
    // Genau eines von beiden
    await expect(einfuegen(zwei.id, {})).rejects.toThrow();
    await expect(
      einfuegen(zwei.id, { teilnehmerId: a, personId: konten.lesen.id }),
    ).rejects.toThrow();
  });

  test("zwei gleichzeitige Anfragen für dieselbe Person: genau eine gewinnt", async () => {
    const id = await frischesLager();
    const eins = await neuesZimmer(id, { name: "Eins" });
    const zwei = await neuesZimmer(id, { name: "Zwei" });
    const a = await neuerTeilnehmer(id, "Anna");
    const antworten = await Promise.all([
      einteilen(id, eins.id, { teilnehmerIds: [a] }),
      einteilen(id, zwei.id, { teilnehmerIds: [a] }),
    ]);
    expect(antworten.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(
      await db
        .select()
        .from(schema.zimmerZuordnung)
        .where(and(eq(schema.zimmerZuordnung.teilnehmerId, a))),
    ).toHaveLength(1);
  });

  test("fremde Ziele sind 404 und schreiben nichts", async () => {
    const id = await frischesLager();
    const anderes = await frischesLager();
    const z = await neuesZimmer(id);
    const fremderKind = await neuerTeilnehmer(anderes, "Fremd");
    const eigener = await neuerTeilnehmer(id, "Eigen");
    for (const ziele of [
      { teilnehmerIds: [eigener, fremderKind] },
      { teilnehmerIds: ["00000000-0000-4000-8000-000000000000"] },
      // Keine Mitglieder dieses Lagers
      { personIds: [konten.ohneMitgliedschaft.id!] },
      // Mitgliedszeile eines Kontos einer fremden Abteilung
      { personIds: [konten.fremdeAbteilung.id!] },
    ]) {
      expect((await einteilen(id, z.id, ziele)).status).toBe(404);
    }
    expect(
      await db
        .select()
        .from(schema.zimmerZuordnung)
        .where(eq(schema.zimmerZuordnung.lagerId, id)),
    ).toHaveLength(0);
    // Ein gelöschter Teilnehmender zählt als unbekannt
    await db.delete(schema.teilnehmer).where(eq(schema.teilnehmer.id, eigener));
    expect(
      (await einteilen(id, z.id, { teilnehmerIds: [eigener] })).status,
    ).toBe(404);
  });

  test("Eingaben der Sammeloperation: leer, doppelt, zu viele, fremde Felder", async () => {
    const id = await frischesLager();
    const z = await neuesZimmer(id);
    const a = await neuerTeilnehmer(id, "Anna");
    for (const body of [
      {},
      { teilnehmerIds: [] },
      { teilnehmerIds: [a, a] },
      { teilnehmerIds: ["keine-id"] },
      { personIds: Array.from({ length: 201 }, () => crypto.randomUUID()) },
      { teilnehmerIds: [a], zimmerId: z.id },
    ]) {
      expect((await einteilen(id, z.id, body)).status).toBe(400);
      expect((await entfernen(id, z.id, body)).status).toBe(400);
    }
  });

  test("ein Zimmer löschen gibt seine Personen frei", async () => {
    const id = await frischesLager();
    const eins = await neuesZimmer(id, { name: "Eins" });
    const zwei = await neuesZimmer(id, { name: "Zwei" });
    const a = await neuerTeilnehmer(id, "Anna");
    await einteilen(id, eins.id, {
      teilnehmerIds: [a],
      personIds: [konten.team.id!],
    });
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L(id)}/zimmer/${eins.id}?version=1`,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await einteilen(id, zwei.id, {
          teilnehmerIds: [a],
          personIds: [konten.team.id!],
        })
      ).body,
    ).toMatchObject({ eingeteilt: 2, belegt: 2 });
    // Ins gelöschte Zimmer einzuteilen ist 404
    expect((await einteilen(id, eins.id, { teilnehmerIds: [a] })).status).toBe(
      404,
    );
  });

  test("der Änderungsfeed meldet Zimmer und Zuordnungen, auch gelöschte", async () => {
    const id = await frischesLager();
    const z = await neuesZimmer(id);
    const a = await neuerTeilnehmer(id, "Anna");
    await einteilen(id, z.id, { teilnehmerIds: [a] });
    await entfernen(id, z.id, { teilnehmerIds: [a] });
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L(id)}/aenderungen?seit=0&limit=500`,
    );
    expect(feed.status).toBe(200);
    const eintraege = feed.body.eintraege as {
      objekttyp: string;
      art: string;
    }[];
    expect(eintraege.map((e) => `${e.objekttyp}:${e.art}`)).toEqual([
      "zimmer:neu",
      "zimmer_zuordnung:neu",
      "zimmer_zuordnung:geloescht",
    ]);
  });
});

describe("Sicht je Rolle", () => {
  async function aufbauen() {
    const id = await frischesLager();
    const eins = await neuesZimmer(id, {
      name: "Eins",
      plaetze: 3,
      notiz: "geheim",
    });
    const zwei = await neuesZimmer(id, { name: "Zwei" });
    const [anna, ben, cleo] = await Promise.all(
      [
        ["Anna", "Muster", "Fuchs"],
        ["Ben", "Beispiel", null],
        ["Cleo", "Test", null],
      ].map(([v, n, c]) => neuerTeilnehmer(id, v!, n!, c)),
    );
    await einteilen(id, eins.id, {
      teilnehmerIds: [anna!, ben!],
      personIds: [konten.team.id!],
    });
    await einteilen(id, zwei.id, {
      teilnehmerIds: [cleo!],
      personIds: [konten.leitung.id!],
    });
    return { id, eins, zwei, anna: anna!, ben: ben!, cleo: cleo! };
  }

  test("das Team sieht nur das eigene Zimmer und die Namen der Mitbewohner", async () => {
    const { id, eins } = await aufbauen();
    const a = await liste(id, konten.team);
    expect(a.status).toBe(200);
    expect(a.body.offen).toBeUndefined();
    expect(a.body.zimmer).toHaveLength(1);
    const z = a.body.zimmer[0];
    expect(z).toEqual({
      id: eins.id,
      version: 1,
      name: "Eins",
      art: "zimmer",
      mitglieder: expect.any(Array),
    });
    // Nur Namen: keine IDs, Plätze, Notiz, Belegung; der Cevi-Name der Teilnehmenden gehört zu teilnehmer.bearbeiten (#384), das Team sieht den Vornamen
    expect(
      z.mitglieder.every(
        (m: object) => Object.keys(m).join() === "name,bildUrl",
      ),
    ).toBe(true);
    expect(z.mitglieder.map((m: { name: string }) => m.name)).toEqual(
      expect.arrayContaining(["Anna", "Ben"]),
    );
    expect(JSON.stringify(a.body)).not.toContain("Fuchs");
    expect(JSON.stringify(a.body)).not.toContain("Muster");
    expect(JSON.stringify(a.body)).not.toContain("geheim");
    // Das Team ändert nichts und sieht die Auswahl nicht
    for (const [methode, pfad, body] of [
      ["POST", `${L(id)}/zimmer`, { name: "N", art: "zelt", plaetze: 2 }],
      ["PATCH", `${L(id)}/zimmer/${eins.id}`, { version: 1, plaetze: 9 }],
      ["DELETE", `${L(id)}/zimmer/${eins.id}?version=1`, undefined],
      ["POST", `${L(id)}/zimmer/${eins.id}/zuordnung`, { teilnehmerIds: [] }],
      ["GET", `${L(id)}/zimmer/offen`, undefined],
    ] as const) {
      expect((await anfrage(konten.team, methode, pfad, body)).status).toBe(
        403,
      );
    }
  });

  test("der Cevi-Name der Teilnehmenden erscheint nur mit teilnehmer.bearbeiten, in der Liste und in der Auswahl", async () => {
    const { id } = await aufbauen();
    const mit = ["lagerleitung", "abteilungsleitung"] as const;
    const ohne = ["leitung", "team", "lesen"] as const;
    for (const p of mit) {
      const a = await liste(id, konten[p]);
      expect(JSON.stringify(a.body), p).toContain("Fuchs");
    }
    for (const p of ohne) {
      const a = await liste(id, konten[p]);
      expect(a.status, p).toBe(200);
      expect(JSON.stringify(a.body), p).not.toContain("Fuchs");
    }
    for (const p of [...mit, "leitung"] as const) {
      const offen = await anfrage(
        konten[p],
        "GET",
        `${L(id)}/zimmer/offen?art=teilnehmer`,
      );
      expect(offen.status, p).toBe(200);
      expect(JSON.stringify(offen.body), p).not.toContain("Fuchs");
    }
    // Anna ist eingeteilt; mit einem offenen Kind mit Cevi-Namen prüfen
    await neuerTeilnehmer(id, "Dora", "Probe", "Igel");
    for (const p of [...mit, "leitung"] as const) {
      const offen = await anfrage(
        konten[p],
        "GET",
        `${L(id)}/zimmer/offen?art=teilnehmer`,
      );
      const eintrag = offen.body.eintraege.find(
        (e: { vorname: string }) => e.vorname === "Dora",
      );
      expect(eintrag, p).toBeDefined();
      expect("ceviName" in eintrag, p).toBe(mit.includes(p as never));
    }
  });

  test("das Team ohne Zimmer sieht eine leere Liste", async () => {
    const id = await frischesLager();
    await neuesZimmer(id);
    const a = await liste(id, konten.team);
    expect(a.body).toEqual({ zimmer: [] });
  });

  test("Lagerleitung, Abteilungsleitung, Leitung und Lesen sehen alles", async () => {
    const { id } = await aufbauen();
    for (const konto of [
      konten.lagerleitung,
      konten.abteilungsleitung,
      konten.leitung,
      konten.lesen,
    ]) {
      const a = await liste(id, konto);
      expect(a.status).toBe(200);
      expect(a.body.zimmer.map((z: { name: string }) => z.name)).toEqual([
        "Eins",
        "Zwei",
      ]);
      expect(a.body.zimmer[0]).toMatchObject({
        plaetze: 3,
        belegt: 3,
        ueberbelegt: false,
        notiz: "geheim",
      });
      expect(a.body.offen).toBeDefined();
    }
  });

  test("Leitung darf einteilen, Lesen nicht", async () => {
    const id = await frischesLager();
    const z = await neuesZimmer(id, {}, konten.leitung);
    const a = await neuerTeilnehmer(id, "Anna");
    expect(
      (await einteilen(id, z.id, { teilnehmerIds: [a] }, konten.leitung))
        .status,
    ).toBe(200);
    expect(
      (await einteilen(id, z.id, { teilnehmerIds: [a] }, konten.lesen)).status,
    ).toBe(403);
  });

  test("der Feed gibt dem Team nur das eigene Zimmer und dessen Zuordnungen frei", async () => {
    const { id, eins, zwei } = await aufbauen();
    const feed = (konto: PersonaKonto) =>
      anfrage(konto, "GET", `${L(id)}/aenderungen?seit=0&limit=500`);
    const team = await feed(konten.team);
    expect(team.status).toBe(200);
    const zimmerIds = team.body.eintraege
      .filter((e: { objekttyp: string }) => e.objekttyp === "zimmer")
      .map((e: { id: string }) => e.id);
    expect(zimmerIds).toEqual([eins.id]);
    // Drei Zuordnungen im Zimmer Eins, keine aus Zimmer Zwei
    const zuordnungen = team.body.eintraege.filter(
      (e: { objekttyp: string }) => e.objekttyp === "zimmer_zuordnung",
    );
    expect(zuordnungen).toHaveLength(3);
    const alle = await feed(konten.lagerleitung);
    expect(
      alle.body.eintraege.filter(
        (e: { objekttyp: string }) => e.objekttyp === "zimmer",
      ),
    ).toHaveLength(2);
    expect(zimmerIds).not.toContain(zwei.id);
  });
});

describe("Anzeigenamen", () => {
  const p = (
    id: string,
    vorname: string,
    nachname: string,
    ceviName: string | null = null,
  ): Anzeigeperson => ({ id, vorname, nachname, ceviName });
  const namen = (personen: Anzeigeperson[]) =>
    Object.fromEntries(berechneAnzeigenamen(personen));

  test("Cevi-Name, sonst Vorname", () => {
    expect(
      namen([p("1", "Anna", "Muster", "Fuchs"), p("2", "Ben", "Test")]),
    ).toEqual({ "1": "Fuchs", "2": "Ben" });
  });

  test("gleicher Cevi-Name: Vorname, ohne Beachtung der Gross- und Kleinschreibung", () => {
    expect(
      namen([
        p("1", "Anna", "Muster", "Fuchs"),
        p("2", "Berta", "Test", "fuchs"),
        p("3", "Cleo", "Test"),
      ]),
    ).toEqual({ "1": "Anna", "2": "Berta", "3": "Cleo" });
  });

  test("gleicher Vorname: Vorname und Anfangsbuchstabe des Nachnamens", () => {
    expect(
      namen([
        p("1", "Anna", "Muster"),
        p("2", "anna", "Test"),
        p("3", "Ben", "Muster"),
      ]),
    ).toEqual({ "1": "Anna M.", "2": "anna T.", "3": "Ben" });
  });

  test("Cevi-Name gleich dem Vornamen eines anderen: beide eskalieren", () => {
    // «Max» als Cevi-Name von Anna und als Vorname von Max: Stufe 2 trennt sie
    expect(
      namen([p("1", "Anna", "Muster", "Max"), p("2", "Max", "Test")]),
    ).toEqual({ "1": "Anna", "2": "Max" });
    // Der Vorname der Stufe 2 darf nie auf einen Namen der Stufe 1 treffen: Berta («Max») und Max (Vorname von Fuchs, Stufe 2) steigen beide, bis alle verschieden sind
    expect(
      namen([
        p("1", "Max", "Muster", "Fuchs"),
        p("2", "Fuchs", "Test"),
        p("3", "Berta", "Test", "Max"),
      ]),
    ).toEqual({ "1": "Max M.", "2": "Fuchs", "3": "Berta" });
  });

  test("zwei gleiche Vornamen mit gleichem Anfangsbuchstaben bleiben gleich; ohne Nachnamen kein Punkt", () => {
    expect(namen([p("1", "Anna", "Muster"), p("2", "Anna", "Meier")])).toEqual({
      "1": "Anna M.",
      "2": "Anna M.",
    });
    expect(namen([p("1", "Anna", ""), p("2", "Anna", "Test")])).toEqual({
      "1": "Anna",
      "2": "Anna T.",
    });
  });

  test("ein Umlaut als Anfangsbuchstabe", () => {
    expect(
      namen([p("1", "Anna", "Österreich"), p("2", "Anna", "Test")]),
    ).toEqual({ "1": "Anna Ö.", "2": "Anna T." });
  });

  test("anzeigeNamenLager: ein Aufruf für Teilnehmende und Mitglieder, ohne Gelöschte", async () => {
    const id = await frischesLager();
    const a = await neuerTeilnehmer(id, "Anna", "Muster", "Fuchs");
    const b = await neuerTeilnehmer(id, "Anna", "Test");
    const c = await neuerTeilnehmer(id, "Anna", "Beispiel");
    const weg = await neuerTeilnehmer(id, "Anna", "Gelöscht");
    await db.delete(schema.teilnehmer).where(eq(schema.teilnehmer.id, weg));
    const n = await anzeigeNamenLager(db, id);
    expect(n.get(a)).toBe("Fuchs");
    // Zwei Anna (b, c) ohne Cevi-Name: Anfangsbuchstabe; die gelöschte zählt nicht
    expect(n.get(b)).toBe("Anna T.");
    expect(n.get(c)).toBe("Anna B.");
    expect(n.has(weg)).toBe(false);
    // Mitglieder des Lagers sind dabei, die Mitgliedszeile eines fremden Kontos nicht
    expect(n.has(konten.team.id!)).toBe(true);
    expect(n.has(konten.fremdeAbteilung.id!)).toBe(false);
    expect(n.has(konten.ohneMitgliedschaft.id!)).toBe(false);
  });
});
