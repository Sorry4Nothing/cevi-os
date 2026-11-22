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
import { MAX_BLOECKE } from "../../src/lager/tagesseiten.js";
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

// Jede Anweisung an die Datenbank bleibt im Protokoll: Der Test der Datenbanklast zählt sie
const protokoll: string[] = [];
const sql = postgres(API_URL, {
  debug: (_verbindung, abfrage) => {
    protokoll.push(String(abfrage));
  },
});
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

// Eine Attrappe statt des Wetterdienstes: Kein Netz
let abrufe: [number, number][] = [];
let wetterTage: WetterTag[] = [];
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  wetter: async (breite, laenge) => {
    abrufe.push([breite, laenge]);
    return wetterTage;
  },
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let fremdLagerId: string;

beforeEach(() => {
  abrufe = [];
  wetterTage = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const MITGLIEDER = [
  ["lagerleitung", "lagerleitung"],
  ["leitung", "leitung"],
  ["team", "team"],
  ["lesen", "lesen"],
] as const;

async function neuesLager(
  p: {
    abteilungId?: string;
    status?: "aktiv" | "abgeschlossen";
    breite?: number;
    laenge?: number;
  } = {},
) {
  const abteilungId = p.abteilungId ?? welt.testabteilungId;
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Tageslager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status: p.status ?? "aktiv",
      breite: p.breite,
      laenge: p.laenge,
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
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await neuesLager();
  geschlossenId = await neuesLager({ status: "abgeschlossen" });
  fremdLagerId = await neuesLager({ abteilungId: welt.demoAbteilungId });
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

const T = (id = lagerId) => `/api/v1/lager/${id}/tagesseiten`;
const leiter = () => konten.leitung;

let datumZaehler = 0;
// Ein Lagertag direkt in der Datenbank (je Aufruf ein anderes Datum)
async function neuerTag(id = lagerId, datum?: string) {
  const [t] = await db
    .insert(schema.lagertag)
    .values({
      lagerId: id,
      datum:
        datum ??
        new Date(Date.UTC(2041, 0, 1 + datumZaehler++))
          .toISOString()
          .slice(0, 10),
      lagerSeq: 0,
    })
    .returning({ id: schema.lagertag.id, datum: schema.lagertag.datum });
  return t!;
}
async function mitglied(lager = lagerId) {
  const [p] = await db
    .insert(schema.user)
    .values({
      name: "Mitglied Test",
      email: `${randomUUID()}@example.org`,
      username: `m.${randomUUID().slice(0, 8)}`,
      abteilungId: welt.testabteilungId,
      mussPasswortAendern: false,
    })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId: lager, personId: p!.id, rolle: "team" });
  return p!.id;
}
async function datei(id = lagerId) {
  const [d] = await db
    .insert(schema.lagerDatei)
    .values({
      lagerId: id,
      anzeigename: "Programm",
      link: `https://beispiel.example.org/${randomUUID()}`,
      lagerSeq: 0,
    })
    .returning({ id: schema.lagerDatei.id });
  return d!.id;
}

describe("Rechte je Lager-Persona", () => {
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
  const schreiben = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: erfolg,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });

  test.each(LAGER_PERSONAS)("%s: Tage lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", T())).status).toBe(lesen[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Tagesseite lesen", async (p) => {
    const tag = await neuerTag();
    expect((await anfrage(konten[p], "GET", `${T()}/${tag.id}`)).status).toBe(
      lesen[p],
    );
  });
  test.each(LAGER_PERSONAS)("%s: Seite anlegen", async (p) => {
    const tag = await neuerTag();
    const a = await anfrage(konten[p], "POST", `${T()}/${tag.id}`, {});
    expect(a.status).toBe(schreiben(201)[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Block anlegen", async (p) => {
    const tag = await neuerTag();
    const a = await anfrage(konten[p], "POST", `${T()}/${tag.id}/bloecke`, {
      art: "wichtig",
      text: "Hinweis",
    });
    expect(a.status).toBe(schreiben(201)[p]);
  });
  test.each(LAGER_PERSONAS)("%s: im geschlossenen Lager", async (p) => {
    const tag = await neuerTag(geschlossenId);
    const a = await anfrage(
      konten[p],
      "POST",
      `${T(geschlossenId)}/${tag.id}/bloecke`,
      { art: "wichtig", text: "Hinweis" },
    );
    expect(a.status).toBe(schreiben(409)[p]);
  });
  test("Lesen im geschlossenen Lager geht", async () => {
    const tag = await neuerTag(geschlossenId);
    expect(
      (await anfrage(leiter(), "GET", `${T(geschlossenId)}/${tag.id}`)).status,
    ).toBe(200);
  });
  test("ein Tag eines fremden Lagers ist 404, auch mit dem Pfad des eigenen", async () => {
    const fremd = await neuerTag(fremdLagerId);
    expect((await anfrage(leiter(), "GET", `${T()}/${fremd.id}`)).status).toBe(
      404,
    );
    expect(
      (await anfrage(leiter(), "POST", `${T()}/${fremd.id}`, {})).status,
    ).toBe(404);
    expect(
      (
        await anfrage(leiter(), "POST", `${T()}/${fremd.id}/bloecke`, {
          art: "idee",
          text: "X",
        })
      ).status,
    ).toBe(404);
    expect(
      await db
        .select()
        .from(schema.tagesseite)
        .where(eq(schema.tagesseite.lagertagId, fremd.id)),
    ).toHaveLength(0);
  });
  test("ein gelöschter Tag ist 404", async () => {
    const tag = await neuerTag();
    await db.delete(schema.lagertag).where(eq(schema.lagertag.id, tag.id));
    expect((await anfrage(leiter(), "GET", `${T()}/${tag.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
          art: "idee",
          text: "X",
        })
      ).status,
    ).toBe(404);
  });
});

describe("Seite", () => {
  test("anlegen mit Tageschef und Notiz, lesen mit aufgelöstem Namen, Liste", async () => {
    const tag = await neuerTag();
    const chef = await mitglied();
    const neu = await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {
      tageschefPersonId: chef,
      notiz: "Treffpunkt beim Zelt",
    });
    expect(neu.status).toBe(201);
    expect(neu.body).toMatchObject({
      lagertagId: tag.id,
      tageschefPersonId: chef,
      notiz: "Treffpunkt beim Zelt",
      version: 1,
    });
    const tagesseite = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(tagesseite.status).toBe(200);
    expect(tagesseite.body.seite.tageschef).toMatchObject({
      id: chef,
      name: "Mitglied Test",
    });
    expect(tagesseite.body.lagertag).toEqual({
      id: tag.id,
      datum: tag.datum,
      label: null,
    });
    expect(tagesseite.body.bloecke).toEqual([]);
    const liste = await anfrage(leiter(), "GET", T());
    const zeile = liste.body.tage.find(
      (t: { lagertagId: string }) => t.lagertagId === tag.id,
    );
    expect(zeile.seite.tageschef.id).toBe(chef);
    // Ein Tag ohne Seite steht mit seite null in der Liste
    const leer = await neuerTag();
    const nachher = await anfrage(leiter(), "GET", T());
    expect(
      nachher.body.tage.find(
        (t: { lagertagId: string }) => t.lagertagId === leer.id,
      ).seite,
    ).toBeNull();
  });

  test("ein Tag hat höchstens eine Seite", async () => {
    const tag = await neuerTag();
    expect(
      (await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {})).status,
    ).toBe(201);
    const zweite = await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {});
    expect(zweite.status).toBe(409);
    expect(zweite.body.code).toBe("SEITE_VORHANDEN");
  });

  test("der Tageschef muss Mitglied dieses Lagers sein", async () => {
    const tag = await neuerTag();
    const fremdesMitglied = await mitglied(fremdLagerId);
    const a = await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {
      tageschefPersonId: fremdesMitglied,
    });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("KEIN_MITGLIED");
    const unbekannt = await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {
      tageschefPersonId: randomUUID(),
    });
    expect(unbekannt.body.code).toBe("KEIN_MITGLIED");
    // Auch beim Ändern
    const seite = await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {});
    const b = await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, {
      version: seite.body.version,
      tageschefPersonId: fremdesMitglied,
    });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("KEIN_MITGLIED");
  });

  test("ändern zählt die Version, null leert, eine veraltete Version ist ein Konflikt", async () => {
    const tag = await neuerTag();
    const chef = await mitglied();
    const seite = await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {
      tageschefPersonId: chef,
    });
    const a = await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, {
      version: 1,
      notiz: "Neu",
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ version: 2, notiz: "Neu" });
    const b = await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, {
      version: 2,
      tageschefPersonId: null,
    });
    expect(b.body).toMatchObject({ version: 3, tageschefPersonId: null });
    const konflikt = await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, {
      version: 1,
      notiz: "Alt",
    });
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
    expect(seite.body.id).toBeDefined();
    // Der Feed kennt die Seite
    const feed = await db
      .select()
      .from(schema.lagerAenderung)
      .where(
        and(
          eq(schema.lagerAenderung.lagerId, lagerId),
          eq(schema.lagerAenderung.zeileId, seite.body.id),
        ),
      );
    expect(feed.map((f) => f.art)).toEqual(["neu", "geaendert", "geaendert"]);
  });

  test("ohne Seite ist Ändern 404, leere und unbekannte Felder sind 400", async () => {
    const tag = await neuerTag();
    expect(
      (
        await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, {
          version: 1,
          notiz: "X",
        })
      ).status,
    ).toBe(404);
    await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {});
    expect(
      (await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, { version: 1 }))
        .status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${T()}/${tag.id}`, {
          version: 1,
          lagertagId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "POST", `${T()}/${(await neuerTag()).id}`, {
          notiz: "x".repeat(5001),
        })
      ).status,
    ).toBe(400);
  });

  test("verlässt der Tageschef das Lager, bleibt die Seite ohne Tageschef", async () => {
    const tag = await neuerTag();
    const chef = await mitglied();
    await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {
      tageschefPersonId: chef,
    });
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, chef),
        ),
      );
    const a = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(a.body.seite.tageschefPersonId).toBeNull();
    expect(a.body.seite.tageschef).toBeNull();
  });
});

