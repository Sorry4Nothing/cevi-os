import { eq } from "drizzle-orm";
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
import {
  ladeWetter,
  NEUER_VERSUCH_MINUTEN,
  SCHWELLEN,
  warnungen,
  WETTER_STAND_MAX_STUNDEN,
  WETTER_STUNDEN,
  zustand,
} from "../../src/lager/wetter.js";
import {
  holeOpenMeteo,
  type WetterTag,
} from "../../src/lager/wetter-openmeteo.js";
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

// Eine Attrappe statt des Wetterdienstes: Kein Netz, jeder Abruf wird gezählt
let abrufe: [number, number][] = [];
let antwort: () => Promise<WetterTag[]>;
const tag = (datum: string, werte: Partial<WetterTag> = {}): WetterTag => ({
  datum,
  code: 1,
  tmax: 22,
  tmin: 12,
  regen: 0,
  boeen: 20,
  ...werte,
});
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  wetter: async (breite, laenge) => {
    abrufe.push([breite, laenge]);
    return antwort();
  },
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

beforeEach(() => {
  abrufe = [];
  antwort = async () => [tag("2041-06-01")];
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
  p: {
    status?: "aktiv" | "abgeschlossen";
    breite?: number;
    laenge?: number;
    abteilungId?: string;
  } = {},
) {
  const abteilungId = p.abteilungId ?? welt.testabteilungId;
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Wetterlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status: p.status ?? "aktiv",
      breite: p.breite,
      laenge: p.laenge,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  if (abteilungId !== welt.testabteilungId) return id;
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
const W = (id: string) => `/api/v1/lager/${id}/wetter`;
const stunden = (n: number) => new Date(Date.now() - n * 3_600_000);
const zeile = async (id: string) =>
  (
    await db
      .select()
      .from(schema.wetterCache)
      .where(eq(schema.wetterCache.lagerId, id))
  )[0];

describe("Rechte", () => {
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 200,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const ortSetzen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  test.each(LAGER_PERSONAS)("%s: Wetter lesen", async (p) => {
    const l = await neuesLager();
    expect((await anfrage(konten[p], "GET", W(l))).status).toBe(lesen[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Ort setzen", async (p) => {
    const l = await neuesLager();
    const a = await anfrage(konten[p], "PUT", `${W(l)}/ort`, {
      breite: 47.3769,
      laenge: 8.5417,
    });
    expect(a.status).toBe(ortSetzen[p]);
    const [stand] = await db
      .select({ breite: schema.lager.breite })
      .from(schema.lager)
      .where(eq(schema.lager.id, l));
    // Wer nicht darf, ändert nichts
    expect(stand!.breite).toBe(ortSetzen[p] === 200 ? 47.38 : null);
  });
  test("im geschlossenen Lager ist Lesen erlaubt, Ort setzen 409", async () => {
    const l = await neuesLager({ status: "abgeschlossen" });
    expect((await anfrage(konten.team, "GET", W(l))).status).toBe(200);
    expect(
      (
        await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
          breite: 47,
          laenge: 8,
        })
      ).status,
    ).toBe(409);
  });
  test("ein fremdes Lager ist 404", async () => {
    const l = await neuesLager({ abteilungId: welt.demoAbteilungId });
    expect((await anfrage(konten.lagerleitung, "GET", W(l))).status).toBe(404);
    expect(
      (
        await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
          breite: 47,
          laenge: 8,
        })
      ).status,
    ).toBe(404);
  });
});

describe("Ort", () => {
  test("setzen rundet auf zwei Stellen, ins Protokoll kommt nur «gesetzt»", async () => {
    const l = await neuesLager();
    const a = await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
      breite: 46.94809,
      laenge: 7.44744,
    });
    expect(a.body).toEqual({ breite: 46.95, laenge: 7.45 });
    const eintrag = (
      await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.zielId, l))
    ).find((e) => e.aktion === "lager_wetter_ort");
    expect(eintrag?.details).toEqual({ gesetzt: true });
    const b = await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
      breite: null,
      laenge: null,
    });
    expect(b.body).toEqual({ breite: null, laenge: null });
    const spaeter = (
      await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.zielId, l))
    ).filter((e) => e.aktion === "lager_wetter_ort");
    expect(spaeter.map((e) => e.details)).toEqual(
      expect.arrayContaining([{ gesetzt: true }, { gesetzt: false }]),
    );
  });
  test("ungültige Werte sind 400: nur ein Wert, ausserhalb der Grenzen, fremde Felder", async () => {
    const l = await neuesLager();
    for (const body of [
      { breite: 47, laenge: null },
      { breite: null, laenge: 8 },
      { breite: 91, laenge: 8 },
      { breite: 47, laenge: -181 },
      { breite: "47", laenge: 8 },
      { breite: 47, laenge: 8, name: "Lagerhaus" },
      { breite: 47 },
      {},
    ]) {
      expect(
        (await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, body)).status,
      ).toBe(400);
    }
  });
});

