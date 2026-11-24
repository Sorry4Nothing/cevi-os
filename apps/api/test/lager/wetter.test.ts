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
import {
  NEUER_ORTSVERSUCH_MINUTEN,
  ortAnfrage,
} from "../../src/lager/wetter-ort.js";
import {
  sucheOpenMeteo,
  waehleTreffer,
  type OrtTreffer,
} from "../../src/lager/wetter-geocoding.js";
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
import { aufgeloest, dienst, treffer } from "./wetter-hilfen.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

// Eine Attrappe statt des Wetterdienstes: Kein Netz, jeder Abruf wird gezählt
let abrufe: [number, number][] = [];
let antwort: () => Promise<WetterTag[]>;
// Ebenso für die Ortssuche: Jede Suche wird mit dem gesendeten Namen gezählt
let suchen: string[] = [];
let suchAntwort: (name: string) => Promise<OrtTreffer[]>;
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
  wetter: dienst(
    async (breite, laenge) => {
      abrufe.push([breite, laenge]);
      return antwort();
    },
    async (name) => {
      suchen.push(name);
      return suchAntwort(name);
    },
  ),
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

beforeEach(() => {
  abrufe = [];
  suchen = [];
  antwort = async () => [tag("2041-06-01")];
  suchAntwort = async () => [treffer()];
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
    // Ein Lagerort, der noch nicht aufgelöst ist
    ort?: string;
    adresse?: string;
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
      ...(p.breite !== undefined && p.laenge !== undefined
        ? aufgeloest(p.breite, p.laenge)
        : {}),
      ...(p.ort !== undefined && { ort: p.ort }),
      adresse: p.adresse,
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
  test.each(LAGER_PERSONAS)("%s: Wetter lesen", async (p) => {
    const l = await neuesLager();
    expect((await anfrage(konten[p], "GET", W(l))).status).toBe(lesen[p]);
  });
  test("im geschlossenen Lager ist Lesen erlaubt", async () => {
    const l = await neuesLager({ status: "abgeschlossen" });
    expect((await anfrage(konten.team, "GET", W(l))).status).toBe(200);
  });
  test("ein fremdes Lager ist 404", async () => {
    const l = await neuesLager({ abteilungId: welt.demoAbteilungId });
    expect((await anfrage(konten.lagerleitung, "GET", W(l))).status).toBe(404);
  });
  test("keine manuelle Eingabe: die Route zum Setzen des Ortes gibt es nicht mehr", async () => {
    const l = await neuesLager({ ort: "Musterstadt" });
    for (const p of ["abteilungsleitung", "lagerleitung"] as const) {
      const a = await anfrage(konten[p], "PUT", `${W(l)}/ort`, {
        breite: 47.3769,
        laenge: 8.5417,
      });
      expect(a.status).toBe(404);
    }
    const [stand] = await db
      .select({ breite: schema.lager.breite })
      .from(schema.lager)
      .where(eq(schema.lager.id, l));
    expect(stand!.breite).toBeNull();
    expect(suchen).toHaveLength(0);
  });
});

