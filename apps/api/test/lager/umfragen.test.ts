import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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

// Zählt jede Abfrage der API (für den Test «Abfragen je Seite»)
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
let fremdLagerId: string;

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Umfragelager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}
// Ein frisches Lager mit den vier Lager-Rollen; die Mitgliedszeile der fremden Abteilung gibt nichts frei
async function neuesLager(status: "aktiv" | "abgeschlossen" = "aktiv") {
  const id = await legeLager(welt.testabteilungId, status);
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
  fremdLagerId = await legeLager(welt.demoAbteilungId);
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

const L = (id: string) => `/api/v1/lager/${id}`;
async function neuerBeitrag(
  lagerId: string,
  felder: Record<string, unknown> = {},
) {
  const a = await anfrage(
    konten.lagerleitung,
    "POST",
    `${L(lagerId)}/pinnwand`,
    {
      titel: "Welcher Ausflug?",
      ...felder,
    },
  );
  expect(a.status).toBe(201);
  return a.body;
}
const OPTIONEN = ["Schwimmen", "Wanderung", "Spiele"];
// Beitrag mit Umfrage; liefert die IDs
async function neueUmfrage(
  lagerId: string,
  felder: Record<string, unknown> = {},
  beitragFelder: Record<string, unknown> = {},
) {
  const beitrag = await neuerBeitrag(lagerId, beitragFelder);
  const u = await anfrage(
    konten.lagerleitung,
    "POST",
    `${L(lagerId)}/pinnwand/${beitrag.id}/umfrage`,
    { optionen: OPTIONEN, ...felder },
  );
  expect(u.status).toBe(201);
  return {
    beitragId: beitrag.id as string,
    umfrage: u.body,
    optionen: u.body.optionen.map((o: { id: string }) => o.id) as string[],
    pfad: `${L(lagerId)}/pinnwand/${beitrag.id}/umfrage`,
  };
}
const stimme = (p: LagerPersona, pfad: string, optionIds: string[]) =>
  anfrage(konten[p], "PUT", `${pfad}/stimme`, { optionIds });
async function liste(p: LagerPersona, lagerId: string) {
  const a = await anfrage(konten[p], "GET", `${L(lagerId)}/pinnwand`);
  expect(a.status).toBe(200);
  return a.body.beitraege as {
    id: string;
    version: number;
    umfrage: ReturnType<typeof Object> | null;
    reaktionen: { zaehler: Record<string, number>; eigene: string | null };
  }[];
}
// Die Umfrage des Beitrags, wie die Person sie in der Liste sieht
async function umfrageSicht(
  p: LagerPersona,
  lagerId: string,
  beitragId: string,
) {
  return (await liste(p, lagerId)).find((b) => b.id === beitragId)!
    .umfrage as unknown as {
    geschlossen: boolean;
    namenSichtbar: boolean;
    teilnehmende: number;
    optionen: {
      id: string;
      text: string;
      stimmen: number;
      eigene: boolean;
      personen: { id: string; name: string }[];
    }[];
  };
}
const stimmenZeilen = async (lagerId: string) =>
  db
    .select()
    .from(schema.umfrageStimme)
    .where(and(eq(schema.umfrageStimme.lagerId, lagerId)));

describe("Rechte je Lager-Persona", () => {
  let lagerId: string;
  let ziel: Awaited<ReturnType<typeof neueUmfrage>>;
  beforeAll(async () => {
    lagerId = await neuesLager();
    ziel = await neueUmfrage(lagerId);
  });

  // Anlegen: pinnwand.bearbeiten (Standard: Lagerleitung, Abteilungsleitung, Leitung)
  const anlegen: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 201,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  // Abstimmen und reagieren: interaktion.schreiben (Standard: Lagerleitung, Abteilungsleitung, Leitung, Team)
  const abstimmen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 200,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };

  test.each(LAGER_PERSONAS)("%s: Umfrage anlegen", async (p) => {
    const beitrag = await neuerBeitrag(lagerId);
    const a = await anfrage(
      konten[p],
      "POST",
      `${L(lagerId)}/pinnwand/${beitrag.id}/umfrage`,
      { optionen: ["Ja", "Nein"] },
    );
    expect(a.status).toBe(anlegen[p]);
  });

  test.each(LAGER_PERSONAS)("%s: abstimmen und reagieren", async (p) => {
    const s = await stimme(p, ziel.pfad, [ziel.optionen[0]]);
    const r = await anfrage(
      konten[p],
      "PUT",
      `${L(lagerId)}/reaktionen/pinnwand_beitrag/${ziel.beitragId}`,
      { emoji: "herz" },
    );
    expect([s.status, r.status]).toEqual([abstimmen[p], abstimmen[p]]);
  });

  test("abgeschlossenes Lager: Stimme und Reaktion 409, Lesen 200", async () => {
    const zu = await neuesLager();
    const z = await neueUmfrage(zu);
    await db
      .update(schema.lager)
      .set({ status: "abgeschlossen" })
      .where(eq(schema.lager.id, zu));
    const s = await stimme("team", z.pfad, [z.optionen[0]]);
    expect([s.status, s.body.code]).toEqual([409, "LAGER_GESCHLOSSEN"]);
    const r = await anfrage(
      konten.team,
      "PUT",
      `${L(zu)}/reaktionen/pinnwand_beitrag/${z.beitragId}`,
      { emoji: "daumen" },
    );
    expect(r.status).toBe(409);
    expect((await liste("team", zu))[0]!.umfrage).not.toBeNull();
  });

  test("ein Beitrag eines anderen Lagers ist unbekannt (404), auch mit eigenem Lager in der URL", async () => {
    const anderes = await neuesLager();
    const s = await stimme(
      "team",
      `${L(anderes)}/pinnwand/${ziel.beitragId}/umfrage`,
      [ziel.optionen[0]],
    );
    expect(s.status).toBe(404);
    const r = await anfrage(
      konten.team,
      "PUT",
      `${L(anderes)}/reaktionen/pinnwand_beitrag/${ziel.beitragId}`,
      { emoji: "herz" },
    );
    expect(r.status).toBe(404);
    const fremd = await anfrage(
      konten.team,
      "PUT",
      `${L(fremdLagerId)}/reaktionen/pinnwand_beitrag/${ziel.beitragId}`,
      { emoji: "herz" },
    );
    expect(fremd.status).toBe(404);
  });
});