describe("Wetter und Zwischenspeicher", () => {
  test("ohne Ort kein Abruf und eine leere Antwort", async () => {
    const l = await neuesLager();
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body).toEqual({ ort: null, stand: null, tage: [] });
    expect(abrufe).toHaveLength(0);
    expect(await zeile(l)).toBeUndefined();
  });

  test("ein Abruf für viele Anfragen: gleichzeitig und danach aus dem Speicher", async () => {
    const l = await neuesLager({ breite: 47.3769, laenge: 8.5417 });
    const alle = await Promise.all(
      LAGER_PERSONAS.filter(
        (p) =>
          !["ohneMitgliedschaft", "fremdeAbteilung", "ohneLogin"].includes(p),
      ).flatMap((p) => [
        anfrage(konten[p], "GET", W(l)),
        anfrage(konten[p], "GET", W(l)),
      ]),
    );
    expect(alle.every((a) => a.status === 200)).toBe(true);
    // Es geht nur der gerundete Ort hinaus
    expect(abrufe).toEqual([[47.38, 8.54]]);
    const a = alle[0]!.body;
    expect(a.ort).toEqual({ breite: 47.3769, laenge: 8.5417 });
    expect(a.stand).not.toBeNull();
    expect(a.tage).toEqual([
      {
        datum: "2041-06-01",
        code: 1,
        tmax: 22,
        tmin: 12,
        regen: 0,
        boeen: 20,
        zustand: "Teils bewölkt",
        warnungen: [],
      },
    ]);
    // Weitere Anfragen im Rahmen der Frist holen nichts
    await anfrage(konten.lesen, "GET", W(l));
    expect(abrufe).toHaveLength(1);
    expect(await zeile(l)).toMatchObject({ breite: 47.38, laenge: 8.54 });
  });

  test(`nach ${WETTER_STUNDEN} Stunden holt der nächste Aufruf neu`, async () => {
    const l = await neuesLager({ breite: 47.3769, laenge: 8.5417 });
    await anfrage(konten.team, "GET", W(l));
    await db
      .update(schema.wetterCache)
      .set({ abgerufenAm: stunden(WETTER_STUNDEN + 0.1) })
      .where(eq(schema.wetterCache.lagerId, l));
    antwort = async () => [tag("2041-06-02", { code: 61 })];
    const a = await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toHaveLength(2);
    expect(a.body.tage[0]).toMatchObject({
      datum: "2041-06-02",
      zustand: "Regen",
    });
  });

  test("ändert die Lagerleitung den Ort, gilt der alte Stand nicht mehr", async () => {
    const l = await neuesLager({ breite: 47.3769, laenge: 8.5417 });
    await anfrage(konten.team, "GET", W(l));
    await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
      breite: 46.0,
      laenge: 7.0,
    });
    await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toEqual([
      [47.38, 8.54],
      [46, 7],
    ]);
    // Eine Änderung unter der Rundung ist derselbe Ort
    await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
      breite: 46.001,
      laenge: 7.001,
    });
    await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toHaveLength(2);
  });

  test("fällt der Dienst aus: kein Wetter statt eines Fehlers, und höchstens ein Versuch je Viertelstunde", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    antwort = async () => {
      throw new Error("Zeitüberschreitung");
    };
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.status).toBe(200);
    expect(a.body.tage).toEqual([]);
    expect(a.body.stand).toBeNull();
    expect(a.body.ort).toEqual({ breite: 47, laenge: 8 });
    // Auch viele weitere Anfragen lösen keinen neuen Abruf aus
    await Promise.all([1, 2, 3].map(() => anfrage(konten.team, "GET", W(l))));
    expect(abrufe).toHaveLength(1);
    // Nach der Frist versucht der Server es wieder
    await db
      .update(schema.wetterCache)
      .set({
        versuchAm: new Date(Date.now() - (NEUER_VERSUCH_MINUTEN + 1) * 60_000),
      })
      .where(eq(schema.wetterCache.lagerId, l));
    antwort = async () => [tag("2041-06-01")];
    const b = await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toHaveLength(2);
    expect(b.body.tage).toHaveLength(1);
  });

  test("bei Ausfall bleibt der letzte Stand sichtbar, aber nicht länger als einen Tag", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    await anfrage(konten.team, "GET", W(l));
    antwort = async () => {
      throw new Error("Aus");
    };
    await db
      .update(schema.wetterCache)
      .set({ abgerufenAm: stunden(10) })
      .where(eq(schema.wetterCache.lagerId, l));
    const alt = await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toHaveLength(2);
    expect(alt.body.tage).toHaveLength(1);
    expect(alt.body.stand).not.toBeNull();
    await db
      .update(schema.wetterCache)
      .set({
        abgerufenAm: stunden(WETTER_STAND_MAX_STUNDEN + 1),
        versuchAm: stunden(1),
      })
      .where(eq(schema.wetterCache.lagerId, l));
    const zuAlt = await anfrage(konten.team, "GET", W(l));
    expect(zuAlt.body.tage).toEqual([]);
    expect(zuAlt.body.stand).toBeNull();
  });

  test("ein Fehlschlag bei neuem Ort lässt keine Werte des alten Ortes stehen", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    await anfrage(konten.team, "GET", W(l));
    antwort = async () => {
      throw new Error("Aus");
    };
    await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
      breite: 10,
      laenge: 10,
    });
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body.tage).toEqual([]);
    expect(await zeile(l)).toMatchObject({
      breite: 10,
      laenge: 10,
      abgerufenAm: null,
      tage: [],
    });
  });

  test("ein Lager nimmt seinen Zwischenspeicher mit", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    await anfrage(konten.team, "GET", W(l));
    expect(await zeile(l)).toBeDefined();
    await db.delete(schema.lager).where(eq(schema.lager.id, l));
    expect(await zeile(l)).toBeUndefined();
  });

  test("ladeWetter mit fester Zeit: Grenzen der Fristen", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    const lager = { id: l, breite: 47, laenge: 8 };
    const t0 = new Date("2041-06-01T08:00:00Z");
    const holen = vi.fn(async () => [tag("2041-06-01")]);
    await ladeWetter(db, lager, holen, t0);
    // Knapp unter der Frist: aus dem Speicher
    await ladeWetter(
      db,
      lager,
      holen,
      new Date(t0.getTime() + (WETTER_STUNDEN * 60 - 1) * 60_000),
    );
    expect(holen).toHaveBeenCalledTimes(1);
    // Ab der Frist: neu
    await ladeWetter(
      db,
      lager,
      holen,
      new Date(t0.getTime() + WETTER_STUNDEN * 3_600_000),
    );
    expect(holen).toHaveBeenCalledTimes(2);
  });
});

