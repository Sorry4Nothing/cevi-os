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
import {
  addiereTage,
  datumInZuerich,
  tageBis,
} from "../../src/lager/aggregate.js";
import type { WetterTag } from "../../src/lager/wetter-openmeteo.js";
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

// Feste Uhr (Zürcher Zeit: 12. Juni 2041, 10:00) und eine Attrappe statt des Wetterdienstes: kein Netz, jeder Abruf wird gezählt
const HEUTE = "2041-06-12";
let jetzt = new Date("2041-06-12T08:00:00Z");
let wetterAbrufe = 0;
const wetterTag = (datum: string): WetterTag => ({
  datum,
  code: 1,
  tmax: 22,
  tmin: 12,
  regen: 0,
  boeen: 20,
});
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  jetzt: () => jetzt,
  wetter: async () => {
    wetterAbrufe++;
    return [wetterTag(HEUTE)];
  },
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

beforeEach(() => {
  jetzt = new Date("2041-06-12T08:00:00Z");
  wetterAbrufe = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;

type Lager = Awaited<ReturnType<typeof neuesLager>>;

// Ein Lager mit allem, was die Aggregate zeigen. Datenbank direkt, nicht über die API
async function neuesLager(
  p: { status?: "aktiv" | "abgeschlossen"; ort?: boolean } = {},
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Aggregatelager",
      von: "2041-06-20",
      bis: "2041-07-04",
      status: p.status ?? "aktiv",
      breite: p.ort ? 47.38 : undefined,
      laenge: p.ort ? 8.54 : undefined,
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
  const person = (p: LagerPersona) => konten[p].id!;

  const [abschnitt] = await db
    .insert(schema.tagesabschnitt)
    .values({ lagerId: id, name: "Tag", lagerSeq: 0 })
    .returning({ id: schema.tagesabschnitt.id });
  const tage = await db
    .insert(schema.lagertag)
    .values(
      [HEUTE, addiereTage(HEUTE, 2), addiereTage(HEUTE, 10)].map((datum) => ({
        lagerId: id,
        lagerSeq: 0,
        datum,
        label: `Tag ${datum}`,
      })),
    )
    .returning({ id: schema.lagertag.id, datum: schema.lagertag.datum });
  const tag = (datum: string) => tage.find((t) => t.datum === datum)!.id;

  const [seite] = await db
    .insert(schema.tagesseite)
    .values({
      lagerId: id,
      lagerSeq: 0,
      lagertagId: tag(HEUTE),
      notiz: "Ausflugstag",
    })
    .returning({ id: schema.tagesseite.id });
  await db.insert(schema.tagesseiteBlock).values({
    lagerId: id,
    lagerSeq: 0,
    seiteId: seite!.id,
    art: "wichtig",
    text: "Sonnencreme",
  });

  const [dienst] = await db
    .insert(schema.dienst)
    .values({
      lagerId: id,
      lagerSeq: 0,
      name: "Küche",
      tagesabschnittId: abschnitt!.id,
    })
    .returning({ id: schema.dienst.id });
  const schicht = (datum: string, p: LagerPersona) => ({
    lagerId: id,
    lagerSeq: 0,
    lagertagId: tag(datum),
    tagesabschnittId: abschnitt!.id,
    dienstId: dienst!.id,
    personId: person(p),
  });
  await db
    .insert(schema.schicht)
    .values([
      schicht(HEUTE, "team"),
      schicht(HEUTE, "leitung"),
      schicht(addiereTage(HEUTE, 2), "team"),
      schicht(addiereTage(HEUTE, 10), "team"),
    ]);

  await db.insert(schema.anwesenheit).values(
    (["lagerleitung", "team", "lesen"] as const).map((p) => ({
      lagerId: id,
      lagerSeq: 0,
      lagertagId: tag(HEUTE),
      tagesabschnittId: abschnitt!.id,
      personId: person(p),
      wert: "A" as const,
    })),
  );

  const hoeck = (
    art: "lagerleitung" | "team",
    datum: string,
    titel: string,
  ) => ({
    lagerId: id,
    lagerSeq: 0,
    art,
    datum,
    titel,
  });
  await db
    .insert(schema.hoeck)
    .values([
      hoeck("lagerleitung", HEUTE, "Leitungshöck"),
      hoeck("team", HEUTE, "Teamhöck"),
      hoeck("team", addiereTage(HEUTE, 3), "Später"),
      hoeck("lagerleitung", addiereTage(HEUTE, 9), "Zu spät"),
    ]);

  await db.insert(schema.meilenstein).values([
    {
      lagerId: id,
      lagerSeq: 0,
      titel: "Anmeldeschluss",
      datum: addiereTage(HEUTE, -5),
    },
    {
      lagerId: id,
      lagerSeq: 0,
      titel: "Material bestellt",
      datum: addiereTage(HEUTE, 4),
    },
  ]);

  const aufgabe = (
    titel: string,
    wer: LagerPersona,
    frist: string | null,
    extra: Partial<typeof schema.aufgabe.$inferInsert> = {},
  ) => ({
    lagerId: id,
    lagerSeq: 0,
    titel,
    verantwortlichPersonId: person(wer),
    frist,
    ...extra,
  });
  await db.insert(schema.aufgabe).values([
    aufgabe("Zelte", "lagerleitung", addiereTage(HEUTE, -2)),
    aufgabe("Küchenplan", "team", addiereTage(HEUTE, -5), {
      status: "erledigt",
      erledigtAm: new Date(),
    }),
    aufgabe("Material", "team", addiereTage(HEUTE, 3)),
    aufgabe("Wasser", "team", addiereTage(HEUTE, 20), { status: "laeuft" }),
    aufgabe("Ohne Frist", "team", null),
    aufgabe("Elternbrief", "leitung", addiereTage(HEUTE, 1)),
    aufgabe("Heutiges", "leitung", HEUTE),
  ]);
  return { id, abschnittId: abschnitt!.id, tag };
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
async function lies(konto: PersonaKonto, pfad: string): Promise<Antwort> {
  const res = await app.request(pfad, { headers: konto.headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const heute = (l: Lager, p: LagerPersona) =>
  lies(konten[p], `/api/v1/lager/${l.id}/heute`);
const woche = (l: Lager, p: LagerPersona) =>
  lies(konten[p], `/api/v1/lager/${l.id}/meine-woche`);
const start = (l: Lager, p: LagerPersona) =>
  lies(konten[p], `/api/v1/lager/${l.id}/start`);
const titel = (liste: { titel: string }[]) => liste.map((x) => x.titel).sort();

// Entzieht einer Rolle Rechte (Zeile in lager_rolle_recht)
async function entziehe(
  l: Lager,
  rolle: "leitung" | "team" | "lesen",
  rechte: string[],
) {
  await db
    .insert(schema.lagerRolleRecht)
    .values(
      rechte.map((recht) => ({ lagerId: l.id, rolle, recht, erlaubt: false })),
    );
}

describe("Hilfen für die Zeit", () => {
  test("Zürcher Datum, Tage addieren und zählen", () => {
    // Sommerzeit: 22:30 UTC ist schon der nächste Tag in Zürich
    expect(datumInZuerich(new Date("2041-06-11T22:30:00Z"))).toBe(HEUTE);
    expect(datumInZuerich(new Date("2041-12-31T23:30:00Z"))).toBe("2042-01-01");
    expect(addiereTage("2041-02-27", 2)).toBe("2041-03-01");
    expect(addiereTage(HEUTE, -12)).toBe("2041-05-31");
    expect(tageBis(HEUTE, "2041-06-20")).toBe(8);
    expect(tageBis("2041-06-20", HEUTE)).toBe(-8);
  });
});

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
  const nurLeitung: Record<LagerPersona, number> = {
    ...lesen,
    team: 403,
    lesen: 403,
  };
  test.each(LAGER_PERSONAS)("%s: Heute, Meine Woche, Start", async (p) => {
    const l = await neuesLager();
    expect((await heute(l, p)).status).toBe(lesen[p]);
    expect((await woche(l, p)).status).toBe(lesen[p]);
    expect((await start(l, p)).status).toBe(nurLeitung[p]);
  });

  test("ein Lager einer fremden Abteilung ist 404, auch mit der Rolle dort", async () => {
    const l = await neuesLager();
    expect((await heute(l, "fremdeAbteilung")).status).toBe(404);
  });

  test("ein abgeschlossenes Lager lässt sich lesen", async () => {
    const l = await neuesLager({ status: "abgeschlossen" });
    expect((await heute(l, "team")).status).toBe(200);
    expect((await start(l, "leitung")).status).toBe(200);
  });

  test("fehlt der Rolle jeder Teil, ist es 403; ein Teil genügt für 200", async () => {
    const l = await neuesLager();
    await entziehe(l, "team", ["wetter.lesen", "einteilung.lesen"]);
    // Team: Tagesseiten, Anwesenheit (alle) fehlen ohnehin; Höcks der Art team bleiben
    const a = await heute(l, "team");
    expect(a.status).toBe(200);
    expect(a.body.wetter).toBeNull();
    expect(a.body.schichten).toBeNull();
    expect(a.body.tagesseite).toBeNull();
    expect(a.body.anwesenheit).toBeNull();
    expect(titel(a.body.hoecks)).toEqual(["Teamhöck"]);
    await entziehe(l, "team", ["hoecks.team_lesen"]);
    expect((await heute(l, "team")).status).toBe(403);
    // Meine Woche: die eigenen Aufgaben (aufgaben.eigene) sind noch da
    expect((await woche(l, "team")).status).toBe(200);
    await entziehe(l, "team", ["aufgaben.eigene"]);
    expect((await woche(l, "team")).status).toBe(403);
  });
});

describe("Heute", () => {
  test("die Lagerleitung sieht alle Teile des Tages", async () => {
    const l = await neuesLager({ ort: true });
    const a = await heute(l, "lagerleitung");
    expect(a.status).toBe(200);
    expect(a.body.datum).toBe(HEUTE);
    expect(a.body.lagertag).toMatchObject({ id: l.tag(HEUTE), datum: HEUTE });
    expect(a.body.tagesseite.seite.notiz).toBe("Ausflugstag");
    expect(
      a.body.tagesseite.bloecke.map((b: { text: string }) => b.text),
    ).toEqual(["Sonnencreme"]);
    // Die Aufgaben mit Frist heute stehen in der Tagesseite
    expect(titel(a.body.tagesseite.aufgaben)).toEqual(["Heutiges"]);
    expect(a.body.wetter.tag).toMatchObject({ datum: HEUTE });
    expect(a.body.wetter.stand).not.toBeNull();
    // Zusammenfassung nur dieses Tages: drei Leitende anwesend
    expect(a.body.anwesenheit.zeilen).toEqual([
      expect.objectContaining({
        lagertagId: l.tag(HEUTE),
        wert: "A",
        leitende: 3,
        teilnehmende: 0,
      }),
    ]);
    // Nur die Schichten dieses Tages
    expect(a.body.schichten.dienste).toHaveLength(1);
    expect(a.body.schichten.schichten).toHaveLength(2);
    expect(titel(a.body.hoecks)).toEqual(["Leitungshöck", "Teamhöck"]);
    // Kein Notfall in den Aggregaten (gehört zu #393)
    expect(JSON.stringify(a.body)).not.toMatch(/notfall/i);
  });

  test("das Team sieht nur, was es lesen darf", async () => {
    const l = await neuesLager({ ort: true });
    const a = await heute(l, "team");
    expect(a.status).toBe(200);
    // Tagesseiten und Anwesenheit aller sind nicht Teil der Team-Rechte
    expect(a.body.tagesseite).toBeNull();
    expect(a.body.anwesenheit).toBeNull();
    expect(a.body.wetter.tag).toMatchObject({ datum: HEUTE });
    expect(a.body.schichten.schichten).toHaveLength(2);
    // Nur Team-Höcks und davon nur Datum, Zeit, Titel und Ort
    expect(a.body.hoecks).toHaveLength(1);
    expect(a.body.hoecks[0]).toMatchObject({ titel: "Teamhöck" });
    expect(a.body.hoecks[0]).not.toHaveProperty("art");
    expect(a.body.hoecks[0]).not.toHaveProperty("gaeste");
    expect(JSON.stringify(a.body)).not.toContain("Ausflugstag");
    expect(JSON.stringify(a.body)).not.toContain("Leitungshöck");
  });

  test("Lesen sieht Tagesseite, Anwesenheit, alle Höcks und die Aufgaben des Tages", async () => {
    const l = await neuesLager();
    const a = await heute(l, "lesen");
    expect(a.body.tagesseite.seite.notiz).toBe("Ausflugstag");
    expect(a.body.anwesenheit.zeilen).toHaveLength(1);
    expect(titel(a.body.hoecks)).toEqual(["Leitungshöck", "Teamhöck"]);
    // «Lesen» hat aufgaben.lesen_alle: die Aufgabe des Tages gehört dazu
    expect(titel(a.body.tagesseite.aufgaben)).toEqual(["Heutiges"]);
  });

  test("ohne Ort kein Wetter und kein Abruf; ein Tag ohne Lagertag zeigt die übrigen Teile", async () => {
    const l = await neuesLager();
    const a = await heute(l, "lagerleitung");
    expect(a.body.wetter).toEqual({ tag: null, stand: null });
    expect(wetterAbrufe).toBe(0);
    jetzt = new Date("2041-06-13T08:00:00Z");
    const b = await heute(l, "lagerleitung");
    expect(b.body.lagertag).toBeNull();
    expect(b.body.tagesseite).toBeNull();
    expect(b.body.anwesenheit).toEqual({ zeilen: [] });
    expect(b.body.schichten).toEqual({
      dienste: expect.any(Array),
      schichten: [],
    });
    expect(b.body.hoecks).toEqual([]);
  });

  test("das Wetter wird höchstens einmal abgerufen, auch mit Tagesseite", async () => {
    const l = await neuesLager({ ort: true });
    await heute(l, "lagerleitung");
    await heute(l, "team");
    await heute(l, "lesen");
    expect(wetterAbrufe).toBe(1);
  });

  test("die Uhr ist Zürcher Zeit", async () => {
    const l = await neuesLager();
    jetzt = new Date("2041-06-11T22:30:00Z");
    expect((await heute(l, "lagerleitung")).body.datum).toBe(HEUTE);
  });
});

describe("Meine Woche", () => {
  test("das Team sieht nur Eigenes", async () => {
    const l = await neuesLager();
    const a = await woche(l, "team");
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ von: HEUTE, bis: "2041-06-18" });
    // Offen, eigene, Frist bis Ende der Woche (auch Überfälliges); nicht: erledigt, später, ohne Frist, fremde
    expect(titel(a.body.aufgaben)).toEqual(["Material"]);
    // Eigene Schichten der Woche: heute und in zwei Tagen, nicht in zehn Tagen, nicht die der Leitung
    expect(
      a.body.schichten.map((s: { datum: string }) => s.datum).sort(),
    ).toEqual([HEUTE, addiereTage(HEUTE, 2)]);
    expect(a.body.schichten[0].dienst).toMatchObject({ name: "Küche" });
    expect(
      a.body.schichten.every(
        (s: { personId: string }) => s.personId === konten.team.id,
      ),
    ).toBe(true);
    // Team-Höcks der Woche, reduziert
    expect(titel(a.body.hoecks)).toEqual(["Später", "Teamhöck"]);
    expect(a.body.hoecks[0]).not.toHaveProperty("art");
  });

  test("auch mit dem Recht auf alle Aufgaben nur die eigenen, mit Überfälligem", async () => {
    const l = await neuesLager();
    expect(titel((await woche(l, "lagerleitung")).body.aufgaben)).toEqual([
      "Zelte",
    ]);
    expect(titel((await woche(l, "leitung")).body.aufgaben)).toEqual([
      "Elternbrief",
      "Heutiges",
    ]);
    const a = await woche(l, "lagerleitung");
    expect(titel(a.body.hoecks)).toEqual([
      "Leitungshöck",
      "Später",
      "Teamhöck",
    ]);
  });

  test("Teile ohne Recht sind null", async () => {
    const l = await neuesLager();
    await entziehe(l, "lesen", ["aufgaben.eigene", "einteilung.lesen"]);
    // «lesen» hat aufgaben.lesen_alle: Aufgaben bleiben, Schichten fallen weg
    const a = await woche(l, "lesen");
    expect(a.body.schichten).toBeNull();
    expect(a.body.aufgaben).not.toBeNull();
    await entziehe(l, "team", ["aufgaben.eigene", "einteilung.lesen"]);
    const t = await woche(l, "team");
    expect(t.body.aufgaben).toBeNull();
    expect(t.body.schichten).toBeNull();
    expect(t.body.hoecks).toHaveLength(2);
  });

  test("die Woche rückt mit der Uhr", async () => {
    const l = await neuesLager();
    jetzt = new Date("2041-06-14T08:00:00Z");
    const a = await woche(l, "team");
    expect(a.body).toMatchObject({ von: "2041-06-14", bis: "2041-06-20" });
    // Die Schicht von heute (12.) fällt weg, die vom 14. bleibt
    expect(a.body.schichten.map((s: { datum: string }) => s.datum)).toEqual([
      "2041-06-14",
    ]);
  });
});

describe("Start", () => {
  test("Countdown, Fortschritt, überfällige und eigene Aufgaben", async () => {
    const l = await neuesLager();
    const a = await start(l, "lagerleitung");
    expect(a.status).toBe(200);
    expect(a.body.countdown).toEqual({
      von: "2041-06-20",
      bis: "2041-07-04",
      tageBisBeginn: 8,
      tageBisEnde: 22,
    });
    expect(a.body.fortschritt.aufgaben).toEqual({
      gesamt: 7,
      erledigt: 1,
      ueberfaellig: 1,
    });
    expect(a.body.fortschritt.meilensteine).toMatchObject({
      gesamt: 2,
      vergangen: 1,
      naechster: { titel: "Material bestellt" },
    });
    expect(titel(a.body.ueberfaellig)).toEqual(["Zelte"]);
    expect(titel(a.body.eigene)).toEqual(["Zelte"]);
  });

  test("der Countdown wird negativ, sobald das Lager läuft", async () => {
    const l = await neuesLager();
    jetzt = new Date("2041-06-25T08:00:00Z");
    const a = await start(l, "lagerleitung");
    expect(a.body.countdown).toMatchObject({
      tageBisBeginn: -5,
      tageBisEnde: 9,
    });
  });

  test("die Leitung sieht alle Aufgaben; ohne das Recht nur ihre eigenen", async () => {
    const l = await neuesLager();
    const alle = await start(l, "leitung");
    expect(alle.body.fortschritt.aufgaben.gesamt).toBe(7);
    expect(titel(alle.body.ueberfaellig)).toEqual(["Zelte"]);
    expect(titel(alle.body.eigene)).toEqual(["Elternbrief", "Heutiges"]);
    await entziehe(l, "leitung", [
      "aufgaben.lesen_alle",
      "aufgaben.bearbeiten",
      "zeitplan.lesen",
    ]);
    const eigene = await start(l, "leitung");
    expect(eigene.status).toBe(200);
    expect(eigene.body.fortschritt.aufgaben).toEqual({
      gesamt: 2,
      erledigt: 0,
      ueberfaellig: 0,
    });
    expect(eigene.body.ueberfaellig).toEqual([]);
    expect(titel(eigene.body.eigene)).toEqual(["Elternbrief", "Heutiges"]);
    // Ohne zeitplan.lesen keine Meilensteine
    expect(eigene.body.fortschritt.meilensteine).toBeNull();
    expect(eigene.body.countdown.tageBisBeginn).toBe(8);
  });

  test("ohne Leserecht auf Aufgaben sind deren Teile null", async () => {
    const l = await neuesLager();
    await entziehe(l, "leitung", [
      "aufgaben.lesen_alle",
      "aufgaben.bearbeiten",
      "aufgaben.eigene",
    ]);
    const a = await start(l, "leitung");
    expect(a.body.fortschritt.aufgaben).toBeNull();
    expect(a.body.ueberfaellig).toBeNull();
    expect(a.body.eigene).toBeNull();
  });
});

describe("Datenbanklast", () => {
  test("die Zahl der Abfragen hängt nicht von der Datenmenge ab", async () => {
    const l = await neuesLager({ ort: true });
    const zaehle = async (pfad: string, p: LagerPersona) => {
      const vor = abfragen;
      expect((await lies(konten[p], pfad)).status).toBe(200);
      return abfragen - vor;
    };
    const pfade = (["heute", "meine-woche", "start"] as const).map(
      (teil) => `/api/v1/lager/${l.id}/${teil}`,
    );
    // Einmal warm laufen lassen: Der Wetterabruf und sein Zwischenspeicher zählen sonst mit
    for (const pfad of pfade) await zaehle(pfad, "lagerleitung");
    const wenige = [];
    for (const pfad of pfade) wenige.push(await zaehle(pfad, "lagerleitung"));

    await db.insert(schema.aufgabe).values(
      Array.from({ length: 60 }, (_, i) => ({
        lagerId: l.id,
        lagerSeq: 0,
        titel: `Masse ${i}`,
        verantwortlichPersonId: konten.lagerleitung.id!,
        frist: i % 2 ? HEUTE : addiereTage(HEUTE, -1),
      })),
    );
    await db.insert(schema.hoeck).values(
      Array.from({ length: 40 }, (_, i) => ({
        lagerId: l.id,
        lagerSeq: 0,
        art: "team" as const,
        datum: HEUTE,
        titel: `Masse ${i}`,
      })),
    );
    await db.insert(schema.meilenstein).values(
      Array.from({ length: 30 }, (_, i) => ({
        lagerId: l.id,
        lagerSeq: 0,
        titel: `Masse ${i}`,
        datum: addiereTage(HEUTE, i),
      })),
    );
    const viele = [];
    for (const pfad of pfade) viele.push(await zaehle(pfad, "lagerleitung"));

    expect(viele).toEqual(wenige);
    // Gemessen: Policy 4 (Sitzung, Konto, Lager mit Rolle, Rechte) plus Heute 9, Meine Woche 4, Start 6
    const [h, w, s] = viele as [number, number, number];
    expect(h).toBeLessThanOrEqual(13);
    expect(w).toBeLessThanOrEqual(8);
    expect(s).toBeLessThanOrEqual(10);
  });
});
