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
import { and, eq } from "drizzle-orm";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { aufraeumenAb } from "../../src/lager/adressbuch.js";
import { addiereTage } from "../../src/lager/aggregate.js";
import { MAX_PUNKTE, listePruefer } from "../../src/lager/check.js";
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

let abfragen = 0;
const sql = postgres(API_URL, { debug: () => abfragen++ });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

// Feste Uhr (Zürcher Zeit: 12. Juni 2041, 10:00); die Rechnung des Checks kennt keine andere Zeit
const HEUTE = "2041-06-12";
let jetzt = new Date("2041-06-12T08:00:00Z");
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  jetzt: () => jetzt,
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

beforeEach(() => {
  jetzt = new Date("2041-06-12T08:00:00Z");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;

type Lager = Awaited<ReturnType<typeof neuesLager>>;

// Ein leeres Lager mit allen Mitgliedern: noch nichts, was ein Prüfer meldet. Datenbank direkt, nicht über die API
async function neuesLager(
  p: { status?: "aktiv" | "abgeschlossen"; bis?: string } = {},
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Checklager",
      von: p.bis ? addiereTage(p.bis, -14) : "2041-06-20",
      bis: p.bis ?? "2041-07-04",
      status: p.status ?? "aktiv",
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
  await db.insert(schema.lagerMitglied).values(
    MITGLIEDER.map(([persona, rolle]) => ({
      lagerId: id,
      personId: konten[persona].id!,
      rolle,
    })),
  );
  return { id };
}

// Ein Lager, das nichts meldet: Packliste und Notfall sind erfüllt
async function bereitesLager(p: Parameters<typeof neuesLager>[0] = {}) {
  const l = await neuesLager(p);
  await db.insert(schema.packlistePunkt).values({
    lagerId: l.id,
    lagerSeq: 0,
    abschnitt: "Kleider",
    text: "Schlafsack",
  });
  await db.insert(schema.notfallKontakt).values({
    lagerId: l.id,
    lagerSeq: 0,
    funktion: "Arzt",
    name: "Dr. Beispiel",
    telefon: "079 123 45 67",
  });
  return l;
}

const aufgabe = (
  l: Lager,
  titel: string,
  wer: LagerPersona | null,
  frist: string | null,
  extra: Partial<typeof schema.aufgabe.$inferInsert> = {},
) => ({
  lagerId: l.id,
  lagerSeq: 0,
  titel,
  verantwortlichPersonId: wer ? konten[wer].id! : null,
  frist,
  ...extra,
});

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
async function senden(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: {
      ...konto.headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const check = (l: Lager, p: LagerPersona) =>
  senden(konten[p], "GET", `/api/v1/lager/${l.id}/check`);
const punkte = (l: Lager, p: LagerPersona) =>
  senden(konten[p], "GET", `/api/v1/lager/${l.id}/check/punkte`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pruefer = (a: Antwort, id: string): any =>
  a.body.pruefer.find((p: { id: string }) => p.id === id);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codes = (p: any) =>
  p ? p.hinweise.map((h: { code: string }) => h.code) : null;
const ids = (a: Antwort) => a.body.pruefer.map((p: { id: string }) => p.id);

async function recht(
  l: Lager,
  rolle: "leitung" | "team" | "lesen",
  rechte: string[],
  erlaubt: boolean,
) {
  await db
    .insert(schema.lagerRolleRecht)
    .values(rechte.map((r) => ({ lagerId: l.id, rolle, recht: r, erlaubt })));
}

describe("Rechte", () => {
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const bearbeiten: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  test.each(LAGER_PERSONAS)("%s: Check lesen und Punkt anlegen", async (p) => {
    const l = await neuesLager();
    expect((await check(l, p)).status).toBe(lesen[p]);
    expect((await punkte(l, p)).status).toBe(lesen[p]);
    const neu = await senden(
      konten[p],
      "POST",
      `/api/v1/lager/${l.id}/check/punkte`,
      { titel: "Versicherung geklärt" },
    );
    expect(neu.status).toBe(bearbeiten[p]);
  });

  test("ein Lager einer fremden Abteilung ist 404, auch mit der Rolle dort", async () => {
    const l = await neuesLager();
    expect((await check(l, "fremdeAbteilung")).status).toBe(404);
  });

  test("ein abgeschlossenes Lager lässt sich lesen, aber nicht ändern", async () => {
    const l = await neuesLager({ status: "abgeschlossen" });
    expect((await check(l, "leitung")).status).toBe(200);
    const neu = await senden(
      konten.lagerleitung,
      "POST",
      `/api/v1/lager/${l.id}/check/punkte`,
      { titel: "X" },
    );
    expect(neu.status).toBe(409);
    expect(neu.body.code).toBe("LAGER_GESCHLOSSEN");
  });

  test("ohne check.lesen schreibt auch zeitplan.bearbeiten keine Punkte (403)", async () => {
    const l = await neuesLager();
    await recht(l, "leitung", ["check.lesen"], false);
    await recht(l, "leitung", ["zeitplan.bearbeiten"], true);
    expect((await check(l, "leitung")).status).toBe(403);
    const neu = await senden(
      konten.leitung,
      "POST",
      `/api/v1/lager/${l.id}/check/punkte`,
      { titel: "X" },
    );
    expect(neu.status).toBe(403);
  });

  test("das Team liest den Check, sobald die Lagerleitung es einstellt; schreiben bleibt verboten", async () => {
    const l = await neuesLager();
    expect((await check(l, "team")).status).toBe(403);
    await recht(l, "team", ["check.lesen"], true);
    expect((await check(l, "team")).status).toBe(200);
    expect((await punkte(l, "team")).status).toBe(200);
    const neu = await senden(
      konten.team,
      "POST",
      `/api/v1/lager/${l.id}/check/punkte`,
      { titel: "X" },
    );
    expect(neu.status).toBe(403);
  });
});

describe("Ergebnis je Rolle: nur, was die Rolle lesen darf", () => {
  test("Lagerleitung und Abteilungsleitung sehen alle sechs Prüfer", async () => {
    const l = await neuesLager();
    for (const p of ["lagerleitung", "abteilungsleitung"] as const) {
      expect(ids(await check(l, p))).toEqual([
        "aufgaben",
        "meilensteine",
        "packliste",
        "notfall",
        "adressbuch",
        "eigene",
      ]);
    }
    expect(listePruefer().map((x) => x.id)).toEqual([
      "aufgaben",
      "meilensteine",
      "packliste",
      "notfall",
      "adressbuch",
      "eigene",
    ]);
  });

  test("Leitung und Lesen sehen das Adressbuch nicht", async () => {
    const l = await neuesLager();
    for (const p of ["leitung", "lesen"] as const) {
      expect(ids(await check(l, p))).toEqual([
        "aufgaben",
        "meilensteine",
        "packliste",
        "notfall",
        "eigene",
      ]);
    }
  });

  test("das Team sieht ohne das Recht auf alle Aufgaben den Aufgaben-Prüfer nicht, und der Stand rechnet ihn nicht mit", async () => {
    const l = await bereitesLager();
    // Eine überfällige Aufgabe ohne Verantwortliche: Für die Lagerleitung ist das Lager nicht bereit
    await db
      .insert(schema.aufgabe)
      .values(aufgabe(l, "Zelte", null, addiereTage(HEUTE, -2)));
    expect((await check(l, "lagerleitung")).body.stand).toBe("offen");
    await recht(l, "team", ["check.lesen"], true);
    const a = await check(l, "team");
    expect(ids(a)).toEqual(["meilensteine", "packliste", "notfall", "eigene"]);
    expect(a.body.stand).toBe("bereit");
    expect(JSON.stringify(a.body)).not.toContain("Zelte");
  });

  test("ohne das Leserecht der Quelle fehlt der Prüfer", async () => {
    const l = await neuesLager();
    await recht(
      l,
      "leitung",
      ["packliste.lesen", "notfall.lesen", "zeitplan.lesen"],
      false,
    );
    expect(ids(await check(l, "leitung"))).toEqual(["aufgaben", "eigene"]);
  });

  test("ohne das Recht auf alle Aufgaben gibt es weder die Zahl der Aufgaben noch den Hinweis «überfällig»", async () => {
    const l = await bereitesLager();
    const [m] = await db
      .insert(schema.meilenstein)
      .values({
        lagerId: l.id,
        lagerSeq: 0,
        titel: "Anmeldeschluss",
        datum: addiereTage(HEUTE, -3),
      })
      .returning({ id: schema.meilenstein.id });
    await db.insert(schema.aufgabe).values(
      aufgabe(l, "Plakat", "team", addiereTage(HEUTE, -3), {
        fristMeilensteinId: m!.id,
        fristVersatzTage: 0,
      }),
    );
    // Mit beiden Rechten: überfällig, mit Zahl der offenen Aufgaben
    const voll = pruefer(await check(l, "leitung"), "meilensteine");
    expect(codes(voll)).toEqual(["MEILENSTEINE_UEBERFAELLIG"]);
    expect(voll.hinweise[0].beispiele[0]).toMatchObject({
      titel: "Anmeldeschluss",
      offeneAufgaben: 1,
    });
    // Ohne das Recht auf alle Aufgaben: kein Hinweis, keine Zahl
    await recht(
      l,
      "leitung",
      ["aufgaben.lesen_alle", "aufgaben.bearbeiten"],
      false,
    );
    const ohne = pruefer(await check(l, "leitung"), "meilensteine");
    expect(ohne.hinweise).toEqual([]);
    expect(ohne.stand).toBe("bereit");
  });
});

describe("Prüfer Aufgaben", () => {
  test("überfällig: nur offene Aufgaben mit Frist vor heute; Beispiele sind begrenzt, die Zahl vollständig", async () => {
    const l = await bereitesLager();
    await db.insert(schema.aufgabe).values([
      ...Array.from({ length: 7 }, (_, i) =>
        aufgabe(l, `Alt ${i}`, "team", addiereTage(HEUTE, -10 + i)),
      ),
      aufgabe(l, "Heute fällig", "team", HEUTE),
      aufgabe(l, "Später", "team", addiereTage(HEUTE, 1)),
      aufgabe(l, "Ohne Frist", "team", null),
      aufgabe(l, "Erledigt", "team", addiereTage(HEUTE, -20), {
        status: "erledigt",
        erledigtAm: new Date(),
      }),
    ]);
    const a = pruefer(await check(l, "lagerleitung"), "aufgaben");
    expect(a.stand).toBe("offen");
    expect(codes(a)).toEqual(["AUFGABEN_UEBERFAELLIG"]);
    const h = a.hinweise[0];
    expect(h).toMatchObject({ schwere: "offen", anzahl: 7 });
    expect(h.text).toBe("7 Aufgaben sind überfällig.");
    // Nach Frist geordnet, die ältesten zuerst
    expect(h.beispiele.map((b: { titel: string }) => b.titel)).toEqual([
      "Alt 0",
      "Alt 1",
      "Alt 2",
      "Alt 3",
      "Alt 4",
    ]);
    expect(h.beispiele[0].datum).toBe(addiereTage(HEUTE, -10));
  });

  test("ohne Verantwortliche: gesetzte Person oder Leitung des Ressorts genügt", async () => {
    const l = await bereitesLager();
    const [r] = await db
      .insert(schema.ressort)
      .values({
        lagerId: l.id,
        lagerSeq: 0,
        kuerzel: "kü",
        name: "Küche",
        leitungPersonId: konten.team.id!,
      })
      .returning({ id: schema.ressort.id });
    await db.insert(schema.aufgabe).values([
      aufgabe(l, "Ohne alles", null, null),
      aufgabe(l, "Mit Ressortleitung", null, null, { ressortId: r!.id }),
      aufgabe(l, "Mit Person", "team", null),
      aufgabe(l, "Erledigt ohne", null, null, {
        status: "erledigt",
        erledigtAm: new Date(),
      }),
    ]);
    const a = pruefer(await check(l, "lagerleitung"), "aufgaben");
    expect(codes(a)).toEqual(["AUFGABEN_OHNE_VERANTWORTLICHE"]);
    expect(a.hinweise[0]).toMatchObject({ anzahl: 1 });
    expect(a.hinweise[0].text).toBe(
      "1 offene Aufgabe hat keine Verantwortliche.",
    );
    expect(
      a.hinweise[0].beispiele.map((b: { titel: string }) => b.titel),
    ).toEqual(["Ohne alles"]);
  });

  test("die Zeit ist eingespritzt: derselbe Stand, anderer Tag, anderes Ergebnis (Zürcher Datum)", async () => {
    const l = await bereitesLager();
    await db
      .insert(schema.aufgabe)
      .values(aufgabe(l, "Material", "team", HEUTE));
    expect((await check(l, "lagerleitung")).body.stand).toBe("bereit");
    // Sommerzeit: 22:30 UTC ist in Zürich schon der nächste Tag, die Frist von gestern ist überfällig
    jetzt = new Date("2041-06-12T22:30:00Z");
    const a = await check(l, "lagerleitung");
    expect(a.body.datum).toBe("2041-06-13");
    expect(codes(pruefer(a, "aufgaben"))).toEqual(["AUFGABEN_UEBERFAELLIG"]);
  });
});

describe("Prüfer Meilensteine", () => {
  test("nah (nächste sieben Tage) ist ein Hinweis; weiter weg und vorbei ohne offene Aufgaben melden nichts", async () => {
    const l = await bereitesLager();
    await db.insert(schema.meilenstein).values(
      [
        ["Heute", HEUTE],
        ["In sieben Tagen", addiereTage(HEUTE, 7)],
        ["In acht Tagen", addiereTage(HEUTE, 8)],
        ["Gestern", addiereTage(HEUTE, -1)],
      ].map(([titel, datum]) => ({
        lagerId: l.id,
        lagerSeq: 0,
        titel: titel!,
        datum: datum!,
      })),
    );
    const a = await check(l, "lagerleitung");
    const m = pruefer(a, "meilensteine");
    expect(codes(m)).toEqual(["MEILENSTEINE_NAH"]);
    expect(m.hinweise[0]).toMatchObject({ schwere: "hinweis", anzahl: 2 });
    expect(
      m.hinweise[0].beispiele.map((b: { titel: string }) => b.titel),
    ).toEqual(["Heute", "In sieben Tagen"]);
    expect(m.stand).toBe("hinweise");
    // Nur Hinweise: der Gesamtstand ist «hinweise», nicht «offen»
    expect(a.body.stand).toBe("hinweise");
  });

  test("vorbei mit offenen Aufgaben am Meilenstein ist überfällig; erledigt die Aufgabe, ist es weg", async () => {
    const l = await bereitesLager();
    const [m] = await db
      .insert(schema.meilenstein)
      .values({
        lagerId: l.id,
        lagerSeq: 0,
        titel: "Anmeldeschluss",
        datum: addiereTage(HEUTE, -5),
      })
      .returning({ id: schema.meilenstein.id });
    const [a] = await db
      .insert(schema.aufgabe)
      .values(
        aufgabe(l, "Plakat", "team", addiereTage(HEUTE, -4), {
          fristMeilensteinId: m!.id,
          fristVersatzTage: 1,
        }),
      )
      .returning({ id: schema.aufgabe.id });
    const vorher = pruefer(await check(l, "lagerleitung"), "meilensteine");
    expect(codes(vorher)).toEqual(["MEILENSTEINE_UEBERFAELLIG"]);
    expect(vorher.stand).toBe("offen");
    await db
      .update(schema.aufgabe)
      .set({ status: "erledigt", erledigtAm: new Date() })
      .where(eq(schema.aufgabe.id, a!.id));
    expect(
      pruefer(await check(l, "lagerleitung"), "meilensteine").hinweise,
    ).toEqual([]);
  });
});

describe("Prüfer Packliste und Notfall", () => {
  test("leer: offen; mit einem Punkt beziehungsweise einem Kontakt mit Nummer: erfüllt", async () => {
    const l = await neuesLager();
    const leer = await check(l, "lagerleitung");
    expect(codes(pruefer(leer, "packliste"))).toEqual(["PACKLISTE_LEER"]);
    expect(codes(pruefer(leer, "notfall"))).toEqual(["NOTFALL_OHNE_KONTAKT"]);
    expect(leer.body.stand).toBe("offen");
    await db.insert(schema.packlistePunkt).values({
      lagerId: l.id,
      lagerSeq: 0,
      abschnitt: "Kleider",
      text: "Schlafsack",
    });
    await db.insert(schema.notfallKontakt).values({
      lagerId: l.id,
      lagerSeq: 0,
      funktion: "Arzt",
      name: "Dr. Beispiel",
      telefon: "079 123 45 67",
    });
    const voll = await check(l, "lagerleitung");
    expect(pruefer(voll, "packliste")).toMatchObject({
      stand: "bereit",
      hinweise: [],
    });
    expect(pruefer(voll, "notfall")).toMatchObject({
      stand: "bereit",
      hinweise: [],
    });
    expect(voll.body.stand).toBe("bereit");
  });
});

describe("Prüfer Adressbuch (Datenschutz)", () => {
  // Das Lager endete vor 170 Tagen: Der Lauf löscht in zehn Tagen
  const bisVor = (tage: number) => addiereTage(HEUTE, -tage);
  const kontakte = (l: Lager) =>
    ["A", "B"]
      .map((name) => ({ lagerId: l.id, lagerSeq: 0, name, behalten: false }))
      .concat([{ lagerId: l.id, lagerSeq: 0, name: "C", behalten: true }]);

  test("im Fenster der letzten 14 Tage vor der Aufräumfrist: Zahl der Kontakte ohne «behalten», nie ein Name", async () => {
    const l = await bereitesLager({ bis: bisVor(170) });
    await db.insert(schema.adressbuchKontakt).values(kontakte(l));
    expect(aufraeumenAb(bisVor(170))).toBe(addiereTage(HEUTE, 10));
    const a = pruefer(await check(l, "lagerleitung"), "adressbuch");
    expect(codes(a)).toEqual(["ADRESSBUCH_AUFRAEUMEN"]);
    expect(a.hinweise[0]).toMatchObject({ schwere: "hinweis", anzahl: 2 });
    expect(a.hinweise[0].text).toContain("22.06.2041");
    expect(a.stand).toBe("hinweise");
    expect(JSON.stringify(a)).not.toMatch(/"(A|B|C)"/);
  });

  test("Grenzen: 15 Tage vorher noch nichts, 14 Tage vorher ja, am Tag der Löschung nicht mehr", async () => {
    const frueh = await bereitesLager({ bis: bisVor(165) });
    await db.insert(schema.adressbuchKontakt).values(kontakte(frueh));
    expect(
      pruefer(await check(frueh, "lagerleitung"), "adressbuch").hinweise,
    ).toEqual([]);
    const genau = await bereitesLager({ bis: bisVor(166) });
    await db.insert(schema.adressbuchKontakt).values(kontakte(genau));
    expect(
      codes(pruefer(await check(genau, "lagerleitung"), "adressbuch")),
    ).toEqual(["ADRESSBUCH_AUFRAEUMEN"]);
    const spaet = await bereitesLager({ bis: bisVor(180) });
    await db.insert(schema.adressbuchKontakt).values(kontakte(spaet));
    expect(
      pruefer(await check(spaet, "lagerleitung"), "adressbuch").hinweise,
    ).toEqual([]);
  });

  test("alle Kontakte mit «behalten»: kein Hinweis", async () => {
    const l = await bereitesLager({ bis: bisVor(170) });
    await db
      .insert(schema.adressbuchKontakt)
      .values({ lagerId: l.id, lagerSeq: 0, name: "C", behalten: true });
    expect(
      pruefer(await check(l, "lagerleitung"), "adressbuch").hinweise,
    ).toEqual([]);
  });
});

describe("Eigene Check-Punkte", () => {
  const url = (l: Lager, rest = "") =>
    `/api/v1/lager/${l.id}/check/punkte${rest}`;

  test("anlegen, lesen, abhaken, löschen; der Prüfer folgt dem Haken", async () => {
    const l = await bereitesLager();
    const neu = await senden(konten.lagerleitung, "POST", url(l), {
      titel: "Versicherung geklärt",
    });
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({
      titel: "Versicherung geklärt",
      erledigt: false,
      reihenfolge: 0,
      version: 1,
    });
    const zweiter = await senden(konten.lagerleitung, "POST", url(l), {
      titel: "Kasse gezählt",
    });
    expect(zweiter.body.reihenfolge).toBe(1);

    const liste = await punkte(l, "leitung");
    expect(liste.body.punkte.map((p: { titel: string }) => p.titel)).toEqual([
      "Versicherung geklärt",
      "Kasse gezählt",
    ]);

    const offen = pruefer(await check(l, "leitung"), "eigene");
    expect(codes(offen)).toEqual(["EIGENE_OFFEN"]);
    expect(offen.hinweise[0]).toMatchObject({ anzahl: 2, schwere: "offen" });

    const haken = await senden(
      konten.lagerleitung,
      "PATCH",
      url(l, `/${neu.body.id}`),
      { version: 1, erledigt: true },
    );
    expect(haken.status).toBe(200);
    expect(haken.body).toMatchObject({ erledigt: true, version: 2 });
    expect(
      pruefer(await check(l, "leitung"), "eigene").hinweise[0].anzahl,
    ).toBe(1);

    const weg = await senden(
      konten.lagerleitung,
      "DELETE",
      url(l, `/${zweiter.body.id}?version=1`),
    );
    expect(weg.status).toBe(204);
    expect(pruefer(await check(l, "leitung"), "eigene")).toMatchObject({
      stand: "bereit",
      hinweise: [],
    });
    // Endgültig weg
    expect(
      await db
        .select()
        .from(schema.lagerCheckPunkt)
        .where(eq(schema.lagerCheckPunkt.id, zweiter.body.id)),
    ).toHaveLength(0);
  });

  test("Änderungen laufen über den Sync-Kern: Eintrag im Feed, veraltete Version ist 409", async () => {
    const l = await neuesLager();
    const neu = await senden(konten.lagerleitung, "POST", url(l), {
      titel: "A",
    });
    const feed = await db
      .select()
      .from(schema.lagerAenderung)
      .where(
        and(
          eq(schema.lagerAenderung.lagerId, l.id),
          eq(schema.lagerAenderung.tabelle, "lager_check_punkt"),
        ),
      );
    expect(feed).toMatchObject([{ art: "neu", zeileId: neu.body.id }]);
    await senden(konten.lagerleitung, "PATCH", url(l, `/${neu.body.id}`), {
      version: 1,
      titel: "B",
    });
    const alt = await senden(
      konten.lagerleitung,
      "PATCH",
      url(l, `/${neu.body.id}`),
      { version: 1, titel: "C" },
    );
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
    const altLoeschen = await senden(
      konten.lagerleitung,
      "DELETE",
      url(l, `/${neu.body.id}?version=1`),
    );
    expect(altLoeschen.status).toBe(409);
  });

  test("Eingaben: unbekannte Felder, leerer Titel, nichts zu ändern, zu langer Titel", async () => {
    const l = await neuesLager();
    const post = (body: unknown) =>
      senden(konten.lagerleitung, "POST", url(l), body);
    expect((await post({ titel: "A", erledigt: true })).status).toBe(400);
    expect((await post({ titel: "  " })).status).toBe(400);
    expect((await post({ titel: "x".repeat(201) })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const neu = await post({ titel: "A" });
    const patch = (body: unknown) =>
      senden(konten.lagerleitung, "PATCH", url(l, `/${neu.body.id}`), body);
    expect((await patch({ version: 1 })).status).toBe(400);
    expect((await patch({ version: 1, lagerId: l.id })).status).toBe(400);
    expect(
      (await senden(konten.lagerleitung, "DELETE", url(l, `/${neu.body.id}`)))
        .status,
    ).toBe(400);
  });

  test("höchstens 100 Punkte je Lager (409 LIMIT_ERREICHT)", async () => {
    const l = await neuesLager();
    await db.insert(schema.lagerCheckPunkt).values(
      Array.from({ length: MAX_PUNKTE }, (_, i) => ({
        lagerId: l.id,
        lagerSeq: 0,
        titel: `Punkt ${i}`,
        reihenfolge: i,
      })),
    );
    const r = await senden(konten.lagerleitung, "POST", url(l), {
      titel: "Zu viel",
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("LIMIT_ERREICHT");
  });

  test("ein Punkt eines anderen Lagers ist 404, auch in der eigenen Abteilung", async () => {
    const a = await neuesLager();
    const b = await neuesLager();
    const punkt = await senden(konten.lagerleitung, "POST", url(a), {
      titel: "A",
    });
    expect(
      (
        await senden(
          konten.lagerleitung,
          "PATCH",
          url(b, `/${punkt.body.id}`),
          {
            version: 1,
            titel: "X",
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await senden(
          konten.lagerleitung,
          "DELETE",
          url(b, `/${punkt.body.id}?version=1`),
        )
      ).status,
    ).toBe(404);
  });

  test("das Lager nimmt seine Punkte mit (Fremdschlüssel)", async () => {
    const l = await neuesLager();
    await senden(konten.lagerleitung, "POST", url(l), { titel: "A" });
    await db.delete(schema.lager).where(eq(schema.lager.id, l.id));
    expect(
      await db
        .select()
        .from(schema.lagerCheckPunkt)
        .where(eq(schema.lagerCheckPunkt.lagerId, l.id)),
    ).toHaveLength(0);
  });
});

describe("Gesamtstand und Determinismus", () => {
  test("ein Lager ohne Befund ist bereit; gleiche Daten und Zeit geben dasselbe Ergebnis", async () => {
    const l = await bereitesLager();
    await db
      .insert(schema.aufgabe)
      .values(aufgabe(l, "Material", "team", addiereTage(HEUTE, 3)));
    const a = await check(l, "lagerleitung");
    expect(a.body.stand).toBe("bereit");
    expect(a.body.datum).toBe(HEUTE);
    expect(
      a.body.pruefer.every((p: { stand: string }) => p.stand === "bereit"),
    ).toBe(true);
    expect((await check(l, "lagerleitung")).body).toEqual(a.body);
  });

  test("offen schlägt hinweise: ein nahes Meilenstein-Datum und eine überfällige Aufgabe zusammen", async () => {
    const l = await bereitesLager();
    await db.insert(schema.meilenstein).values({
      lagerId: l.id,
      lagerSeq: 0,
      titel: "Material bestellt",
      datum: addiereTage(HEUTE, 2),
    });
    expect((await check(l, "lagerleitung")).body.stand).toBe("hinweise");
    await db
      .insert(schema.aufgabe)
      .values(aufgabe(l, "Zelte", "team", addiereTage(HEUTE, -1)));
    expect((await check(l, "lagerleitung")).body.stand).toBe("offen");
  });
});

describe("Datenbanklast", () => {
  test("die Zahl der Abfragen hängt nicht von der Datenmenge ab und ist begrenzt", async () => {
    const l = await bereitesLager({ bis: addiereTage(HEUTE, -170) });
    const zaehle = async () => {
      const vor = abfragen;
      expect((await check(l, "lagerleitung")).status).toBe(200);
      return abfragen - vor;
    };
    await db.insert(schema.adressbuchKontakt).values({
      lagerId: l.id,
      lagerSeq: 0,
      name: "A",
    });
    await zaehle();
    const wenige = await zaehle();

    const [m] = await db
      .insert(schema.meilenstein)
      .values(
        Array.from({ length: 40 }, (_, i) => ({
          lagerId: l.id,
          lagerSeq: 0,
          titel: `M ${i}`,
          datum: addiereTage(HEUTE, i - 20),
        })),
      )
      .returning({ id: schema.meilenstein.id });
    await db.insert(schema.aufgabe).values(
      Array.from({ length: 150 }, (_, i) =>
        aufgabe(
          l,
          `Masse ${i}`,
          i % 3 ? "team" : null,
          addiereTage(HEUTE, -(i % 9)),
          {
            fristMeilensteinId: m!.id,
            fristVersatzTage: 0,
          },
        ),
      ),
    );
    await db.insert(schema.adressbuchKontakt).values(
      Array.from({ length: 80 }, (_, i) => ({
        lagerId: l.id,
        lagerSeq: 0,
        name: `K ${i}`,
      })),
    );
    await db.insert(schema.lagerCheckPunkt).values(
      Array.from({ length: 50 }, (_, i) => ({
        lagerId: l.id,
        lagerSeq: 0,
        titel: `P ${i}`,
        reihenfolge: i,
      })),
    );
    const viele = await zaehle();
    expect(viele).toBe(wenige);
    // Als Mass dient eine Route mit genau einer Abfrage (die eigenen Punkte): Anmeldung und Policy kosten alle Routen gleich viel. Der Rest gehört den Prüfern: Aufgaben 1, Meilensteine 1, Packliste 1, Notfall 2, Adressbuch 1, eigene Punkte 1
    const vor = abfragen;
    expect((await punkte(l, "lagerleitung")).status).toBe(200);
    const grundlast = abfragen - vor - 1;
    expect(viele - grundlast).toBe(7);
  });
});