describe("Blöcke", () => {
  test("der erste Block legt die Seite an, die Reihenfolge läuft weiter", async () => {
    const tag = await neuerTag();
    const a = await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
      art: "wichtig",
      text: "Gewitter möglich",
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      art: "wichtig",
      text: "Gewitter möglich",
      dateiId: null,
      reihenfolge: 0,
      version: 1,
    });
    const b = await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
      art: "idee",
      text: "Singen am Feuer",
    });
    expect(b.body.reihenfolge).toBe(1);
    const c = await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
      art: "idee",
      text: "Vorn",
      reihenfolge: 0,
    });
    const seite = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(seite.body.seite).not.toBeNull();
    // Nach Reihenfolge, dann ID (die ältere zuerst)
    expect(seite.body.bloecke.map((x: { id: string }) => x.id)).toEqual([
      a.body.id,
      c.body.id,
      b.body.id,
    ]);
    // Ein zweiter Block legt keine zweite Seite an
    expect(
      await db
        .select()
        .from(schema.tagesseite)
        .where(eq(schema.tagesseite.lagertagId, tag.id)),
    ).toHaveLength(1);
  });

  test("Art und Datei gehören zusammen: Programmbild nur mit Datei aus diesem Lager", async () => {
    const tag = await neuerTag();
    const url = `${T()}/${tag.id}/bloecke`;
    const ohne = await anfrage(leiter(), "POST", url, {
      art: "programmbild",
      text: "Plan",
    });
    expect(ohne.status).toBe(400);
    const zuviel = await anfrage(leiter(), "POST", url, {
      art: "wichtig",
      text: "Plan",
      dateiId: await datei(),
    });
    expect(zuviel.status).toBe(400);
    const fremd = await anfrage(leiter(), "POST", url, {
      art: "programmbild",
      text: "Plan",
      dateiId: await datei(fremdLagerId),
    });
    expect(fremd.status).toBe(400);
    const unbekannt = await anfrage(leiter(), "POST", url, {
      art: "programmbild",
      text: "Plan",
      dateiId: randomUUID(),
    });
    expect(unbekannt.status).toBe(400);
    const dateiId = await datei();
    const ok = await anfrage(leiter(), "POST", url, {
      art: "programmbild",
      text: "Tagesplan",
      dateiId,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.dateiId).toBe(dateiId);
    // Die Seite zeigt die Verknüpfung auf die Datei
    const seite = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(seite.body.bloecke[0].datei).toMatchObject({
      id: dateiId,
      anzeigename: "Programm",
    });
    // Unbekannte Art und fremde Felder
    for (const body of [
      { art: "todo", text: "X" },
      { art: "besprechen", text: "X" },
      { art: "idee", text: "X", erledigt: true },
      { art: "idee", text: "" },
      { art: "idee", text: "x".repeat(1001) },
    ]) {
      expect((await anfrage(leiter(), "POST", url, body)).status).toBe(400);
    }
  });

  test("das Programmbild hält den Eintrag in lager_datei", async () => {
    const tag = await neuerTag();
    const dateiId = await datei();
    await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
      art: "programmbild",
      text: "Plan",
      dateiId,
    });
    await expect(
      db.delete(schema.lagerDatei).where(eq(schema.lagerDatei.id, dateiId)),
    ).rejects.toThrow();
  });

  test("ändern und löschen mit Version; der gelöschte Block verschwindet", async () => {
    const tag = await neuerTag();
    const block = (
      await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
        art: "idee",
        text: "Alt",
      })
    ).body;
    const url = `${T()}/${tag.id}/bloecke/${block.id}`;
    const a = await anfrage(leiter(), "PATCH", url, {
      version: 1,
      text: "Neu",
      reihenfolge: 5,
    });
    expect(a.body).toMatchObject({ version: 2, text: "Neu", reihenfolge: 5 });
    // Art und Datei lassen sich nicht ändern
    for (const body of [
      { version: 2, art: "wichtig" },
      { version: 2, dateiId: randomUUID() },
      { version: 2 },
    ]) {
      expect((await anfrage(leiter(), "PATCH", url, body)).status).toBe(400);
    }
    const konflikt = await anfrage(leiter(), "PATCH", url, {
      version: 1,
      text: "X",
    });
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
    expect((await anfrage(leiter(), "DELETE", `${url}?version=1`)).status).toBe(
      409,
    );
    expect((await anfrage(leiter(), "DELETE", `${url}?version=2`)).status).toBe(
      204,
    );
    const seite = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(seite.body.bloecke).toEqual([]);
    // Endgültig: die Zeile ist weg
    expect(
      await db.$count(
        schema.tagesseiteBlock,
        eq(schema.tagesseiteBlock.id, block.id),
      ),
    ).toBe(0);
    expect((await anfrage(leiter(), "DELETE", `${url}?version=3`)).status).toBe(
      404,
    );
    expect(
      (await anfrage(leiter(), "PATCH", url, { version: 3, text: "X" })).status,
    ).toBe(404);
  });

  test("ein Block gehört nur zu seinem Tag", async () => {
    const tagA = await neuerTag();
    const tagB = await neuerTag();
    const block = (
      await anfrage(leiter(), "POST", `${T()}/${tagA.id}/bloecke`, {
        art: "idee",
        text: "A",
      })
    ).body;
    const falsch = `${T()}/${tagB.id}/bloecke/${block.id}`;
    expect(
      (await anfrage(leiter(), "PATCH", falsch, { version: 1, text: "X" }))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(leiter(), "DELETE", `${falsch}?version=1`)).status,
    ).toBe(404);
  });

  test("höchstens 100 Blöcke je Seite", async () => {
    const tag = await neuerTag();
    const seite = (await anfrage(leiter(), "POST", `${T()}/${tag.id}`, {}))
      .body;
    await db.insert(schema.tagesseiteBlock).values(
      Array.from({ length: MAX_BLOECKE }, (_, i) => ({
        lagerId,
        seiteId: seite.id as string,
        art: "idee" as const,
        text: `Idee ${i}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    );
    const a = await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
      art: "idee",
      text: "Eine zu viel",
    });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("LIMIT_ERREICHT");
  });
});

describe("Was der Tag zeigt", () => {
  async function aufgabe(datum: string, werte: Record<string, unknown> = {}) {
    const [a] = await db
      .insert(schema.aufgabe)
      .values({
        lagerId,
        titel: "Zelt aufbauen",
        frist: datum,
        lagerSeq: 0,
        ...werte,
      })
      .returning({ id: schema.aufgabe.id });
    return a!.id;
  }

  test("die To-dos des Tages sind die Aufgaben mit Frist an diesem Tag", async () => {
    const tag = await neuerTag();
    const heute = await aufgabe(tag.datum);
    await aufgabe("2000-01-01");
    const gelöscht = await aufgabe(tag.datum);
    await db.delete(schema.aufgabe).where(eq(schema.aufgabe.id, gelöscht));
    const a = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(a.body.aufgaben.map((x: { id: string }) => x.id)).toEqual([heute]);
    expect(a.body.aufgaben[0]).toMatchObject({
      titel: "Zelt aufbauen",
      frist: tag.datum,
    });
  });

  test("wer nur eigene Aufgaben lesen darf, sieht nur diese", async () => {
    const l = await neuesLager();
    // Das Team darf die Tagesseite lesen (Einstellung des Lagers), Aufgaben nur die eigenen
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: l,
      rolle: "team",
      recht: "tagesseiten.lesen",
      erlaubt: true,
    });
    const tag = await neuerTag(l);
    const meine = await db
      .insert(schema.aufgabe)
      .values({
        lagerId: l,
        titel: "Meine",
        frist: tag.datum,
        verantwortlichPersonId: konten.team.id!,
        lagerSeq: 0,
      })
      .returning({ id: schema.aufgabe.id });
    await db.insert(schema.aufgabe).values({
      lagerId: l,
      titel: "Fremde",
      frist: tag.datum,
      lagerSeq: 0,
    });
    const team = await anfrage(konten.team, "GET", `${T(l)}/${tag.id}`);
    expect(team.status).toBe(200);
    expect(team.body.aufgaben.map((x: { id: string }) => x.id)).toEqual([
      meine[0]!.id,
    ]);
    const leitung = await anfrage(leiter(), "GET", `${T(l)}/${tag.id}`);
    expect(leitung.body.aufgaben).toHaveLength(2);
  });

  test("das Wetter des Tages kommt aus dem Wetter des Lagers", async () => {
    const l = await neuesLager({ breite: 47.3769, laenge: 8.5417 });
    const tag = await neuerTag(l, "2041-06-01");
    wetterTage = [
      {
        datum: "2041-05-31",
        code: 0,
        tmax: 20,
        tmin: 10,
        regen: 0,
        boeen: 10,
      },
      {
        datum: "2041-06-01",
        code: 96,
        tmax: 31.5,
        tmin: 14,
        regen: 22,
        boeen: 65,
      },
    ];
    const a = await anfrage(leiter(), "GET", `${T(l)}/${tag.id}`);
    expect(a.status).toBe(200);
    expect(a.body.wetter).toMatchObject({
      datum: "2041-06-01",
      code: 96,
      zustand: "Gewitter",
      warnungen: ["gewitter", "boeen", "hitze", "regen"],
    });
    expect(a.body.wetterStand).not.toBeNull();
    // Nur der gerundete Ort ging hinaus
    expect(abrufe).toEqual([[47.38, 8.54]]);
    // Ein Tag ohne Werte: kein Wetter, kein Fehler
    const anderer = await neuerTag(l, "2041-09-01");
    const b = await anfrage(leiter(), "GET", `${T(l)}/${anderer.id}`);
    expect(b.status).toBe(200);
    expect(b.body.wetter).toBeNull();
    // Der zweite Aufruf holt nichts mehr
    expect(abrufe).toHaveLength(1);
  });

  test("ohne Ort und ohne das Recht kein Wetter und kein Abruf", async () => {
    const tag = await neuerTag();
    const a = await anfrage(leiter(), "GET", `${T()}/${tag.id}`);
    expect(a.body.wetter).toBeNull();
    expect(a.body.wetterStand).toBeNull();
    // wetter.lesen ausgeschaltet für die Rolle lesen
    const l = await neuesLager({ breite: 47, laenge: 8 });
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: l,
      rolle: "lesen",
      recht: "wetter.lesen",
      erlaubt: false,
    });
    const t = await neuerTag(l);
    const b = await anfrage(konten.lesen, "GET", `${T(l)}/${t.id}`);
    expect(b.status).toBe(200);
    expect(b.body.wetter).toBeNull();
    expect(abrufe).toHaveLength(0);
  });

  test("fällt der Wetterdienst aus, zeigt die Seite kein Wetter statt eines Fehlers", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    const kaputt = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
      wetter: async () => {
        throw new Error("https://api.open-meteo.com/v1/forecast?latitude=47");
      },
    });
    const tag = await neuerTag(l);
    const res = await kaputt.request(`${T(l)}/${tag.id}`, {
      headers: leiter().headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wetter).toBeNull();
    expect(body.seite).toBeNull();
  });

  test("Datenbanklast: eine Handvoll Abfragen für die ganze Seite, nicht je Block oder Aufgabe", async () => {
    const l = await neuesLager({ breite: 47, laenge: 8 });
    const tag = await neuerTag(l, "2041-07-01");
    wetterTage = [
      { datum: "2041-07-01", code: 1, tmax: 22, tmin: 12, regen: 0, boeen: 20 },
    ];
    const seite = (await anfrage(leiter(), "POST", `${T(l)}/${tag.id}`, {}))
      .body;
    await db.insert(schema.tagesseiteBlock).values(
      Array.from({ length: 20 }, (_, i) => ({
        lagerId: l,
        seiteId: seite.id as string,
        art: "idee" as const,
        text: `Idee ${i}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    );
    await db.insert(schema.aufgabe).values(
      Array.from({ length: 15 }, (_, i) => ({
        lagerId: l,
        titel: `Aufgabe ${i}`,
        frist: "2041-07-01",
        lagerSeq: 0,
      })),
    );
    // Der erste Aufruf holt das Wetter (ein Abruf, ein Schreibvorgang), der zweite liest nur
    await anfrage(leiter(), "GET", `${T(l)}/${tag.id}`);
    const vorher = protokoll.length;
    const a = await anfrage(leiter(), "GET", `${T(l)}/${tag.id}`);
    expect(a.status).toBe(200);
    expect(a.body.bloecke).toHaveLength(20);
    expect(a.body.aufgaben).toHaveLength(15);
    expect(a.body.wetter.code).toBe(1);
    const abfragen = protokoll
      .slice(vorher)
      .filter((q) =>
        /\b(from|into|update)\s+"(lager|lagertag|tagesseite|tagesseite_block|lager_datei|wetter_cache|aufgabe|aufgabe_unterstuetzung|ressort|lager_rolle_recht|lager_mitglied)"/i.test(
          q,
        ),
      );
    // Policy (2), Tag mit Seite (1), Blöcke (1), Wetter (1), Aufgaben (2); nie mehr je Zeile
    expect(abfragen.length).toBeLessThanOrEqual(8);
    expect(abfragen.filter((q) => /wetter_cache/.test(q))).toHaveLength(1);
    expect(abrufe).toHaveLength(1);
  });

  test("ein Programmbild sieht, wer die Tagesseite lesen darf", async () => {
    const tag = await neuerTag();
    const dateiId = await datei();
    await anfrage(leiter(), "POST", `${T()}/${tag.id}/bloecke`, {
      art: "programmbild",
      text: "Plan",
      dateiId,
    });
    const { sichtbareDateien } =
      await import("../../src/lager/datei-verweise.js");
    const { ladeLagerZugriff } = await import("../../src/lager/policy.js");
    const person = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, konten.lesen.id!));
    const zugriff = await ladeLagerZugriff(db, person[0]! as never, lagerId);
    expect(await sichtbareDateien(db, zugriff!, [dateiId])).toEqual(
      new Set([dateiId]),
    );
  });
});