describe("Umfrage anlegen, ändern, löschen", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test("Standard: eine Antwort je Person, offen, Namen nur für die Leitung; Optionen in der Reihenfolge der Eingabe", async () => {
    const { umfrage, beitragId } = await neueUmfrage(lagerId);
    expect(umfrage).toMatchObject({
      version: 1,
      mehrfach: false,
      geschlossen: false,
      schliesstAm: null,
      namenFuerTeam: false,
      namenSichtbar: true,
      teilnehmende: 0,
    });
    expect(umfrage.optionen.map((o: { text: string }) => o.text)).toEqual(
      OPTIONEN,
    );
    expect(umfrage.optionen[0]).toMatchObject({
      stimmen: 0,
      eigene: false,
      personen: [],
    });
    // Der Beitrag zählt eine Version hoch: Der Feed meldet ihn den Apps
    const b = await anfrage(
      konten.lagerleitung,
      "GET",
      `${L(lagerId)}/pinnwand/${beitragId}`,
    );
    expect(b.body.version).toBe(2);
  });

  test("zweite Umfrage am Beitrag: 409, Beitrag ohne Umfrage hat umfrage null", async () => {
    const { pfad } = await neueUmfrage(lagerId);
    const zweite = await anfrage(konten.lagerleitung, "POST", pfad, {
      optionen: ["a", "b"],
    });
    expect([zweite.status, zweite.body.code]).toEqual([
      409,
      "UMFRAGE_EXISTIERT",
    ]);
    const ohne = await neuerBeitrag(lagerId);
    const a = (await liste("team", lagerId)).find((b) => b.id === ohne.id)!;
    expect(a.umfrage).toBeNull();
    expect(a.reaktionen).toEqual({ zaehler: {}, eigene: null });
  });

  test("ungültige Eingaben: 400", async () => {
    const beitrag = await neuerBeitrag(lagerId);
    const pfad = `${L(lagerId)}/pinnwand/${beitrag.id}/umfrage`;
    const schlecht: Record<string, unknown>[] = [
      { optionen: ["nur eine"] },
      { optionen: [] },
      { optionen: ["a", "A"] },
      { optionen: ["a", "  "] },
      { optionen: Array.from({ length: 11 }, (_, i) => `o${i}`) },
      { optionen: ["a", "b"], mehrfach: "ja" },
      { optionen: ["a", "b"], extra: 1 },
      { optionen: ["a", "x".repeat(201)] },
      { optionen: ["a", "b"], schliesstAm: "morgen" },
    ];
    for (const body of schlecht) {
      const a = await anfrage(konten.lagerleitung, "POST", pfad, body);
      expect([a.status, JSON.stringify(body).slice(0, 40)]).toEqual([
        400,
        JSON.stringify(body).slice(0, 40),
      ]);
    }
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "POST",
          `${L(lagerId)}/pinnwand/${randomUUID()}/umfrage`,
          { optionen: ["a", "b"] },
        )
      ).status,
    ).toBe(404);
  });

  test("ändern: Version nötig, falsche Version 409, Namen für das Team umschalten", async () => {
    const z = await neueUmfrage(lagerId);
    const alt = await anfrage(konten.leitung, "PATCH", z.pfad, {
      version: 7,
      namenFuerTeam: true,
    });
    expect([alt.status, alt.body.code]).toEqual([409, "VERSION_KONFLIKT"]);
    const leer = await anfrage(konten.leitung, "PATCH", z.pfad, { version: 1 });
    expect(leer.status).toBe(400);
    const gut = await anfrage(konten.leitung, "PATCH", z.pfad, {
      version: 1,
      namenFuerTeam: true,
      schliesstAm: "2099-01-01T00:00:00Z",
    });
    expect(gut.status).toBe(200);
    expect(gut.body).toMatchObject({
      version: 2,
      namenFuerTeam: true,
      schliesstAm: "2099-01-01T00:00:00.000Z",
      geschlossen: false,
    });
    // Das Team ändert nichts
    const team = await anfrage(konten.team, "PATCH", z.pfad, {
      version: 2,
      geschlossen: true,
    });
    expect(team.status).toBe(403);
  });

  test("löschen: Umfrage verschwindet, Stimmen gehen mit 404 ins Leere, danach eine neue Umfrage", async () => {
    const z = await neueUmfrage(lagerId);
    expect((await stimme("team", z.pfad, [z.optionen[0]])).status).toBe(200);
    const falsch = await anfrage(
      konten.leitung,
      "DELETE",
      `${z.pfad}?version=9`,
    );
    expect(falsch.status).toBe(409);
    const del = await anfrage(konten.leitung, "DELETE", `${z.pfad}?version=1`);
    expect(del.status).toBe(204);
    expect(await umfrageSicht("team", lagerId, z.beitragId)).toBeNull();
    const nach = await stimme("team", z.pfad, [z.optionen[0]]);
    expect([nach.status, nach.body.code]).toEqual([404, "UMFRAGE_UNBEKANNT"]);
    const neu = await anfrage(konten.leitung, "POST", z.pfad, {
      optionen: ["x", "y"],
    });
    expect(neu.status).toBe(201);
    expect(neu.body.teilnehmende).toBe(0);
  });
});