describe("Warnungen und Wörter", () => {
  const basis = tag("2041-06-01");
  test("Schwellen: Gewitter, Böen ab 60, Hitze ab 30, Regen ab 20", () => {
    expect(warnungen(basis)).toEqual([]);
    expect(warnungen({ ...basis, code: 95 })).toEqual(["gewitter"]);
    expect(warnungen({ ...basis, code: 99 })).toEqual(["gewitter"]);
    expect(warnungen({ ...basis, code: 82 })).toEqual([]);
    expect(warnungen({ ...basis, boeen: SCHWELLEN.boeen - 0.1 })).toEqual([]);
    expect(warnungen({ ...basis, boeen: SCHWELLEN.boeen })).toEqual(["boeen"]);
    expect(warnungen({ ...basis, tmax: SCHWELLEN.hitze - 0.1 })).toEqual([]);
    expect(warnungen({ ...basis, tmax: SCHWELLEN.hitze })).toEqual(["hitze"]);
    expect(warnungen({ ...basis, regen: SCHWELLEN.regen - 0.1 })).toEqual([]);
    expect(warnungen({ ...basis, regen: SCHWELLEN.regen })).toEqual(["regen"]);
    // Fehlende Werte warnen nie
    expect(
      warnungen({
        ...basis,
        code: null,
        boeen: null,
        tmax: null,
        regen: null,
      }),
    ).toEqual([]);
  });
  test("Wörter zu den Wettercodes", () => {
    expect(zustand(0)).toBe("Klar");
    expect(zustand(2)).toBe("Teils bewölkt");
    expect(zustand(3)).toBe("Bedeckt");
    expect(zustand(45)).toBe("Nebel");
    expect(zustand(53)).toBe("Nieselregen");
    expect(zustand(63)).toBe("Regen");
    expect(zustand(73)).toBe("Schnee");
    expect(zustand(81)).toBe("Regenschauer");
    expect(zustand(86)).toBe("Schneeschauer");
    expect(zustand(96)).toBe("Gewitter");
    expect(zustand(null)).toBeNull();
    expect(zustand(1234)).toBeNull();
  });
});