describe("Ort aus dem Lagerort", () => {
  const lagerZeile = async (id: string) =>
    (await db.select().from(schema.lager).where(eq(schema.lager.id, id)))[0]!;
  const ADMIN = "/api/v1/admin/lager";

  test("ein eindeutiger Ort wird gefunden, gerundet gespeichert und nur einmal gesucht", async () => {
    const l = await neuesLager({ ort: "Musterstadt" });
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body.ort).toEqual({
      status: "gefunden",
      name: "Musterstadt, Kanton Beispiel",
    });
    expect(a.body.tage).toHaveLength(1);
    // Die Vorhersage kommt für den gerundeten Ort
    expect(abrufe).toEqual([[47.38, 8.54]]);
    expect(await lagerZeile(l)).toMatchObject({
      breite: 47.38,
      laenge: 8.54,
      wetterOrtErgebnis: "gefunden",
    });
    await anfrage(konten.lesen, "GET", W(l));
    expect(suchen).toEqual(["Musterstadt"]);
  });

  test("gleichzeitige Anfragen teilen sich eine Suche", async () => {
    const l = await neuesLager({ ort: "Musterstadt" });
    await Promise.all(
      [1, 2, 3, 4].map(() => anfrage(konten.team, "GET", W(l))),
    );
    expect(suchen).toHaveLength(1);
  });

  test("zwei gleich grosse Orte gleichen Namens sind nicht eindeutig: kein Wetter, keine neue Suche", async () => {
    suchAntwort = async () => [
      treffer({ bevoelkerung: 300, breite: 47.1, laenge: 8.1, plz: ["9990"] }),
      treffer({ bevoelkerung: 280, breite: 46.2, laenge: 7.2, plz: ["9991"] }),
    ];
    const l = await neuesLager({ ort: "Musterstadt" });
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body).toEqual({
      ort: { status: "mehrdeutig", name: null },
      stand: null,
      tage: [],
    });
    expect(abrufe).toHaveLength(0);
    await anfrage(konten.team, "GET", W(l));
    expect(suchen).toHaveLength(1);
  });

  test("die Postleitzahl aus der Adresse unterscheidet Treffer, die Adresse selbst geht nicht hinaus", async () => {
    suchAntwort = async () => [
      treffer({ bevoelkerung: 300, breite: 47.1, laenge: 8.1, plz: ["9990"] }),
      treffer({ bevoelkerung: 280, breite: 46.2, laenge: 7.2, plz: ["9991"] }),
    ];
    const l = await neuesLager({
      ort: "Musterstadt",
      adresse: "Pfadiweg 7, 9991 Musterstadt",
    });
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body.ort.status).toBe("gefunden");
    expect(abrufe).toEqual([[46.2, 7.2]]);
    expect(suchen).toEqual(["Musterstadt"]);
  });

  test("ein unbekannter Ort ist «nicht gefunden»", async () => {
    suchAntwort = async () => [];
    const l = await neuesLager({ ort: "Ortohnetreffer" });
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body.ort).toEqual({ status: "nicht_gefunden", name: null });
    expect(a.body.tage).toEqual([]);
    expect(abrufe).toHaveLength(0);
  });

  test("ohne Lagerort: «kein_ort», keine Suche, kein Abruf", async () => {
    const l = await neuesLager();
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body).toEqual({
      ort: { status: "kein_ort", name: null },
      stand: null,
      tage: [],
    });
    expect(suchen).toHaveLength(0);
    expect(abrufe).toHaveLength(0);
  });

  test("von Hand gesetzte Koordinaten ohne Lagerort zählen nicht mehr", async () => {
    const l = await neuesLager();
    await db
      .update(schema.lager)
      .set({ breite: 47, laenge: 8 })
      .where(eq(schema.lager.id, l));
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body.ort.status).toBe("kein_ort");
    expect(abrufe).toHaveLength(0);
  });

  test("bestehende Koordinaten ohne Schlüssel werden aus dem Lagerort neu bestimmt", async () => {
    const l = await neuesLager({ ort: "Musterstadt" });
    await db
      .update(schema.lager)
      .set({ breite: 10, laenge: 10 })
      .where(eq(schema.lager.id, l));
    await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toEqual([[47.38, 8.54]]);
  });

  test("ändert sich der Lagerort, sucht der Server gleich neu und die Verwaltung zeigt den Stand", async () => {
    const l = await neuesLager({ ort: "Musterstadt" });
    await anfrage(konten.team, "GET", W(l));
    suchAntwort = async (name) => [
      treffer({ name, breite: 46.0021, laenge: 7.0049 }),
    ];
    const p = await anfrage(
      konten.abteilungsleitung,
      "PATCH",
      `${ADMIN}/${l}`,
      { ort: "Beispieldorf" },
    );
    expect(p.status).toBe(204);
    expect(suchen).toEqual(["Musterstadt", "Beispieldorf"]);
    const g = await anfrage(konten.abteilungsleitung, "GET", `${ADMIN}/${l}`);
    expect(g.body.wetterOrt).toEqual({
      status: "gefunden",
      name: "Beispieldorf, Kanton Beispiel",
    });
    // Das Wetter gilt dem neuen Ort
    await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toEqual([
      [47.38, 8.54],
      [46, 7],
    ]);
    // Ort leeren: kein Wetter mehr
    await anfrage(konten.abteilungsleitung, "PATCH", `${ADMIN}/${l}`, {
      ort: null,
    });
    const leer = await anfrage(konten.team, "GET", W(l));
    expect(leer.body.ort.status).toBe("kein_ort");
    expect(leer.body.tage).toEqual([]);
  });

  test("ändert sich nur die Postleitzahl der Adresse, sucht der Server neu; ein anderes Feld löst keine Suche aus", async () => {
    const l = await neuesLager({ ort: "Musterstadt", adresse: "Weg 1" });
    await anfrage(konten.team, "GET", W(l));
    await anfrage(konten.abteilungsleitung, "PATCH", `${ADMIN}/${l}`, {
      titel: "Anderer Titel",
    });
    expect(suchen).toHaveLength(1);
    await anfrage(konten.abteilungsleitung, "PATCH", `${ADMIN}/${l}`, {
      adresse: "Weg 1, 9999 Musterstadt",
    });
    expect(suchen).toHaveLength(2);
  });

  test("beim Anlegen mit Ort bestimmt der Server den Wetterort gleich", async () => {
    const a = await anfrage(konten.abteilungsleitung, "POST", ADMIN, {
      titel: "Neues Wetterlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      ort: "Musterstadt",
    });
    expect(a.status).toBe(201);
    const g = await anfrage(
      konten.abteilungsleitung,
      "GET",
      `${ADMIN}/${a.body.id}`,
    );
    expect(g.body.wetterOrt.status).toBe("gefunden");
  });

  test("ist der Ortsdienst nicht erreichbar: «nicht_erreichbar», höchstens ein Versuch je Viertelstunde, danach klappt es", async () => {
    suchAntwort = async () => {
      throw new Error(
        "https://geocoding-api.open-meteo.com/v1/search?name=Musterstadt",
      );
    };
    const l = await neuesLager({ ort: "Musterstadt" });
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      ort: { status: "nicht_erreichbar", name: null },
      stand: null,
      tage: [],
    });
    expect(JSON.stringify(a.body)).not.toContain("geocoding");
    await Promise.all([1, 2, 3].map(() => anfrage(konten.team, "GET", W(l))));
    expect(suchen).toHaveLength(1);
    await db
      .update(schema.lager)
      .set({
        wetterOrtVersuchAm: new Date(
          Date.now() - (NEUER_ORTSVERSUCH_MINUTEN + 1) * 60_000,
        ),
      })
      .where(eq(schema.lager.id, l));
    suchAntwort = async () => [treffer()];
    const b = await anfrage(konten.team, "GET", W(l));
    expect(suchen).toHaveLength(2);
    expect(b.body.ort.status).toBe("gefunden");
    expect(b.body.tage).toHaveLength(1);
  });
});

