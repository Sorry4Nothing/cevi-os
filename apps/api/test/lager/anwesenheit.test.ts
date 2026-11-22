import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TokenMessage } from "firebase-admin/messaging";
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
import { anwesenheitFuerTag } from "../../src/lager/anwesenheit.js";
import type { Fcm } from "../../src/push.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { KONTO_FUER, LAGER_PERSONAS, type LagerPersona } from "./matrix.js";

bereiteAuthTestsVor();

// Jede Abfrage an die Datenbank zählt mit: Die Tests der Datenbanklast vergleichen die Zahl je Route
let abfragen = 0;
const sql = postgres(API_URL, { debug: () => abfragen++ });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);

// Eine Attrappe statt firebase-admin: Kein Netz, keine Schlüssel
let gesendet: TokenMessage[] = [];
const fcm: Fcm = {
  async sendEach(nachrichten) {
    gesendet.push(...nachrichten);
    return { responses: nachrichten.map(() => ({ success: true })) };
  },
};
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  seiten: ladeSeiten(),
  fcm,
});
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let fremdLagerId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
  gesendet = [];
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
      titel: "Anwesenheitslager",
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
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
  lagerId = await legeLager(welt.testabteilungId);
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  await mitgliederEintragen(lagerId);
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

const A = (id = lagerId) => `/api/v1/lager/${id}/anwesenheit`;
const leiter = () => konten.lagerleitung;
// Ein Lagertag mit drei Abschnitten, wirklich im Lager angelegt (Fremdschlüssel, #374); je Aufruf ein anderes Datum
let tagZaehler = 0;
async function neuerTag(id = lagerId) {
  const datum = new Date(Date.UTC(2027, 6, 10 + tagZaehler++))
    .toISOString()
    .slice(0, 10);
  const [tag] = await db
    .insert(schema.lagertag)
    .values({ lagerId: id, datum, lagerSeq: 0 })
    .returning({ id: schema.lagertag.id });
  const abschnitte = await db
    .insert(schema.tagesabschnitt)
    .values(
      [0, 1, 2].map((i) => ({
        lagerId: id,
        name: `Abschnitt ${randomUUID().slice(0, 8)}`,
        reihenfolge: i,
        lagerSeq: 0,
      })),
    )
    .returning({ id: schema.tagesabschnitt.id });
  return { tag: tag!.id, abschnitte: abschnitte.map((a) => a.id) };
}
type TagMitAbschnitten = Awaited<ReturnType<typeof neuerTag>>;
const felder = (
  t: TagMitAbschnitten,
  wert: "A" | "F" | "O",
  nur = t.abschnitte,
) =>
  nur.map((tagesabschnittId) => ({
    lagertagId: t.tag,
    tagesabschnittId,
    wert,
  }));
const eigene = (konto: PersonaKonto, eintraege: unknown[], id = lagerId) =>
  anfrage(konto, "PUT", `${A(id)}/eigene`, { eintraege });
const alsLeitung = (eintraege: unknown[], id = lagerId) =>
  anfrage(leiter(), "PUT", A(id), { eintraege });
const zeilenVon = (personId: string, id = lagerId) =>
  db
    .select()
    .from(schema.anwesenheit)
    .where(
      and(
        eq(schema.anwesenheit.lagerId, id),
        eq(schema.anwesenheit.personId, personId),
      ),
    );

async function wegwerfMitglied(
  rolle: "team" | "leitung" = "team",
  id = lagerId,
) {
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
    .values({ lagerId: id, personId: p!.id, rolle });
  return p!.id;
}

async function pushToken(userId: string) {
  const [sitzung] = await db
    .insert(schema.session)
    .values({
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date(),
      userId,
    })
    .returning({ id: schema.session.id });
  const token = `fcm-test-${randomUUID()}`;
  await db.insert(schema.pushToken).values({
    sessionId: sitzung!.id,
    token,
    userId,
    plattform: "android",
  });
  return token;
}

const benachrichtigungen = (personId: string, art: string) =>
  db
    .select()
    .from(schema.lagerBenachrichtigung)
    .where(
      and(
        eq(schema.lagerBenachrichtigung.personId, personId),
        eq(schema.lagerBenachrichtigung.lagerId, lagerId),
        eq(schema.lagerBenachrichtigung.art, art),
      ),
    );

describe("Rechte je Lager-Persona", () => {
  // anwesenheit.lesen_alle: Lagerleitung, Abteilungsleitung, Leitung, Lesen; anwesenheit.eigene: Lagerleitung, Abteilungsleitung, Leitung, Team; anwesenheit.bearbeiten: Lagerleitung und Abteilungsleitung
  const lesenAlle: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const eigeneLesen: Record<LagerPersona, number> = {
    ...lesenAlle,
    team: 200,
    lesen: 403,
  };
  const bearbeiten: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };

  test.each(LAGER_PERSONAS)(
    "%s: Matrix und Zusammenfassung lesen",
    async (p) => {
      expect((await anfrage(konten[p], "GET", A())).status).toBe(lesenAlle[p]);
      expect(
        (await anfrage(konten[p], "GET", `${A()}/zusammenfassung`)).status,
      ).toBe(lesenAlle[p]);
    },
  );

  test.each(LAGER_PERSONAS)("%s: eigene Anwesenheit lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", `${A()}/eigene`)).status).toBe(
      eigeneLesen[p],
    );
  });

  test.each(LAGER_PERSONAS)(
    "%s: für andere eintragen, Frist, Anfragen lesen",
    async (p) => {
      const t = await neuerTag();
      const schreiben = await anfrage(konten[p], "PUT", A(), {
        eintraege: [
          {
            teilnehmerId: randomUUID(),
            ...felder(t, "A", [t.abschnitte[0]!])[0],
          },
        ],
      });
      expect(schreiben.status).toBe(
        bearbeiten[p] === 200 ? 200 : bearbeiten[p],
      );
      expect(
        (await anfrage(konten[p], "PUT", `${A()}/frist`, { frist: null }))
          .status,
      ).toBe(bearbeiten[p] === 200 ? 200 : bearbeiten[p]);
      expect((await anfrage(konten[p], "GET", `${A()}/anfragen`)).status).toBe(
        bearbeiten[p],
      );
      expect(
        (
          await anfrage(konten[p], "POST", `${A()}/anfragen/entscheid`, {
            entscheid: "angenommen",
            anfragen: [{ id: randomUUID(), version: 1 }],
          })
        ).status,
      ).toBe(bearbeiten[p] === 200 ? 404 : bearbeiten[p]);
    },
  );

  test("ein fremdes Lager ist für alle Wege 404, auch für die Lagerleitung dort", async () => {
    for (const p of ["lagerleitung", "abteilungsleitung", "team"] as const) {
      expect((await anfrage(konten[p], "GET", A(fremdLagerId))).status).toBe(
        404,
      );
      expect(
        (
          await anfrage(konten[p], "PUT", `${A(fremdLagerId)}/eigene`, {
            eintraege: [],
          })
        ).status,
      ).toBe(404);
    }
    expect((await anfrage(konten.fremdeAbteilung, "GET", A())).status).toBe(
      404,
    );
  });

  test("die Abteilungsleitung ohne Mitgliedschaft liest und schreibt für andere, trägt aber nichts für sich ein", async () => {
    const t = await neuerTag();
    const a = await anfrage(konten.abteilungsleitung, "PUT", `${A()}/eigene`, {
      eintraege: felder(t, "A"),
    });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("KEIN_MITGLIED");
    const b = await anfrage(
      konten.abteilungsleitung,
      "POST",
      `${A()}/anfragen`,
      {
        eintraege: felder(t, "A"),
      },
    );
    expect(b.status).toBe(403);
  });
});