describe("Abruf bei Open-Meteo (ohne Netz)", () => {
  const antwortKoerper = {
    daily: {
      time: ["2041-06-01", "2041-06-02"],
      weather_code: [3, null],
      temperature_2m_max: [21.5, 24],
      temperature_2m_min: [11, null],
      precipitation_sum: [0, 3.2],
      wind_gusts_10m_max: [30, 41.5],
    },
  };
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: Response | Error) => {
    const f = vi.fn<
      (url: URL | string, init?: RequestInit) => Promise<Response>
    >(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
    vi.stubGlobal("fetch", f);
    return f;
  };

  test("die Adresse hat den festen Host, nur Zahlen, kein Weiterleiten, ein Zeitlimit", async () => {
    const f = stub(Response.json(antwortKoerper));
    const tage = await holeOpenMeteo(47.38, 8.54);
    expect(tage).toEqual([
      {
        datum: "2041-06-01",
        code: 3,
        tmax: 21.5,
        tmin: 11,
        regen: 0,
        boeen: 30,
      },
      {
        datum: "2041-06-02",
        code: null,
        tmax: 24,
        tmin: null,
        regen: 3.2,
        boeen: 41.5,
      },
    ]);
    const [url, init] = f.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("api.open-meteo.com");
    expect(u.pathname).toBe("/v1/forecast");
    expect(u.searchParams.get("latitude")).toBe("47.38");
    expect(u.searchParams.get("longitude")).toBe("8.54");
    expect(u.searchParams.get("timezone")).toBe("Europe/Zurich");
    // Genau diese Parameter: nichts über Lager, Personen oder Konto
    expect([...u.searchParams.keys()].sort()).toEqual([
      "daily",
      "forecast_days",
      "latitude",
      "longitude",
      "past_days",
      "timezone",
      "wind_speed_unit",
    ]);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(init?.body).toBeUndefined();
  });

  test("ein Fehlerstatus, ein Netzfehler, kaputtes oder falsch geformtes JSON werfen", async () => {
    stub(new Response("Fehler", { status: 500 }));
    await expect(holeOpenMeteo(47, 8)).rejects.toThrow();
    stub(new Error("getaddrinfo ENOTFOUND"));
    await expect(holeOpenMeteo(47, 8)).rejects.toThrow();
    stub(new Response("kein json"));
    await expect(holeOpenMeteo(47, 8)).rejects.toThrow();
    stub(Response.json({ daily: { time: ["2041-06-01"] } }));
    await expect(holeOpenMeteo(47, 8)).rejects.toThrow();
    stub(
      Response.json({
        daily: { ...antwortKoerper.daily, time: ["kein Datum", "2041-06-02"] },
      }),
    );
    await expect(holeOpenMeteo(47, 8)).rejects.toThrow();
  });

  test("eine zu grosse Antwort wird abgebrochen", async () => {
    stub(new Response("x".repeat(70 * 1024)));
    await expect(holeOpenMeteo(47, 8)).rejects.toThrow(/zu gross/);
  });

  test("der echte Abruf läuft nie ohne eingespritzten Dienst, wenn kein Ort gesetzt ist", async () => {
    const f = stub(Response.json(antwortKoerper));
    const eigeneApp = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
    });
    const l = await neuesLager();
    const res = await eigeneApp.request(W(l), {
      headers: konten.team.headers,
    });
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    // Mit Ort geht der Abruf über den echten Weg (hier die Attrappe von fetch), nie über eine andere Adresse
    await anfrage(konten.lagerleitung, "PUT", `${W(l)}/ort`, {
      breite: 47.3769,
      laenge: 8.5417,
    });
    const mitOrt = await eigeneApp.request(W(l), {
      headers: konten.team.headers,
    });
    expect(mitOrt.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(new URL(String(f.mock.calls[0]![0])).host).toBe(
      "api.open-meteo.com",
    );
  });
});