describe("Ortsname für den Dienst", () => {
  test("nur der Ortsname geht hinaus: ohne Ziffern, ohne Hausnummer, ohne Adresse", () => {
    expect(ortAnfrage("Musterstadt", null)).toMatchObject({
      namen: ["Musterstadt"],
      plz: null,
    });
    expect(
      ortAnfrage("9999 Musterstadt, Pfadiweg 7", "Hauptstrasse 3"),
    ).toMatchObject({ namen: ["Musterstadt"], plz: "9999" });
    // Die Postleitzahl der Adresse bleibt beim Server
    expect(
      ortAnfrage("Musterstadt", "Pfadiweg 7, 9991 Musterstadt"),
    ).toMatchObject({ namen: ["Musterstadt"], plz: "9991" });
    // Ohne Postleitzahl: erster und letzter Teil, nie ein Wort mit Ziffer
    expect(ortAnfrage("Pfadiheim 12, Musterstadt", null)?.namen).toEqual([
      "Pfadiheim",
      "Musterstadt",
    ]);
    // Nur eine Postleitzahl: der Dienst sucht nach ihr
    expect(ortAnfrage("9999", null)?.namen).toEqual(["9999"]);
    expect(ortAnfrage("  ", "Weg 1")).toBeNull();
    expect(ortAnfrage(null, "Weg 1")).toBeNull();
    expect(ortAnfrage("x".repeat(300), null)!.namen[0]).toHaveLength(100);
  });

  test("der Schlüssel ändert sich mit Ort und Postleitzahl, nicht mit der Grossschreibung", () => {
    const a = ortAnfrage("Musterstadt", null)!.schluessel;
    expect(ortAnfrage("MUSTERSTADT", null)!.schluessel).toBe(a);
    expect(ortAnfrage("Musterstadt", "Weg 1, 9999 Ort")!.schluessel).not.toBe(
      a,
    );
    expect(ortAnfrage("Beispieldorf", null)!.schluessel).not.toBe(a);
  });

  test("Auswahl: genauer Name vor Anfang des Namens, gleicher Ort zählt einmal, grosser Ort gewinnt klar", () => {
    const t = (p: Partial<OrtTreffer>) => treffer(p);
    // «Muster» findet beim Dienst auch «Musterstadt»; der genaue Name zählt
    const genau = waehleTreffer(
      [
        t({ name: "Musterstadtberg", bevoelkerung: 90_000 }),
        t({ name: "Musterstadt", bevoelkerung: 500, breite: 46, laenge: 7 }),
      ],
      "musterstadt",
      null,
    );
    expect(genau).toMatchObject({ art: "gefunden", treffer: { breite: 46 } });
    // Gemeinde und Siedlung derselben Stelle sind ein Ort
    expect(
      waehleTreffer(
        [t({}), t({ breite: 47.3769 + 0.02, bevoelkerung: 0 })],
        "Musterstadt",
        null,
      ).art,
    ).toBe("gefunden");
    // Dreimal so gross: eindeutig; weniger: nicht
    const weit = { breite: 46, laenge: 7 };
    expect(
      waehleTreffer(
        [t({ bevoelkerung: 3000 }), t({ ...weit, bevoelkerung: 1000 })],
        "Musterstadt",
        null,
      ).art,
    ).toBe("gefunden");
    expect(
      waehleTreffer(
        [t({ bevoelkerung: 2999 }), t({ ...weit, bevoelkerung: 1000 })],
        "Musterstadt",
        null,
      ).art,
    ).toBe("mehrdeutig");
    expect(waehleTreffer([], "Musterstadt", null).art).toBe("keiner");
  });
});