describe("Abstimmen", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test("eine Stimme je Person: setzen, wiederholen ändert nichts, wechseln, zurückziehen", async () => {
    const z = await neueUmfrage(lagerId);
    const erste = await stimme("team", z.pfad, [z.optionen[0]]);
    expect(erste.status).toBe(200);
    expect(erste.body.teilnehmende).toBe(1);
    expect(
      erste.body.optionen.map((o: { stimmen: number }) => o.stimmen),
    ).toEqual([1, 0, 0]);
    expect(erste.body.optionen[0].eigene).toBe(true);

    // Idempotent: derselbe Aufruf schreibt nichts (keine neue Zeile, keine Folgenummer)
    const [vorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    const noch = await stimme("team", z.pfad, [z.optionen[0]]);
    expect(noch.status).toBe(200);
    const [nachher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    expect(nachher!.seq).toBe(vorher!.seq);

    const wechsel = await stimme("team", z.pfad, [z.optionen[1]]);
    expect(
      wechsel.body.optionen.map((o: { stimmen: number }) => o.stimmen),
    ).toEqual([0, 1, 0]);
    expect(wechsel.body.teilnehmende).toBe(1);

    const weg = await anfrage(konten.team, "DELETE", `${z.pfad}/stimme`);
    expect(weg.status).toBe(204);
    // Nochmal: nichts mehr da, trotzdem 204
    expect(
      (await anfrage(konten.team, "DELETE", `${z.pfad}/stimme`)).status,
    ).toBe(204);
    expect(
      (await umfrageSicht("team", lagerId, z.beitragId)).teilnehmende,
    ).toBe(0);
  });

  test("Doppelstimme bei mehrfach=false wird abgelehnt, unbekannte Antworten ebenso", async () => {
    const z = await neueUmfrage(lagerId);
    const zwei = await stimme("team", z.pfad, [z.optionen[0], z.optionen[1]]);
    expect([zwei.status, zwei.body.code]).toEqual([400, "NUR_EINE_STIMME"]);
    const fremd = await stimme("team", z.pfad, [randomUUID()]);
    expect([fremd.status, fremd.body.code]).toEqual([400, "OPTION_UNBEKANNT"]);
    // Eine Antwort einer anderen Umfrage zählt nicht
    const andere = await neueUmfrage(lagerId);
    const quer = await stimme("team", z.pfad, [andere.optionen[0]]);
    expect([quer.status, quer.body.code]).toEqual([400, "OPTION_UNBEKANNT"]);
    for (const body of [
      {},
      { optionIds: [] },
      { optionIds: ["x"] },
      { optionIds: [z.optionen[0], z.optionen[0]] },
    ]) {
      expect(
        (await anfrage(konten.team, "PUT", `${z.pfad}/stimme`, body)).status,
      ).toBe(400);
    }
    expect(await stimmenZeilen(lagerId)).toHaveLength(0);
  });

  test("mehrere Stimmen erlaubt: mehrere Antworten je Person, die Person zählt einmal", async () => {
    const z = await neueUmfrage(lagerId, { mehrfach: true });
    const a = await stimme("team", z.pfad, [z.optionen[0], z.optionen[2]]);
    expect(a.status).toBe(200);
    expect(a.body.teilnehmende).toBe(1);
    expect(a.body.optionen.map((o: { stimmen: number }) => o.stimmen)).toEqual([
      1, 0, 1,
    ]);
    // Eine Antwort fällt weg, eine kommt dazu
    const b = await stimme("team", z.pfad, [z.optionen[2], z.optionen[1]]);
    expect(b.body.optionen.map((o: { stimmen: number }) => o.stimmen)).toEqual([
      0, 1, 1,
    ]);
    expect(b.body.optionen.map((o: { eigene: boolean }) => o.eigene)).toEqual([
      false,
      true,
      true,
    ]);
  });

  test("Stimmen mehrerer Personen überschreiben einander nicht, je Person eine Zeile je Antwort", async () => {
    const z = await neueUmfrage(lagerId);
    await stimme("team", z.pfad, [z.optionen[0]]);
    await stimme("leitung", z.pfad, [z.optionen[0]]);
    await stimme("lagerleitung", z.pfad, [z.optionen[1]]);
    const u = await umfrageSicht("lagerleitung", lagerId, z.beitragId);
    expect(u.teilnehmende).toBe(3);
    expect(u.optionen.map((o) => o.stimmen)).toEqual([2, 1, 0]);
    // Das Team ändert die Stimme der Leitung nicht: Es setzt nur die eigene
    await stimme("team", z.pfad, [z.optionen[2]]);
    const danach = await umfrageSicht("lagerleitung", lagerId, z.beitragId);
    expect(danach.optionen.map((o) => o.stimmen)).toEqual([1, 1, 1]);
    const zeilen = await stimmenZeilen(lagerId);
    expect(
      zeilen
        .filter((s) => s.umfrageId === z.umfrage.id)
        .map((s) => s.personId)
        .sort(),
    ).toEqual(
      [konten.team.id, konten.leitung.id, konten.lagerleitung.id].sort(),
    );
    // Die Datenbank hält die Einmaligkeit je Antwort und Person selbst
    await expect(
      db.insert(schema.umfrageStimme).values({
        lagerId,
        umfrageId: z.umfrage.id,
        optionId: z.optionen[2]!,
        personId: konten.team.id!,
        lagerSeq: 0,
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  test("Schliessen: von Hand oder durch die Frist; dann keine Stimme und kein Zurückziehen, Wiederöffnen geht", async () => {
    const z = await neueUmfrage(lagerId);
    await stimme("team", z.pfad, [z.optionen[0]]);
    const zu = await anfrage(konten.leitung, "PATCH", z.pfad, {
      version: 1,
      geschlossen: true,
    });
    expect(zu.body.geschlossen).toBe(true);
    for (const a of [
      await stimme("team", z.pfad, [z.optionen[1]]),
      await anfrage(konten.team, "DELETE", `${z.pfad}/stimme`),
    ]) {
      expect([a.status, a.body.code]).toEqual([409, "UMFRAGE_GESCHLOSSEN"]);
    }
    // Die Zahlen bleiben lesbar
    const u = await umfrageSicht("team", lagerId, z.beitragId);
    expect([u.geschlossen, u.optionen[0]!.stimmen]).toEqual([true, 1]);

    const auf = await anfrage(konten.leitung, "PATCH", z.pfad, {
      version: 2,
      geschlossen: false,
    });
    expect(auf.body.geschlossen).toBe(false);
    expect((await stimme("team", z.pfad, [z.optionen[1]])).status).toBe(200);

    // Frist vorbei: geschlossen, ohne dass jemand es setzt
    const frist = await anfrage(konten.leitung, "PATCH", z.pfad, {
      version: 3,
      schliesstAm: new Date(Date.now() - 1000).toISOString(),
    });
    expect(frist.body).toMatchObject({ geschlossen: true });
    expect((await stimme("team", z.pfad, [z.optionen[0]])).status).toBe(409);
    // Frist in der Zukunft: offen
    const spaeter = await anfrage(konten.leitung, "PATCH", z.pfad, {
      version: 4,
      schliesstAm: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(spaeter.body.geschlossen).toBe(false);
    expect((await stimme("team", z.pfad, [z.optionen[0]])).status).toBe(200);
  });
});

describe("Namen der Stimmen", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test("Standard: Lagerleitung und Leitung sehen Namen, Team und Lesen nur Zahlen (und die eigene Stimme)", async () => {
    const z = await neueUmfrage(lagerId);
    await stimme("team", z.pfad, [z.optionen[0]]);
    await stimme("leitung", z.pfad, [z.optionen[0]]);
    for (const p of ["lagerleitung", "leitung", "abteilungsleitung"] as const) {
      const u = await umfrageSicht(p, lagerId, z.beitragId);
      expect([p, u.namenSichtbar]).toEqual([p, true]);
      expect(u.optionen[0]!.personen.map((x) => x.id).sort()).toEqual(
        [konten.team.id, konten.leitung.id].sort(),
      );
      expect(u.optionen[0]!.personen[0]!.name).toEqual(expect.any(String));
    }
    for (const p of ["team", "lesen"] as const) {
      const u = await umfrageSicht(p, lagerId, z.beitragId);
      expect(u.namenSichtbar).toBe(false);
      expect(u.optionen.every((o) => o.personen.length === 0)).toBe(true);
      expect(u.optionen[0]!.stimmen).toBe(2);
    }
    // Die eigene Stimme sieht das Team trotzdem
    expect(
      (await umfrageSicht("team", lagerId, z.beitragId)).optionen[0]!.eigene,
    ).toBe(true);
    expect(
      (await umfrageSicht("lesen", lagerId, z.beitragId)).optionen[0]!.eigene,
    ).toBe(false);
  });

  test("namenFuerTeam: alle, die den Beitrag lesen, sehen die Namen; umschaltbar", async () => {
    const z = await neueUmfrage(lagerId, { namenFuerTeam: true });
    await stimme("leitung", z.pfad, [z.optionen[1]]);
    for (const p of ["team", "lesen"] as const) {
      const u = await umfrageSicht(p, lagerId, z.beitragId);
      expect(u.namenSichtbar).toBe(true);
      expect(u.optionen[1]!.personen.map((x) => x.id)).toEqual([
        konten.leitung.id,
      ]);
    }
    await anfrage(konten.lagerleitung, "PATCH", z.pfad, {
      version: 1,
      namenFuerTeam: false,
    });
    const u = await umfrageSicht("team", lagerId, z.beitragId);
    expect([u.namenSichtbar, u.optionen[1]!.personen]).toEqual([false, []]);
  });
});

describe("Sichtbarkeit folgt dem Beitrag", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test("Beitrag nur für die Leitung: Team und Lesen sehen ihn nicht und können nicht abstimmen oder reagieren (404)", async () => {
    const z = await neueUmfrage(
      lagerId,
      {},
      { empfaenger: { rollen: ["leitung"], personen: [] } },
    );
    expect(
      (await liste("team", lagerId)).some((b) => b.id === z.beitragId),
    ).toBe(false);
    expect((await stimme("team", z.pfad, [z.optionen[0]])).status).toBe(404);
    const r = await anfrage(
      konten.team,
      "PUT",
      `${L(lagerId)}/reaktionen/pinnwand_beitrag/${z.beitragId}`,
      { emoji: "daumen" },
    );
    expect(r.status).toBe(404);
    expect(
      (
        await anfrage(
          konten.team,
          "DELETE",
          `${L(lagerId)}/reaktionen/pinnwand_beitrag/${z.beitragId}`,
        )
      ).status,
    ).toBe(404);
    expect((await stimme("leitung", z.pfad, [z.optionen[0]])).status).toBe(200);
  });

  test("Beitrag für eine einzelne Person: nur sie stimmt ab", async () => {
    const z = await neueUmfrage(
      lagerId,
      {},
      { empfaenger: { rollen: [], personen: [konten.team.id] } },
    );
    expect((await stimme("team", z.pfad, [z.optionen[0]])).status).toBe(200);
    expect((await stimme("lesen", z.pfad, [z.optionen[0]])).status).toBe(403);
    // lesen hat kein interaktion.schreiben; sie sieht ihn auch nicht
    expect(
      (await liste("lesen", lagerId)).some((b) => b.id === z.beitragId),
    ).toBe(false);
  });

  test("ausserhalb des Zeitfensters: für das Team unbekannt, die Leitung stimmt ab", async () => {
    const kuenftig = await neueUmfrage(
      lagerId,
      {},
      { sichtbarAb: new Date(Date.now() + 3_600_000).toISOString() },
    );
    expect(
      (await stimme("team", kuenftig.pfad, [kuenftig.optionen[0]])).status,
    ).toBe(404);
    expect(
      (await stimme("leitung", kuenftig.pfad, [kuenftig.optionen[0]])).status,
    ).toBe(200);
  });

  test("gelöschter Beitrag: 404", async () => {
    const z = await neueUmfrage(lagerId);
    const b = await anfrage(
      konten.lagerleitung,
      "GET",
      `${L(lagerId)}/pinnwand/${z.beitragId}`,
    );
    await anfrage(
      konten.lagerleitung,
      "DELETE",
      `${L(lagerId)}/pinnwand/${z.beitragId}?version=${b.body.version}`,
    );
    expect((await stimme("team", z.pfad, [z.optionen[0]])).status).toBe(404);
  });

  test("ein gelöschter Beitrag nimmt Umfrage, Antworten, Stimmen und Reaktionen endgültig mit; der Feed meldet jede Zeile", async () => {
    const z = await neueUmfrage(lagerId);
    expect((await stimme("team", z.pfad, [z.optionen[0]!])).status).toBe(200);
    expect(
      (
        await anfrage(
          konten.leitung,
          "PUT",
          `${L(lagerId)}/reaktionen/pinnwand_beitrag/${z.beitragId}`,
          { emoji: "herz" },
        )
      ).status,
    ).toBe(200);
    const seit = (
      await anfrage(konten.lagerleitung, "GET", `${L(lagerId)}/aenderungen`)
    ).body.seq;
    const b = await anfrage(
      konten.lagerleitung,
      "GET",
      `${L(lagerId)}/pinnwand/${z.beitragId}`,
    );
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "DELETE",
          `${L(lagerId)}/pinnwand/${z.beitragId}?version=${b.body.version}`,
        )
      ).status,
    ).toBe(204);
    expect(
      await db.$count(
        schema.umfrage,
        eq(schema.umfrage.beitragId, z.beitragId),
      ),
    ).toBe(0);
    expect(
      await db.$count(
        schema.umfrageOption,
        inArray(schema.umfrageOption.id, z.optionen),
      ),
    ).toBe(0);
    expect(
      await db.$count(
        schema.umfrageStimme,
        eq(schema.umfrageStimme.optionId, z.optionen[0]!),
      ),
    ).toBe(0);
    expect(
      await db.$count(schema.reaktion, eq(schema.reaktion.zielId, z.beitragId)),
    ).toBe(0);
    const feed = (
      await anfrage(
        konten.lagerleitung,
        "GET",
        `${L(lagerId)}/aenderungen?seit=${seit}&limit=500`,
      )
    ).body.eintraege as { objekttyp: string; art: string }[];
    const geloescht = feed.filter((e) => e.art === "geloescht");
    expect(geloescht.map((e) => e.objekttyp).sort()).toEqual(
      [
        "pinnwand_beitrag",
        "umfrage",
        "umfrage_option",
        "umfrage_option",
        "umfrage_option",
        "umfrage_stimme",
        "reaktion",
      ].sort(),
    );
  });

  test("Lesen mit der Pinnwand: Der Pinnwand-Eintrag des Teams zeigt Umfrage und Reaktionen additiv", async () => {
    const z = await neueUmfrage(lagerId);
    const b = (await liste("team", lagerId)).find((x) => x.id === z.beitragId)!;
    expect(Object.keys(b)).toEqual(
      expect.arrayContaining([
        "titel",
        "empfaenger",
        "dateien",
        "umfrage",
        "reaktionen",
      ]),
    );
  });
});

describe("Reaktionen", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });
  const pfad = (id: string, beitragId: string) =>
    `${L(id)}/reaktionen/pinnwand_beitrag/${beitragId}`;

  test("eine Reaktion je Person und Beitrag: setzen, ersetzen, wiederholen, zurücknehmen", async () => {
    const b = await neuerBeitrag(lagerId);
    const p = pfad(lagerId, b.id);
    const a = await anfrage(konten.team, "PUT", p, { emoji: "daumen" });
    expect([a.status, a.body]).toEqual([
      200,
      { zaehler: { daumen: 1 }, eigene: "daumen" },
    ]);
    // Die Leitung reagiert anders: beide Zähler stehen, jede sieht ihre eigene
    const l = await anfrage(konten.leitung, "PUT", p, { emoji: "herz" });
    expect(l.body).toEqual({ zaehler: { daumen: 1, herz: 1 }, eigene: "herz" });
    // Ersetzen statt Dazulegen
    const e = await anfrage(konten.team, "PUT", p, { emoji: "danke" });
    expect(e.body).toEqual({ zaehler: { herz: 1, danke: 1 }, eigene: "danke" });
    // Dieselbe Reaktion nochmal: keine neue Version
    const [vorher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    await anfrage(konten.team, "PUT", p, { emoji: "danke" });
    const [nachher] = await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, lagerId));
    expect(nachher!.seq).toBe(vorher!.seq);

    // In der Liste: Zähler für alle, «eigene» je Person
    const team = (await liste("team", lagerId)).find((x) => x.id === b.id)!;
    expect(team.reaktionen).toEqual({
      zaehler: { herz: 1, danke: 1 },
      eigene: "danke",
    });
    const lesen = (await liste("lesen", lagerId)).find((x) => x.id === b.id)!;
    expect(lesen.reaktionen).toEqual({
      zaehler: { herz: 1, danke: 1 },
      eigene: null,
    });

    // Das Team nimmt nur die eigene zurück
    expect((await anfrage(konten.team, "DELETE", p)).status).toBe(204);
    expect((await anfrage(konten.team, "DELETE", p)).status).toBe(204);
    const rest = (await liste("leitung", lagerId)).find((x) => x.id === b.id)!;
    expect(rest.reaktionen).toEqual({ zaehler: { herz: 1 }, eigene: "herz" });
    const zeilen = await db
      .select()
      .from(schema.reaktion)
      .where(and(eq(schema.reaktion.zielId, b.id)));
    expect(zeilen.map((z) => z.personId)).toEqual([konten.leitung.id]);
  });

  test("alle fünf Schlüssel gehen, andere nicht (auch kein Emoji-Zeichen)", async () => {
    const b = await neuerBeitrag(lagerId);
    for (const emoji of ["daumen", "herz", "lachen", "staunen", "danke"]) {
      expect(
        (await anfrage(konten.team, "PUT", pfad(lagerId, b.id), { emoji }))
          .status,
      ).toBe(200);
    }
    for (const emoji of ["\u{1F44D}", "like", "", 1, null]) {
      expect(
        (
          await anfrage(konten.team, "PUT", pfad(lagerId, b.id), {
            emoji,
          } as never)
        ).status,
      ).toBe(400);
    }
    expect(
      (await anfrage(konten.team, "PUT", pfad(lagerId, b.id), {})).status,
    ).toBe(400);
    // Unbekannter Ziel-Typ
    expect(
      (
        await anfrage(
          konten.team,
          "PUT",
          `${L(lagerId)}/reaktionen/aufgabe/${b.id}`,
          { emoji: "herz" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(konten.team, "PUT", pfad(lagerId, randomUUID()), {
          emoji: "herz",
        })
      ).status,
    ).toBe(404);
  });
});

describe("Datenbanklast", () => {
  test("die Zahl der Abfragen einer Seite hängt nicht von der Zahl der Beiträge, Umfragen und Reaktionen ab", async () => {
    const id = await neuesLager();
    const z0 = await neueUmfrage(id);
    await stimme("team", z0.pfad, [z0.optionen[0]]);
    await anfrage(
      konten.team,
      "PUT",
      `${L(id)}/reaktionen/pinnwand_beitrag/${z0.beitragId}`,
      { emoji: "herz" },
    );
    const zaehle = async (p: LagerPersona) => {
      await anfrage(konten[p], "GET", `${L(id)}/pinnwand`);
      const vorher = abfragen;
      const a = await anfrage(konten[p], "GET", `${L(id)}/pinnwand`);
      expect(a.status).toBe(200);
      return { n: abfragen - vorher, beitraege: a.body.beitraege.length };
    };
    const klein = await zaehle("lagerleitung");
    const kleinTeam = await zaehle("team");
    for (let i = 0; i < 9; i++) {
      const z = await neueUmfrage(id, { mehrfach: true });
      await stimme("team", z.pfad, [z.optionen[0], z.optionen[1]]);
      await stimme("leitung", z.pfad, [z.optionen[1]]);
      await anfrage(
        konten.leitung,
        "PUT",
        `${L(id)}/reaktionen/pinnwand_beitrag/${z.beitragId}`,
        { emoji: "lachen" },
      );
    }
    const gross = await zaehle("lagerleitung");
    const grossTeam = await zaehle("team");
    expect([klein.beitraege, gross.beitraege]).toEqual([1, 10]);
    expect(gross.n).toBe(klein.n);
    expect(grossTeam.n).toBe(kleinTeam.n);
  });
});