describe("Team: nur eigene, offene Felder", () => {
  test("trägt offene Felder ein; dieselbe Anfrage wiederholt ist folgenlos", async () => {
    const t = await neuerTag();
    const a = await eigene(konten.team, felder(t, "A"));
    expect(a.status).toBe(200);
    expect(a.body.eintraege).toHaveLength(3);
    expect(a.body.eintraege[0]).toMatchObject({
      personId: konten.team.id,
      teilnehmerId: null,
      lagertagId: t.tag,
      wert: "A",
      version: 1,
    });
    const nochmal = await eigene(konten.team, felder(t, "A"));
    expect(nochmal.status).toBe(200);
    expect(
      nochmal.body.eintraege.map((e: { version: number }) => e.version),
    ).toEqual([1, 1, 1]);
    expect(
      (await zeilenVon(konten.team.id!)).filter((z) => z.lagertagId === t.tag),
    ).toHaveLength(3);
  });

  test("ein eingetragenes Feld ändert das Team nicht: 409 ANFRAGE_NOETIG, nichts wird geschrieben", async () => {
    const t = await neuerTag();
    await eigene(konten.team, felder(t, "A", [t.abschnitte[0]!]));
    // Ganzer Tag: Der erste Abschnitt ist gesperrt, die anderen beiden bleiben deshalb offen (alles oder nichts)
    const a = await eigene(konten.team, felder(t, "F"));
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("ANFRAGE_NOETIG");
    expect(a.body.gesperrt).toEqual([
      {
        lagertagId: t.tag,
        tagesabschnittId: t.abschnitte[0],
        grund: "eingetragen",
      },
    ]);
    const stand = (await zeilenVon(konten.team.id!)).filter(
      (z) => z.lagertagId === t.tag,
    );
    expect(stand).toHaveLength(1);
    expect(stand[0]).toMatchObject({ wert: "A", version: 1 });
    // Auch «offen» auf ein eingetragenes Feld ist eine Änderung
    const o = await eigene(konten.team, felder(t, "O", [t.abschnitte[0]!]));
    expect(o.status).toBe(409);
  });

  test("«offen» auf ein offenes Feld schreibt nichts", async () => {
    const t = await neuerTag();
    const a = await eigene(konten.team, felder(t, "O"));
    expect(a.status).toBe(200);
    expect(a.body.eintraege).toEqual([]);
    expect(
      (await zeilenVon(konten.team.id!)).filter((z) => z.lagertagId === t.tag),
    ).toHaveLength(0);
  });

  test("keine fremden Personen, keine unbekannten Felder, keine Doppelten, höchstens 100", async () => {
    const t = await neuerTag();
    const fremd = await anfrage(konten.team, "PUT", `${A()}/eigene`, {
      eintraege: [{ ...felder(t, "A")[0], personId: konten.lesen.id }],
    });
    expect(fremd.status).toBe(400);
    expect(
      (
        await anfrage(konten.team, "PUT", `${A()}/eigene`, {
          eintraege: [{ ...felder(t, "A")[0], teilnehmerId: randomUUID() }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(konten.team, "PUT", `${A()}/eigene`, {
          eintraege: [{ ...felder(t, "A")[0], version: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await eigene(konten.team, [felder(t, "A")[0], felder(t, "F")[0]]))
        .status,
    ).toBe(400);
    expect((await eigene(konten.team, [])).status).toBe(400);
    const viele = Array.from({ length: 101 }, () => ({
      lagertagId: randomUUID(),
      tagesabschnittId: randomUUID(),
      wert: "A",
    }));
    expect((await eigene(konten.team, viele)).status).toBe(400);
    expect(
      (await eigene(konten.team, [{ ...felder(t, "A")[0], wert: "X" }])).status,
    ).toBe(400);
    expect(
      (await zeilenVon(konten.lesen.id!)).filter((z) => z.lagertagId === t.tag),
    ).toHaveLength(0);
  });

  test("das Team kann nichts löschen: es gibt keine Löschroute", async () => {
    const t = await neuerTag();
    await eigene(konten.team, felder(t, "A"));
    for (const pfad of [A(), `${A()}/eigene`, `${A()}/anfragen`]) {
      for (const methode of ["DELETE", "PATCH"]) {
        const a = await anfrage(konten.team, methode, pfad);
        expect([404, 405]).toContain(a.status);
      }
    }
    expect(
      (await zeilenVon(konten.team.id!)).filter((z) => z.lagertagId === t.tag),
    ).toHaveLength(3);
  });

  test("zwei gleichzeitige Eintragungen derselben Felder: Eine gewinnt, die andere nur mit gleichem Wert", async () => {
    const t = await neuerTag();
    const ergebnisse = await Promise.all([
      eigene(konten.team, felder(t, "A")),
      eigene(konten.team, felder(t, "F")),
    ]);
    expect(ergebnisse.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await zeilenVon(konten.team.id!)).filter((z) => z.lagertagId === t.tag),
    ).toHaveLength(3);
  });

  test("das Team sieht in seiner Antwort nur eigene Felder", async () => {
    const t = await neuerTag();
    await alsLeitung([{ personId: konten.lesen.id, ...felder(t, "A")[0] }]);
    await eigene(konten.team, felder(t, "A", [t.abschnitte[1]!]));
    const a = await anfrage(
      konten.team,
      "GET",
      `${A()}/eigene?lagertagIds=${t.tag}`,
    );
    expect(a.status).toBe(200);
    expect(a.body.eintraege).toHaveLength(1);
    expect(a.body.eintraege[0].personId).toBe(konten.team.id);
    expect(Array.isArray(a.body.anfragen)).toBe(true);
  });
});

describe("Lagerleitung: für alle, mit Versionen", () => {
  test("trägt für Leitende und Teilnehmende ein, überschreibt mit der Version, öffnet ein Feld wieder", async () => {
    const t = await neuerTag();
    const kind = randomUUID();
    const a = await alsLeitung([
      { personId: konten.team.id, ...felder(t, "A", [t.abschnitte[0]!])[0] },
      { teilnehmerId: kind, ...felder(t, "F", [t.abschnitte[0]!])[0] },
    ]);
    expect(a.status).toBe(200);
    expect(a.body.eintraege).toHaveLength(2);
    const teamFeld = a.body.eintraege.find(
      (e: { personId: string }) => e.personId === konten.team.id,
    );
    // Falsche Version: 409 mit dem aktuellen Stand
    const alt = await alsLeitung([
      {
        personId: konten.team.id,
        ...felder(t, "F", [t.abschnitte[0]!])[0],
        version: 7,
      },
    ]);
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
    expect(alt.body.aktuell).toMatchObject({
      id: teamFeld.id,
      version: 1,
      wert: "A",
    });
    expect(alt.body.abweichend).toEqual(["wert"]);
    // Ohne Version gilt das Feld als leer: Konflikt, solange es eingetragen ist
    const leer = await alsLeitung([
      { personId: konten.team.id, ...felder(t, "F", [t.abschnitte[0]!])[0] },
    ]);
    expect(leer.status).toBe(409);
    // Mit der richtigen Version
    const ok = await alsLeitung([
      {
        personId: konten.team.id,
        ...felder(t, "F", [t.abschnitte[0]!])[0],
        version: 1,
      },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.eintraege[0]).toMatchObject({ wert: "F", version: 2 });
    // Wieder öffnen: Die Zeile bleibt mit O, das Team trägt wieder direkt ein
    const offen = await alsLeitung([
      {
        personId: konten.team.id,
        ...felder(t, "O", [t.abschnitte[0]!])[0],
        version: 2,
      },
    ]);
    expect(offen.body.eintraege[0]).toMatchObject({ wert: "O", version: 3 });
    const wieder = await eigene(
      konten.team,
      felder(t, "A", [t.abschnitte[0]!]),
    );
    expect(wieder.status).toBe(200);
    expect(wieder.body.eintraege[0]).toMatchObject({ wert: "A", version: 4 });
    // Genau eine Zeile je Feld
    const zeilen = (await zeilenVon(konten.team.id!)).filter(
      (z) => z.lagertagId === t.tag,
    );
    expect(zeilen).toHaveLength(1);
  });

  test("ein Konflikt nimmt die ganze Anfrage zurück", async () => {
    const t = await neuerTag();
    const team = konten.team.id;
    await alsLeitung([
      { personId: team, ...felder(t, "A", [t.abschnitte[0]!])[0] },
    ]);
    const a = await alsLeitung([
      { personId: team, ...felder(t, "A", [t.abschnitte[1]!])[0] },
      { personId: team, ...felder(t, "F", [t.abschnitte[0]!])[0], version: 9 },
    ]);
    expect(a.status).toBe(409);
    expect(
      (await zeilenVon(team!)).filter((z) => z.lagertagId === t.tag),
    ).toHaveLength(1);
  });

  test("Eingaben: genau eine von personId und teilnehmerId, Mitglied des Lagers, strikt", async () => {
    const t = await neuerTag();
    const f = felder(t, "A", [t.abschnitte[0]!])[0];
    expect((await alsLeitung([{ ...f }])).status).toBe(400);
    expect(
      (
        await alsLeitung([
          { ...f, personId: konten.team.id, teilnehmerId: randomUUID() },
        ])
      ).status,
    ).toBe(400);
    expect(
      (await alsLeitung([{ ...f, personId: konten.team.id, extra: 1 }])).status,
    ).toBe(400);
    const unbekannt = await alsLeitung([{ ...f, personId: randomUUID() }]);
    expect(unbekannt.status).toBe(400);
    expect(unbekannt.body.code).toBe("KEIN_MITGLIED");
    // Ein Konto ohne Mitgliedschaft in diesem Lager
    const [fremd] = await db
      .insert(schema.user)
      .values({
        name: "Kein Mitglied",
        email: `${randomUUID()}@example.org`,
        username: `k.${randomUUID().slice(0, 8)}`,
        abteilungId: welt.testabteilungId,
        mussPasswortAendern: false,
      })
      .returning({ id: schema.user.id });
    expect((await alsLeitung([{ ...f, personId: fremd!.id }])).body.code).toBe(
      "KEIN_MITGLIED",
    );
  });

  test("Sammeloperation: ein ganzer Tag mehrerer Personen in einem Aufruf", async () => {
    const t = await neuerTag();
    const a = await alsLeitung(
      [konten.team.id, konten.leitung.id, konten.lesen.id].flatMap((personId) =>
        felder(t, "A").map((f) => ({ personId, ...f })),
      ),
    );
    expect(a.status).toBe(200);
    expect(a.body.eintraege).toHaveLength(9);
    const m = await anfrage(leiter(), "GET", `${A()}?lagertagIds=${t.tag}`);
    expect(m.body.eintraege).toHaveLength(9);
  });
});

describe("Frist", () => {
  afterEach(async () => {
    await db
      .update(schema.lager)
      .set({ anwesenheitFrist: null })
      .where(eq(schema.lager.id, lagerId));
  });

  test("nach der Frist trägt das Team nicht mehr direkt ein; die Lagerleitung schon", async () => {
    const t = await neuerTag();
    const gestern = new Date(Date.now() - 86_400_000).toISOString();
    const gesetzt = await anfrage(leiter(), "PUT", `${A()}/frist`, {
      frist: gestern,
    });
    expect(gesetzt.status).toBe(200);
    const a = await eigene(konten.team, felder(t, "A", [t.abschnitte[0]!]));
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("ANFRAGE_NOETIG");
    expect(a.body.gesperrt[0].grund).toBe("frist");
    expect(
      (
        await alsLeitung([
          {
            personId: konten.team.id,
            ...felder(t, "A", [t.abschnitte[0]!])[0],
          },
        ])
      ).status,
    ).toBe(200);
    // Die Frist steht in den Antworten der Lesewege
    const e = await anfrage(konten.team, "GET", `${A()}/eigene`);
    expect(new Date(e.body.frist).toISOString()).toBe(gestern);
    // Der Wert, der schon dasteht, ist auch nach der Frist kein Fehler
    expect(
      (await eigene(konten.team, felder(t, "A", [t.abschnitte[0]!]))).status,
    ).toBe(200);
  });

  test("vor der Frist geht es direkt, ohne Frist auch; die Änderung wird protokolliert", async () => {
    const t = await neuerTag();
    const morgen = new Date(Date.now() + 86_400_000).toISOString();
    await anfrage(leiter(), "PUT", `${A()}/frist`, { frist: morgen });
    expect(
      (await eigene(konten.team, felder(t, "A", [t.abschnitte[0]!]))).status,
    ).toBe(200);
    const log = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.aktion, "lager_anwesenheit_frist"),
          eq(schema.auditLog.zielId, lagerId),
        ),
      );
    expect(log.length).toBeGreaterThan(0);
    expect(log.at(-1)).toMatchObject({ akteurId: konten.lagerleitung.id });
    await anfrage(leiter(), "PUT", `${A()}/frist`, { frist: null });
    const u = await neuerTag();
    expect(
      (await eigene(konten.team, felder(u, "F", [u.abschnitte[0]!]))).status,
    ).toBe(200);
  });

  test("ungültige Fristen und fremde Felder: 400", async () => {
    for (const body of [
      { frist: "morgen" },
      { frist: 5 },
      {},
      { frist: null, x: 1 },
    ]) {
      expect(
        (await anfrage(leiter(), "PUT", `${A()}/frist`, body)).status,
      ).toBe(400);
    }
  });

  test("Anfragen sind nach der Frist auch für offene Felder möglich", async () => {
    const t = await neuerTag();
    const gestern = new Date(Date.now() - 86_400_000).toISOString();
    await anfrage(leiter(), "PUT", `${A()}/frist`, { frist: gestern });
    const a = await anfrage(konten.leitung, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "A", [t.abschnitte[0]!]),
    });
    expect(a.status).toBe(201);
  });
});

describe("Anfragen und Entscheid", () => {
  async function gesperrtesFeld(personKonto = konten.team) {
    const t = await neuerTag();
    await eigene(personKonto, felder(t, "A"));
    return t;
  }

  test("das Team stellt eine Anfrage für ein eingetragenes Feld; die Lagerleitung wird benachrichtigt, nicht die Person selbst", async () => {
    const token = await pushToken(konten.lagerleitung.id!);
    const tokenTeam = await pushToken(konten.team.id!);
    const t = await gesperrtesFeld();
    const vorherLeitung = (
      await benachrichtigungen(konten.lagerleitung.id!, "anwesenheit_anfrage")
    ).length;
    const a = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
      notiz: "  Ich bin krank.  ",
    });
    expect(a.status).toBe(201);
    expect(a.body.anfragen).toHaveLength(1);
    expect(a.body.anfragen[0]).toMatchObject({
      personId: konten.team.id,
      lagertagId: t.tag,
      tagesabschnittId: t.abschnitte[0],
      wert: "F",
      notiz: "Ich bin krank.",
      status: "offen",
      entschiedenVon: null,
      version: 1,
    });
    // Das Feld bleibt, wie es war
    const feld = (await zeilenVon(konten.team.id!)).find(
      (z) => z.tagesabschnittId === t.abschnitte[0],
    );
    expect(feld?.wert).toBe("A");
    // Benachrichtigung ohne Namen und ohne Inhalt, nur für die Lagerleitung (Mitglied)
    expect(
      await benachrichtigungen(konten.lagerleitung.id!, "anwesenheit_anfrage"),
    ).toHaveLength(vorherLeitung + 1);
    expect(
      await benachrichtigungen(konten.team.id!, "anwesenheit_anfrage"),
    ).toHaveLength(0);
    expect(
      await benachrichtigungen(konten.leitung.id!, "anwesenheit_anfrage"),
    ).toHaveLength(0);
    const nachricht = gesendet.find((n) => "token" in n && n.token === token);
    expect(nachricht).toBeDefined();
    expect(nachricht!.data).toMatchObject({ typ: "lager_anwesenheit" });
    expect(nachricht!.notification?.body).toBe("Anwesenheitslager");
    expect(JSON.stringify(nachricht)).not.toMatch(/krank|Mitglied|Test/);
    expect(gesendet.some((n) => "token" in n && n.token === tokenTeam)).toBe(
      false,
    );
  });

  test("ein ganzer Tag als Anfrage: eine Anfrage je Abschnitt, eine Benachrichtigung", async () => {
    const t = await gesperrtesFeld();
    const vorher = (
      await benachrichtigungen(konten.lagerleitung.id!, "anwesenheit_anfrage")
    ).length;
    const a = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F"),
    });
    expect(a.status).toBe(201);
    expect(a.body.anfragen).toHaveLength(3);
    expect(
      (await benachrichtigungen(konten.lagerleitung.id!, "anwesenheit_anfrage"))
        .length,
    ).toBe(vorher + 1);
  });

  test("keine Anfrage für ein offenes Feld, für den gleichen Wert oder doppelt", async () => {
    const t = await neuerTag();
    const offen = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "A", [t.abschnitte[0]!]),
    });
    expect(offen.status).toBe(409);
    expect(offen.body.code).toBe("KEINE_ANFRAGE_NOETIG");
    expect(offen.body.felder).toEqual([
      { lagertagId: t.tag, tagesabschnittId: t.abschnitte[0] },
    ]);
    await eigene(konten.team, felder(t, "A", [t.abschnitte[0]!]));
    const gleich = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "A", [t.abschnitte[0]!]),
    });
    expect(gleich.body.code).toBe("KEINE_ANFRAGE_NOETIG");
    const erste = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    expect(erste.status).toBe(201);
    const doppelt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    expect(doppelt.status).toBe(409);
    expect(doppelt.body.code).toBe("ANFRAGE_OFFEN");
    // Nichts Halbes: Auch die Anfrage mit einem gültigen und einem doppelten Feld legt nichts an
    const gemischt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: [
        ...felder(t, "F", [t.abschnitte[0]!]),
        ...felder(t, "F", [t.abschnitte[1]!]),
      ],
    });
    expect(gemischt.status).toBe(409);
  });

  test("Eingaben der Anfrage: Notiz höchstens 500 Zeichen, keine fremden Felder, keine Person", async () => {
    const t = await gesperrtesFeld();
    const f = felder(t, "F", [t.abschnitte[0]!]);
    for (const body of [
      { eintraege: f, notiz: "x".repeat(501) },
      { eintraege: f, notiz: "" },
      { eintraege: f, status: "angenommen" },
      { eintraege: [{ ...f[0], personId: konten.lesen.id }] },
      { eintraege: [] },
    ]) {
      expect(
        (await anfrage(konten.team, "POST", `${A()}/anfragen`, body)).status,
      ).toBe(400);
    }
  });

  test("annehmen: Das Feld ändert sich, die Person wird benachrichtigt, der Push nennt nur den Lagertitel", async () => {
    const tokenTeam = await pushToken(konten.team.id!);
    const t = await gesperrtesFeld();
    const angefragt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    const a = angefragt.body.anfragen[0];
    gesendet = [];
    const e = await anfrage(leiter(), "POST", `${A()}/anfragen/entscheid`, {
      entscheid: "angenommen",
      anfragen: [{ id: a.id, version: a.version }],
    });
    expect(e.status).toBe(200);
    expect(e.body.anfragen[0]).toMatchObject({
      id: a.id,
      status: "angenommen",
      version: 2,
      entschiedenVon: konten.lagerleitung.id,
    });
    expect(e.body.anfragen[0].entschiedenAm).toBeTruthy();
    const feld = (await zeilenVon(konten.team.id!)).find(
      (z) => z.tagesabschnittId === t.abschnitte[0],
    );
    expect(feld).toMatchObject({ wert: "F", version: 2 });
    expect(
      await benachrichtigungen(konten.team.id!, "anwesenheit_entscheid"),
    ).toHaveLength(1);
    const nachricht = gesendet.find(
      (n) => "token" in n && n.token === tokenTeam,
    );
    expect(nachricht!.notification?.body).toBe("Anwesenheitslager");
    expect(nachricht!.data).toMatchObject({ typ: "lager_anwesenheit" });
    expect(JSON.stringify(nachricht)).not.toMatch(/angenommen|abgelehnt/);
    // Die Anfrage ist entschieden: kein zweiter Entscheid
    const nochmal = await anfrage(
      leiter(),
      "POST",
      `${A()}/anfragen/entscheid`,
      {
        entscheid: "abgelehnt",
        anfragen: [{ id: a.id, version: 2 }],
      },
    );
    expect(nochmal.status).toBe(409);
    expect(nochmal.body.code).toBe("BEREITS_ENTSCHIEDEN");
  });

  test("ablehnen ändert das Feld nicht; danach ist eine neue Anfrage möglich", async () => {
    const t = await gesperrtesFeld();
    const angefragt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    const a = angefragt.body.anfragen[0];
    const e = await anfrage(leiter(), "POST", `${A()}/anfragen/entscheid`, {
      entscheid: "abgelehnt",
      anfragen: [{ id: a.id, version: 1 }],
    });
    expect(e.body.anfragen[0].status).toBe("abgelehnt");
    const feld = (await zeilenVon(konten.team.id!)).find(
      (z) => z.tagesabschnittId === t.abschnitte[0],
    );
    expect(feld).toMatchObject({ wert: "A", version: 1 });
    expect(
      await benachrichtigungen(konten.team.id!, "anwesenheit_entscheid"),
    ).not.toHaveLength(0);
    const neu = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    expect(neu.status).toBe(201);
  });

  test("ein ganzer Tag wird gebündelt entschieden, mit einer Benachrichtigung je Person", async () => {
    const t = await gesperrtesFeld();
    const angefragt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F"),
    });
    const vorher = (
      await benachrichtigungen(konten.team.id!, "anwesenheit_entscheid")
    ).length;
    const e = await anfrage(leiter(), "POST", `${A()}/anfragen/entscheid`, {
      entscheid: "angenommen",
      anfragen: angefragt.body.anfragen.map(
        (x: { id: string; version: number }) => ({
          id: x.id,
          version: x.version,
        }),
      ),
    });
    expect(e.status).toBe(200);
    expect(e.body.anfragen).toHaveLength(3);
    expect(
      (await zeilenVon(konten.team.id!))
        .filter((z) => z.lagertagId === t.tag)
        .map((z) => z.wert),
    ).toEqual(["F", "F", "F"]);
    expect(
      (await benachrichtigungen(konten.team.id!, "anwesenheit_entscheid"))
        .length,
    ).toBe(vorher + 1);
  });

  test("Versionskonflikt, unbekannte Anfrage, fremdes Lager, ungültige Eingabe", async () => {
    const t = await gesperrtesFeld();
    const angefragt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    const a = angefragt.body.anfragen[0];
    const alt = await anfrage(leiter(), "POST", `${A()}/anfragen/entscheid`, {
      entscheid: "angenommen",
      anfragen: [{ id: a.id, version: 5 }],
    });
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
    expect(alt.body.aktuell).toMatchObject({
      id: a.id,
      version: 1,
      status: "offen",
    });
    // Ein Teil unbekannt: alles oder nichts, 404
    const gemischt = await anfrage(
      leiter(),
      "POST",
      `${A()}/anfragen/entscheid`,
      {
        entscheid: "angenommen",
        anfragen: [
          { id: a.id, version: 1 },
          { id: randomUUID(), version: 1 },
        ],
      },
    );
    expect(gemischt.status).toBe(404);
    const unveraendert = await anfrage(
      leiter(),
      "GET",
      `${A()}/anfragen?status=offen`,
    );
    expect(
      unveraendert.body.anfragen.some((x: { id: string }) => x.id === a.id),
    ).toBe(true);
    for (const body of [
      { entscheid: "vielleicht", anfragen: [{ id: a.id, version: 1 }] },
      { entscheid: "angenommen", anfragen: [] },
      {
        entscheid: "angenommen",
        anfragen: [
          { id: a.id, version: 1 },
          { id: a.id, version: 1 },
        ],
      },
      { entscheid: "angenommen", anfragen: [{ id: a.id, version: 1 }], x: 1 },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${A()}/anfragen/entscheid`, body))
          .status,
      ).toBe(400);
    }
    // Eine Anfrage aus einem anderen Lager gibt es hier nicht
    const tf = await neuerTag(fremdLagerId);
    const [andere] = await db
      .insert(schema.anwesenheitAnfrage)
      .values({
        lagerId: fremdLagerId,
        personId: konten.team.id!,
        lagertagId: tf.tag,
        tagesabschnittId: tf.abschnitte[0]!,
        wert: "F",
        lagerSeq: 0,
      })
      .returning({ id: schema.anwesenheitAnfrage.id });
    const fremd = await anfrage(leiter(), "POST", `${A()}/anfragen/entscheid`, {
      entscheid: "angenommen",
      anfragen: [{ id: andere!.id, version: 1 }],
    });
    expect(fremd.status).toBe(404);
  });

  test("das Team entscheidet nicht und liest die Anfragen anderer nicht", async () => {
    const t = await gesperrtesFeld();
    const angefragt = await anfrage(konten.team, "POST", `${A()}/anfragen`, {
      eintraege: felder(t, "F", [t.abschnitte[0]!]),
    });
    const a = angefragt.body.anfragen[0];
    expect(
      (
        await anfrage(konten.team, "POST", `${A()}/anfragen/entscheid`, {
          entscheid: "angenommen",
          anfragen: [{ id: a.id, version: 1 }],
        })
      ).status,
    ).toBe(403);
    expect((await anfrage(konten.team, "GET", `${A()}/anfragen`)).status).toBe(
      403,
    );
    // Eigene Anfragen sieht die Person über /eigene, die von anderen nicht
    const eigeneAnfragen = await anfrage(konten.team, "GET", `${A()}/eigene`);
    expect(
      eigeneAnfragen.body.anfragen.some((x: { id: string }) => x.id === a.id),
    ).toBe(true);
    const fremde = await anfrage(konten.leitung, "GET", `${A()}/eigene`);
    expect(
      fremde.body.anfragen.some((x: { id: string }) => x.id === a.id),
    ).toBe(false);
  });

  test("Liste der Anfragen: Statusfilter und Seitenwechsel", async () => {
    const person = await wegwerfMitglied();
    // Ein Lager nur für diesen Test: eigene Zeilen, die sonst niemand anfasst
    const [l] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Anfragenliste",
        von: "2027-07-10",
        bis: "2027-07-24",
      })
      .returning({ id: schema.lager.id });
    await db.insert(schema.lagerMitglied).values({
      lagerId: l!.id,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const t = await neuerTag(l!.id);
    for (const [i, abschnitt] of t.abschnitte.entries()) {
      await db.insert(schema.anwesenheitAnfrage).values({
        lagerId: l!.id,
        personId: person,
        lagertagId: t.tag,
        tagesabschnittId: abschnitt,
        wert: "F",
        ...(i === 2
          ? { status: "abgelehnt" as const, entschiedenAm: new Date() }
          : {}),
        lagerSeq: 0,
      });
    }
    const alle = await anfrage(leiter(), "GET", `${A(l!.id)}/anfragen?limit=2`);
    expect(alle.body.anfragen).toHaveLength(2);
    expect(alle.body.naechster).toBe(alle.body.anfragen[1].id);
    const weiter = await anfrage(
      leiter(),
      "GET",
      `${A(l!.id)}/anfragen?limit=2&nach=${alle.body.naechster}`,
    );
    expect(weiter.body.anfragen).toHaveLength(1);
    expect(weiter.body.naechster).toBeNull();
    const offen = await anfrage(
      leiter(),
      "GET",
      `${A(l!.id)}/anfragen?status=offen`,
    );
    expect(offen.body.anfragen).toHaveLength(2);
    expect(
      offen.body.anfragen.every(
        (x: { status: string }) => x.status === "offen",
      ),
    ).toBe(true);
    expect(
      (await anfrage(leiter(), "GET", `${A(l!.id)}/anfragen?status=x`)).status,
    ).toBe(400);
  });
});

describe("Matrix lesen und Zusammenfassung", () => {
  test("ein Abruf je Lager und Zeitraum: Filter nach Lagertagen, Seiten, kein Fremdlager", async () => {
    const [l] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Matrixlager",
        von: "2027-07-10",
        bis: "2027-07-24",
      })
      .returning({ id: schema.lager.id });
    await db.insert(schema.lagerMitglied).values({
      lagerId: l!.id,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const personen = await Promise.all(
      [1, 2, 3, 4].map(() => wegwerfMitglied("team", l!.id)),
    );
    const t1 = await neuerTag(l!.id);
    const t2 = await neuerTag(l!.id);
    const kinder = [randomUUID(), randomUUID()];
    await anfrage(leiter(), "PUT", A(l!.id), {
      eintraege: [
        ...personen.flatMap((personId) =>
          felder(t1, "A").map((f) => ({ personId, ...f })),
        ),
        ...kinder.flatMap((teilnehmerId) =>
          felder(t1, "A").map((f) => ({ teilnehmerId, ...f })),
        ),
        ...personen
          .slice(0, 2)
          .flatMap((personId) =>
            felder(t2, "F").map((f) => ({ personId, ...f })),
          ),
      ].slice(0, 100),
    });
    // Ein Feld im fremden Lager erscheint nie
    const tf = await neuerTag(fremdLagerId);
    await db.insert(schema.anwesenheit).values({
      lagerId: fremdLagerId,
      personId: konten.fremdeAbteilung.id!,
      lagertagId: tf.tag,
      tagesabschnittId: tf.abschnitte[0]!,
      wert: "A",
      lagerSeq: 0,
    });

    const alle = await anfrage(leiter(), "GET", A(l!.id));
    expect(alle.body.eintraege).toHaveLength(12 + 6 + 6);
    expect(alle.body.naechster).toBeNull();
    const nurT2 = await anfrage(
      leiter(),
      "GET",
      `${A(l!.id)}?lagertagIds=${t2.tag}`,
    );
    expect(nurT2.body.eintraege).toHaveLength(6);
    const zwei = await anfrage(
      leiter(),
      "GET",
      `${A(l!.id)}?lagertagIds=${t1.tag},${t2.tag}`,
    );
    expect(zwei.body.eintraege).toHaveLength(24);
    // Seiten
    const gesehen = new Set<string>();
    let nach: string | null = null;
    let seiten = 0;
    do {
      const s: Antwort = await anfrage(
        leiter(),
        "GET",
        `${A(l!.id)}?limit=10${nach ? `&nach=${nach}` : ""}`,
      );
      for (const e of s.body.eintraege) gesehen.add(e.id);
      nach = s.body.naechster;
      seiten++;
    } while (nach);
    expect(gesehen.size).toBe(24);
    expect(seiten).toBe(3);
    // Eingaben
    for (const q of [
      "lagertagIds=x",
      "limit=0",
      "limit=5001",
      "foo=1",
      "nach=x",
    ]) {
      expect((await anfrage(leiter(), "GET", `${A(l!.id)}?${q}`)).status).toBe(
        400,
      );
    }

    const z = await anfrage(leiter(), "GET", `${A(l!.id)}/zusammenfassung`);
    expect(z.status).toBe(200);
    const eintrag = (tag: string, abschnitt: string, wert: string) =>
      z.body.zeilen.find(
        (r: { lagertagId: string; tagesabschnittId: string; wert: string }) =>
          r.lagertagId === tag &&
          r.tagesabschnittId === abschnitt &&
          r.wert === wert,
      );
    expect(eintrag(t1.tag, t1.abschnitte[0]!, "A")).toMatchObject({
      leitende: 4,
      teilnehmende: 2,
    });
    expect(eintrag(t2.tag, t2.abschnitte[1]!, "F")).toMatchObject({
      leitende: 2,
      teilnehmende: 0,
    });
  });

  test("Datenbanklast: die Zahl der Abfragen hängt nicht von der Zahl der Zeilen ab", async () => {
    const t = await neuerTag();
    const zaehle = async (pfad: string) => {
      const vor = abfragen;
      expect((await anfrage(leiter(), "GET", pfad)).status).toBe(200);
      return abfragen - vor;
    };
    const wenige = await zaehle(`${A()}?lagertagIds=${t.tag}`);
    await alsLeitung(
      Array.from({ length: 60 }, () => ({
        teilnehmerId: randomUUID(),
        ...felder(t, "A", [t.abschnitte[0]!])[0],
      })),
    );
    const viele = await zaehle(`${A()}?lagertagIds=${t.tag}`);
    expect(viele).toBe(wenige);
    // Sitzung, Konto, Lager mit Mitgliedschaft, Rechte der Rolle und die eine Abfrage der Matrix
    expect(wenige).toBeLessThanOrEqual(5);
    // Die Zusammenfassung ist eine Abfrage mehr als die Policy, egal wie viele Zeilen
    expect(await zaehle(`${A()}/zusammenfassung`)).toBeLessThanOrEqual(5);
    expect(await zaehle(`${A()}/anfragen`)).toBeLessThanOrEqual(5);
  });
});

describe("abgeschlossenes Lager", () => {
  test("lesen geht, jede schreibende Route ist 409 LAGER_GESCHLOSSEN", async () => {
    const t = await neuerTag();
    expect((await anfrage(leiter(), "GET", A(geschlossenId))).status).toBe(200);
    expect(
      (await anfrage(konten.team, "GET", `${A(geschlossenId)}/eigene`)).status,
    ).toBe(200);
    const schreibend: [
      string,
      string,
      Record<string, unknown>,
      PersonaKonto,
    ][] = [
      [
        "PUT",
        A(geschlossenId),
        { eintraege: [{ teilnehmerId: randomUUID(), ...felder(t, "A")[0] }] },
        leiter(),
      ],
      [
        "PUT",
        `${A(geschlossenId)}/eigene`,
        { eintraege: felder(t, "A") },
        konten.team,
      ],
      ["PUT", `${A(geschlossenId)}/frist`, { frist: null }, leiter()],
      [
        "POST",
        `${A(geschlossenId)}/anfragen`,
        { eintraege: felder(t, "A") },
        konten.team,
      ],
      [
        "POST",
        `${A(geschlossenId)}/anfragen/entscheid`,
        {
          entscheid: "angenommen",
          anfragen: [{ id: randomUUID(), version: 1 }],
        },
        leiter(),
      ],
    ];
    for (const [methode, pfad, body, konto] of schreibend) {
      const a = await anfrage(konto, methode, pfad, body);
      expect(a.status, `${methode} ${pfad}`).toBe(409);
      expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    }
    expect(await zeilenVon(konten.team.id!, geschlossenId)).toHaveLength(0);
  });
});

describe("Änderungsfeed", () => {
  test("Anwesenheit erscheint im Feed für die Lagerleitung und Leitung, nicht für das Team", async () => {
    const t = await neuerTag();
    const vor = await anfrage(
      leiter(),
      "GET",
      `/api/v1/lager/${lagerId}/aenderungen`,
    );
    const seq = vor.body.seq as number;
    expect(vor.body.objekttypen).toContain("anwesenheit");
    expect(vor.body.objekttypen).toContain("anwesenheit_anfrage");
    const teamTypen = (
      await anfrage(konten.team, "GET", `/api/v1/lager/${lagerId}/aenderungen`)
    ).body.objekttypen;
    expect(teamTypen).not.toContain("anwesenheit");
    expect(teamTypen).not.toContain("anwesenheit_anfrage");
    const leitungTypen = (
      await anfrage(
        konten.leitung,
        "GET",
        `/api/v1/lager/${lagerId}/aenderungen`,
      )
    ).body.objekttypen;
    expect(leitungTypen).toContain("anwesenheit");
    expect(leitungTypen).not.toContain("anwesenheit_anfrage");

    await eigene(konten.team, felder(t, "A", [t.abschnitte[0]!]));
    const feed = await anfrage(
      leiter(),
      "GET",
      `/api/v1/lager/${lagerId}/aenderungen?seit=${seq}`,
    );
    expect(feed.body.eintraege).toHaveLength(1);
    expect(feed.body.eintraege[0]).toMatchObject({
      objekttyp: "anwesenheit",
      art: "neu",
      version: 1,
    });
    const teamFeed = await anfrage(
      konten.team,
      "GET",
      `/api/v1/lager/${lagerId}/aenderungen?seit=${seq}`,
    );
    expect(teamFeed.body.eintraege).toHaveLength(0);
  });
});

describe("anwesenheitFuerTag (Lesefunktion für Schichtplan und Tagesseite)", () => {
  test("liefert A und F eines Tages, nie O, nie andere Tage oder Lager", async () => {
    const t = await neuerTag();
    const u = await neuerTag();
    const kind = randomUUID();
    await alsLeitung([
      { personId: konten.team.id, ...felder(t, "A", [t.abschnitte[0]!])[0] },
      { personId: konten.team.id, ...felder(t, "F", [t.abschnitte[1]!])[0] },
      { personId: konten.leitung.id, ...felder(t, "A", [t.abschnitte[0]!])[0] },
      { teilnehmerId: kind, ...felder(t, "A", [t.abschnitte[2]!])[0] },
      { personId: konten.team.id, ...felder(u, "A", [u.abschnitte[0]!])[0] },
    ]);
    // Ein geöffnetes Feld (O) zählt nicht
    await alsLeitung([
      {
        personId: konten.leitung.id,
        ...felder(t, "A", [t.abschnitte[0]!])[0],
        version: 1,
      },
    ]);
    const o = await alsLeitung([
      {
        personId: konten.leitung.id,
        ...felder(t, "O", [t.abschnitte[0]!])[0],
        version: 1,
      },
    ]);
    expect(o.status).toBe(200);
    const tf = await neuerTag(fremdLagerId);
    await db.insert(schema.anwesenheit).values({
      lagerId: fremdLagerId,
      personId: konten.fremdeAbteilung.id!,
      lagertagId: tf.tag,
      tagesabschnittId: tf.abschnitte[0]!,
      wert: "A",
      lagerSeq: 0,
    });
    const zeilen = await anwesenheitFuerTag(db, lagerId, t.tag);
    expect(zeilen).toHaveLength(3);
    expect(zeilen).toEqual(
      expect.arrayContaining([
        {
          personId: konten.team.id,
          teilnehmerId: null,
          tagesabschnittId: t.abschnitte[0],
          wert: "A",
        },
        {
          personId: konten.team.id,
          teilnehmerId: null,
          tagesabschnittId: t.abschnitte[1],
          wert: "F",
        },
        {
          personId: null,
          teilnehmerId: kind,
          tagesabschnittId: t.abschnitte[2],
          wert: "A",
        },
      ]),
    );
    expect(await anwesenheitFuerTag(db, fremdLagerId, tf.tag)).toHaveLength(1);
  });
});

describe("Datenbank", () => {
  test("Anwesende: genau eine der beiden Angaben; ein Feld nur einmal", async () => {
    const t = await neuerTag();
    const roh = (werte: Record<string, unknown>) =>
      db.insert(schema.anwesenheit).values({
        lagerId,
        lagertagId: t.tag,
        tagesabschnittId: t.abschnitte[0]!,
        wert: "A",
        lagerSeq: 0,
        ...werte,
      });
    await expect(roh({})).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      roh({ personId: konten.team.id, teilnehmerId: randomUUID() }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      roh({ personId: konten.team.id, wert: "X" }),
    ).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    await roh({ personId: konten.team.id });
    await expect(roh({ personId: konten.team.id })).rejects.toMatchObject({
      cause: { code: "23505" },
    });
    const kind = randomUUID();
    await roh({ teilnehmerId: kind });
    await expect(roh({ teilnehmerId: kind })).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });

  test("eine offene Anfrage je Feld; Status und Entscheidzeit gehören zusammen", async () => {
    const t = await neuerTag();
    const roh = (werte: Record<string, unknown>) =>
      db.insert(schema.anwesenheitAnfrage).values({
        lagerId,
        personId: konten.team.id!,
        lagertagId: t.tag,
        tagesabschnittId: t.abschnitte[0]!,
        wert: "F",
        lagerSeq: 0,
        ...werte,
      });
    await roh({});
    await expect(roh({})).rejects.toMatchObject({ cause: { code: "23505" } });
    await roh({ status: "abgelehnt", entschiedenAm: new Date() });
    await expect(roh({ status: "abgelehnt" })).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    await expect(roh({ entschiedenAm: new Date() })).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    await expect(roh({ notiz: "" })).rejects.toMatchObject({
      cause: { code: "23514" },
    });
  });

  test("das Lager nimmt Anwesenheit und Anfragen mit", async () => {
    const [l] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Weg",
        von: "2027-07-10",
        bis: "2027-07-24",
      })
      .returning({ id: schema.lager.id });
    const t = await neuerTag(l!.id);
    await db.insert(schema.anwesenheit).values({
      lagerId: l!.id,
      teilnehmerId: randomUUID(),
      lagertagId: t.tag,
      tagesabschnittId: t.abschnitte[0]!,
      wert: "A",
      lagerSeq: 0,
    });
    await db.insert(schema.anwesenheitAnfrage).values({
      lagerId: l!.id,
      personId: konten.team.id!,
      lagertagId: t.tag,
      tagesabschnittId: t.abschnitte[0]!,
      wert: "F",
      lagerSeq: 0,
    });
    await db.delete(schema.lager).where(eq(schema.lager.id, l!.id));
    expect(
      await db
        .select()
        .from(schema.anwesenheit)
        .where(eq(schema.anwesenheit.lagerId, l!.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.anwesenheitAnfrage)
        .where(eq(schema.anwesenheitAnfrage.lagerId, l!.id)),
    ).toHaveLength(0);
  });
});