describe("Wetter und Zwischenspeicher", () => {
  test("ohne Ort kein Abruf und eine leere Antwort", async () => {
    const l = await neuesLager();
    const a = await anfrage(konten.team, "GET", W(l));
    expect(a.body).toEqual({
      ort: { status: "kein_ort", name: null },
      stand: null,
      tage: [],
    });
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
    expect(a.ort).toEqual({
      status: "gefunden",
      name: "Musterstadt, Kanton Beispiel",
    });
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
      .set({
        abgerufenAm: stunden(WETTER_STUNDEN + 0.1),
        versuchAm: stunden(WETTER_STUNDEN + 0.1),
      })
      .where(eq(schema.wetterCache.lagerId, l));
    antwort = async () => [tag("2041-06-02", { code: 61 })];
    const a = await anfrage(konten.team, "GET", W(l));
    expect(abrufe).toHaveLength(2);
    expect(a.body.tage[0]).toMatchObject({
      datum: "2041-06-02",
      zustand: "Regen",
    });
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
    expect(a.body.ort.status).toBe("gefunden");
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
      .set({ abgerufenAm: stunden(10), versuchAm: stunden(10) })
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
    suchAntwort = async () => [treffer({ breite: 10, laenge: 10 })];
    await anfrage(
      konten.abteilungsleitung,
      "PATCH",
      `/api/v1/admin/lager/${l}`,
      { ort: "Beispieldorf" },
    );
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
    const [lager] = await db
      .select()
      .from(schema.lager)
      .where(eq(schema.lager.id, l));
    const t0 = new Date("2041-06-01T08:00:00Z");
    const holen = vi.fn(async () => [tag("2041-06-01")]);
    const wetter = dienst(holen);
    await ladeWetter(db, lager!, wetter, t0);
    // Knapp unter der Frist: aus dem Speicher
    await ladeWetter(
      db,
      lager!,
      wetter,
      new Date(t0.getTime() + (WETTER_STUNDEN * 60 - 1) * 60_000),
    );
    expect(holen).toHaveBeenCalledTimes(1);
    // Ab der Frist: neu
    await ladeWetter(
      db,
      lager!,
      wetter,
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

  test("ohne eingespritzten Dienst geht nichts hinaus, solange das Lager keinen Ort hat; mit Ort nur der Ortsname und danach zwei Zahlen, jeweils zum festen Host", async () => {
    const f = vi.fn<
      (url: URL | string, init?: RequestInit) => Promise<Response>
    >(async (url) =>
      new URL(String(url)).host === "geocoding-api.open-meteo.com"
        ? Response.json({
            results: [
              {
                name: "Musterstadt",
                latitude: 47.3769,
                longitude: 8.5417,
                admin1: "Kanton Beispiel",
                population: 9000,
                postcodes: ["9999"],
              },
            ],
          })
        : Response.json(antwortKoerper),
    );
    vi.stubGlobal("fetch", f);
    const eigeneApp = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
    });
    const ohne = await neuesLager();
    const res = await eigeneApp.request(W(ohne), {
      headers: konten.team.headers,
    });
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    const l = await neuesLager({
      ort: "Musterstadt",
      adresse: "Pfadiweg 7, 9999 Musterstadt",
    });
    const mitOrt = await eigeneApp.request(W(l), {
      headers: konten.team.headers,
    });
    expect(mitOrt.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    const such = f.mock.calls[0]!;
    const u = new URL(String(such[0]));
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("geocoding-api.open-meteo.com");
    expect(u.pathname).toBe("/v1/search");
    // Genau diese Parameter: nur der Ortsname, nichts über Lager, Adresse, Personen oder Konto
    expect(Object.fromEntries(u.searchParams)).toEqual({
      name: "Musterstadt",
      count: "10",
      language: "de",
      countryCode: "CH",
      format: "json",
    });
    expect(such[1]?.redirect).toBe("error");
    expect(such[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(such[1]?.headers).toEqual({ accept: "application/json" });
    expect(such[1]?.body).toBeUndefined();
    expect(String(such[0])).not.toMatch(/Pfadiweg|9999|Wetterlager/);
    expect(new URL(String(f.mock.calls[1]![0])).host).toBe(
      "api.open-meteo.com",
    );
  });

  test("die Ortssuche wirft bei Fehlerstatus, Netzfehler, kaputtem oder falsch geformtem JSON und bei zu grosser Antwort", async () => {
    const stub = (res: Response | Error) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (res instanceof Error) throw res;
          return res;
        }),
      );
    stub(new Response("Fehler", { status: 500 }));
    await expect(sucheOpenMeteo("Musterstadt")).rejects.toThrow();
    stub(new Error("getaddrinfo ENOTFOUND"));
    await expect(sucheOpenMeteo("Musterstadt")).rejects.toThrow();
    stub(new Response("kein json"));
    await expect(sucheOpenMeteo("Musterstadt")).rejects.toThrow();
    stub(Response.json({ results: [{ name: "Ohne Lage" }] }));
    await expect(sucheOpenMeteo("Musterstadt")).rejects.toThrow();
    stub(new Response("x".repeat(70 * 1024)));
    await expect(sucheOpenMeteo("Musterstadt")).rejects.toThrow(/zu gross/);
    // Kein Treffer: Der Dienst lässt «results» weg
    stub(Response.json({ generationtime_ms: 0.2 }));
    expect(await sucheOpenMeteo("Ortohnetreffer")).toEqual([]);
  });
});
