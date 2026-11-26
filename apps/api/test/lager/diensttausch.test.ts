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

// Jede Abfrage an die Datenbank zählt mit: Der Test der Datenbanklast vergleicht die Zahl je Route für kleine und grosse Listen
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
      titel: "Tauschlager",
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

const T = (id = lagerId) => `/api/v1/lager/${id}/diensttausch`;
const leiter = () => konten.lagerleitung;
const UNBEKANNT = "00000000-0000-4000-8000-000000000000";

async function wegwerfMitglied(id = lagerId) {
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
    .values({ lagerId: id, personId: p!.id, rolle: "team" });
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

const benachrichtigungen = (personId: string, art: string, id = lagerId) =>
  db
    .select()
    .from(schema.lagerBenachrichtigung)
    .where(
      and(
        eq(schema.lagerBenachrichtigung.personId, personId),
        eq(schema.lagerBenachrichtigung.lagerId, id),
        eq(schema.lagerBenachrichtigung.art, art),
      ),
    );

// Ein Lagertag mit drei Abschnitten und je einem Dienst, direkt angelegt; je Aufruf ein anderes Datum
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
const neuerDienst = async (abschnittId: string, id = lagerId) =>
  (
    await db
      .insert(schema.dienst)
      .values({
        lagerId: id,
        name: `Dienst ${randomUUID().slice(0, 8)}`,
        tagesabschnittId: abschnittId,
        lagerSeq: 0,
      })
      .returning({ id: schema.dienst.id })
  )[0]!.id;
const neueSchicht = async (
  tag: string,
  abschnittId: string,
  dienstId: string,
  personId: string,
  id = lagerId,
) =>
  (
    await db
      .insert(schema.schicht)
      .values({
        lagerId: id,
        lagertagId: tag,
        tagesabschnittId: abschnittId,
        dienstId,
        personId,
        lagerSeq: 0,
      })
      .returning({ id: schema.schicht.id })
  )[0]!.id;
const schichtZeile = async (id: string) =>
  (await db.select().from(schema.schicht).where(eq(schema.schicht.id, id)))[0]!;
const abwesend = (personId: string, tag: string, abschnittId: string) =>
  db.insert(schema.anwesenheit).values({
    lagerId,
    personId,
    lagertagId: tag,
    tagesabschnittId: abschnittId,
    wert: "F",
    lagerSeq: 0,
  });

// Eine eigene Schicht des Teams und die Anfrage dazu
async function mitAnfrage(
  wunsch: (s: {
    tag: string;
    abschnitte: string[];
    schichtId: string;
  }) => Record<string, unknown> = () => ({}),
) {
  const t = await neuerTag();
  const dienst = await neuerDienst(t.abschnitte[0]!);
  const schichtId = await neueSchicht(
    t.tag,
    t.abschnitte[0]!,
    dienst,
    konten.team.id!,
  );
  const a = await anfrage(konten.team, "POST", T(), {
    schichtId,
    ...wunsch({ ...t, schichtId }),
  });
  expect(a.status).toBe(201);
  return { ...t, dienst, schichtId, tausch: a.body };
}
const entscheide = (
  tauschId: string,
  body: Record<string, unknown>,
  konto = leiter(),
  id = lagerId,
) => anfrage(konto, "POST", `${T(id)}/${tauschId}/entscheid`, body);

describe("Rechte je Lager-Persona", () => {
  // diensttausch.entscheiden: Lagerleitung, Abteilungsleitung, Leitung; diensttausch.anfragen: dazu das Team
  const alle: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const eigeneStatus: Record<LagerPersona, number> = {
    ...alle,
    team: 200,
  };
  test.each(LAGER_PERSONAS)("GET /diensttausch als %s", async (persona) => {
    const a = await anfrage(konten[persona], "GET", T());
    expect(a.status).toBe(alle[persona]);
  });
  test.each(LAGER_PERSONAS)(
    "GET /diensttausch/eigene als %s",
    async (persona) => {
      const a = await anfrage(konten[persona], "GET", `${T()}/eigene`);
      expect(a.status).toBe(eigeneStatus[persona]);
    },
  );
  test("fremdes Lager ist für alle 404", async () => {
    expect((await anfrage(leiter(), "GET", T(fremdLagerId))).status).toBe(404);
    expect(
      (
        await anfrage(leiter(), "POST", T(fremdLagerId), {
          schichtId: UNBEKANNT,
        })
      ).status,
    ).toBe(404);
  });
  test("im abgeschlossenen Lager gilt der Schreibschutz", async () => {
    const a = await anfrage(konten.team, "POST", T(geschlossenId), {
      schichtId: UNBEKANNT,
    });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("LAGER_GESCHLOSSEN");
    // Lesen bleibt erlaubt
    expect((await anfrage(leiter(), "GET", T(geschlossenId))).status).toBe(200);
  });
  test("die Abteilungsleitung ist kein Mitglied und stellt keine Anfrage, entscheidet aber", async () => {
    const a = await anfrage(konten.abteilungsleitung, "POST", T(), {
      schichtId: UNBEKANNT,
    });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("KEIN_MITGLIED");
    const s = await mitAnfrage();
    const e = await entscheide(
      s.tausch.id,
      { entscheid: "abgelehnt", version: 1 },
      konten.abteilungsleitung,
    );
    expect(e.status).toBe(200);
  });
  test("Team und Lesen entscheiden nicht, die Leitung schon", async () => {
    const s = await mitAnfrage();
    for (const konto of [konten.team, konten.lesen]) {
      expect(
        (
          await entscheide(
            s.tausch.id,
            { entscheid: "abgelehnt", version: 1 },
            konto,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await entscheide(
          s.tausch.id,
          { entscheid: "abgelehnt", version: 1 },
          konten.leitung,
        )
      ).status,
    ).toBe(200);
  });
});

describe("Anfrage stellen", () => {
  test("Übernahme mit Wunschperson: die Lagerleitung bekommt Benachrichtigung und Push ohne Namen", async () => {
    const tokenLeitung = await pushToken(konten.lagerleitung.id!);
    const tokenTeam = await pushToken(konten.team.id!);
    const wunsch = await wegwerfMitglied();
    const t = await neuerTag();
    const dienst = await neuerDienst(t.abschnitte[0]!);
    const schichtId = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      dienst,
      konten.team.id!,
    );
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId,
      mitPersonId: wunsch,
      notiz: "  Arzttermin  ",
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      version: 1,
      vonPersonId: konten.team.id,
      schichtId,
      mitPersonId: wunsch,
      mitSchichtId: null,
      notiz: "Arzttermin",
      status: "offen",
      entschiedenVon: null,
      entschiedenAm: null,
    });
    // Die Schicht ist noch unverändert
    expect((await schichtZeile(schichtId)).personId).toBe(konten.team.id);
    expect(
      await benachrichtigungen(konten.lagerleitung.id!, "diensttausch_anfrage"),
    ).not.toHaveLength(0);
    // Die anfragende Person bekommt nichts, auch wenn sie ein Gerät hat
    expect(
      await benachrichtigungen(konten.team.id!, "diensttausch_anfrage"),
    ).toHaveLength(0);
    const nachricht = gesendet.find(
      (n) => "token" in n && n.token === tokenLeitung,
    );
    expect(nachricht!.notification?.body).toBe("Tauschlager");
    expect(nachricht!.data).toMatchObject({ typ: "lager_einteilung" });
    expect(JSON.stringify(nachricht)).not.toContain(schichtId);
    expect(JSON.stringify(nachricht)).not.toContain(wunsch);
    expect(gesendet.some((n) => "token" in n && n.token === tokenTeam)).toBe(
      false,
    );
  });

  test("Tausch mit einer Wunschschicht: die Wunschperson ergibt sich aus der Schicht", async () => {
    const andere = await wegwerfMitglied();
    const t = await neuerTag();
    const d1 = await neuerDienst(t.abschnitte[0]!);
    const d2 = await neuerDienst(t.abschnitte[1]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d1,
      konten.team.id!,
    );
    const ihre = await neueSchicht(t.tag, t.abschnitte[1]!, d2, andere);
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId: meine,
      mitSchichtId: ihre,
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ mitPersonId: andere, mitSchichtId: ihre });
  });

  test("eine fremde Schicht wird abgelehnt (403), eine unbekannte oder fremdes Lager ist 404", async () => {
    const t = await neuerTag();
    const d = await neuerDienst(t.abschnitte[0]!);
    const fremde = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d,
      konten.leitung.id!,
    );
    const a = await anfrage(konten.team, "POST", T(), { schichtId: fremde });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("NICHT_DEINE_SCHICHT");
    expect(
      (await anfrage(konten.team, "POST", T(), { schichtId: UNBEKANNT }))
        .status,
    ).toBe(404);
    // Eine Schicht eines anderen Lagers ist in diesem Lager unbekannt
    const t2 = await neuerTag(geschlossenId);
    const d2 = await neuerDienst(t2.abschnitte[0]!, geschlossenId);
    const dort = await neueSchicht(
      t2.tag,
      t2.abschnitte[0]!,
      d2,
      konten.team.id!,
      geschlossenId,
    );
    expect(
      (await anfrage(konten.team, "POST", T(), { schichtId: dort })).status,
    ).toBe(404);
    // Die Schicht eines Teilnehmenden gehört keiner Person
    const [kind] = await db
      .insert(schema.teilnehmer)
      .values({
        lagerId,
        vorname: "Kind",
        nachname: "Test",
        stufe: "Wolf",
        lagerSeq: 0,
      })
      .returning({ id: schema.teilnehmer.id });
    const [ts] = await db
      .insert(schema.schicht)
      .values({
        lagerId,
        lagertagId: t.tag,
        tagesabschnittId: t.abschnitte[0]!,
        dienstId: d,
        teilnehmerId: kind!.id,
        lagerSeq: 0,
      })
      .returning({ id: schema.schicht.id });
    expect(
      (await anfrage(konten.team, "POST", T(), { schichtId: ts!.id })).status,
    ).toBe(403);
  });

  test("eine gelöschte Schicht und eine Schicht eines gelöschten Dienstes sind unbekannt", async () => {
    const t = await neuerTag();
    const d = await neuerDienst(t.abschnitte[0]!);
    const s = await neueSchicht(t.tag, t.abschnitte[0]!, d, konten.team.id!);
    await db.delete(schema.dienst).where(eq(schema.dienst.id, d));
    expect(
      (await anfrage(konten.team, "POST", T(), { schichtId: s })).status,
    ).toBe(404);
    const d2 = await neuerDienst(t.abschnitte[1]!);
    const s2 = await neueSchicht(t.tag, t.abschnitte[1]!, d2, konten.team.id!);
    await db.delete(schema.schicht).where(eq(schema.schicht.id, s2));
    expect(
      (await anfrage(konten.team, "POST", T(), { schichtId: s2 })).status,
    ).toBe(404);
  });

  test("ungültige Wünsche: beide Angaben, eigene Person, eigene oder fremde Wunschschicht, Nicht-Mitglied", async () => {
    const t = await neuerTag();
    const d = await neuerDienst(t.abschnitte[0]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d,
      konten.team.id!,
    );
    const d2 = await neuerDienst(t.abschnitte[1]!);
    const zweite = await neueSchicht(
      t.tag,
      t.abschnitte[1]!,
      d2,
      konten.team.id!,
    );
    const post = (b: Record<string, unknown>) =>
      anfrage(konten.team, "POST", T(), { schichtId: meine, ...b });
    expect(
      (await post({ mitSchichtId: zweite, mitPersonId: konten.leitung.id }))
        .status,
    ).toBe(400);
    const selbst = await post({ mitPersonId: konten.team.id });
    expect(selbst.status).toBe(400);
    expect(selbst.body.code).toBe("MIT_PERSON_UNGUELTIG");
    const eigene = await post({ mitSchichtId: zweite });
    expect(eigene.status).toBe(400);
    expect(eigene.body.code).toBe("MIT_SCHICHT_UNGUELTIG");
    // Ein Konto der Abteilung ohne Mitgliedschaft im Lager
    expect(
      (await post({ mitPersonId: konten.ohneMitgliedschaft.id })).status,
    ).toBe(404);
    expect((await post({ mitPersonId: UNBEKANNT })).status).toBe(404);
    expect((await post({ mitSchichtId: UNBEKANNT })).status).toBe(404);
    // Strikte Eingabe
    expect((await post({ unbekannt: 1 })).status).toBe(400);
    expect((await post({ notiz: "x".repeat(501) })).status).toBe(400);
    expect((await post({ notiz: "   " })).status).toBe(400);
    expect((await post({ notiz: "Ein\u0000Zeichen" })).status).toBe(400);
    expect((await anfrage(konten.team, "POST", T(), {})).status).toBe(400);
  });

  test("je Schicht höchstens eine offene Anfrage; nach dem Entscheid ist eine neue möglich", async () => {
    const s = await mitAnfrage();
    const doppelt = await anfrage(konten.team, "POST", T(), {
      schichtId: s.schichtId,
    });
    expect(doppelt.status).toBe(409);
    expect(doppelt.body.code).toBe("ANFRAGE_OFFEN");
    await entscheide(s.tausch.id, { entscheid: "abgelehnt", version: 1 });
    const neu = await anfrage(konten.team, "POST", T(), {
      schichtId: s.schichtId,
    });
    expect(neu.status).toBe(201);
  });
});

describe("Entscheiden", () => {
  test("annehmen (Übernahme): die Schicht wechselt, beide werden benachrichtigt, ein zweiter Entscheid scheitert", async () => {
    const uebernimmt = await wegwerfMitglied();
    const tokenTeam = await pushToken(konten.team.id!);
    const s = await mitAnfrage(() => ({ mitPersonId: uebernimmt }));
    // Das Team bekam in früheren Tests schon Entscheide: gezählt wird, was neu dazukommt
    const bisher = (
      await benachrichtigungen(konten.team.id!, "diensttausch_entscheid")
    ).length;
    gesendet = [];
    const e = await entscheide(s.tausch.id, {
      entscheid: "angenommen",
      version: 1,
    });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({
      id: s.tausch.id,
      status: "angenommen",
      version: 2,
      mitPersonId: uebernimmt,
      entschiedenVon: konten.lagerleitung.id,
    });
    expect(e.body.entschiedenAm).toBeTruthy();
    expect(await schichtZeile(s.schichtId)).toMatchObject({
      personId: uebernimmt,
      version: 2,
    });
    expect(
      await benachrichtigungen(konten.team.id!, "diensttausch_entscheid"),
    ).toHaveLength(bisher + 1);
    expect(
      await benachrichtigungen(uebernimmt, "diensttausch_entscheid"),
    ).toHaveLength(1);
    const nachricht = gesendet.find(
      (n) => "token" in n && n.token === tokenTeam,
    );
    expect(nachricht!.notification?.body).toBe("Tauschlager");
    expect(nachricht!.data).toMatchObject({ typ: "lager_einteilung" });
    expect(JSON.stringify(nachricht)).not.toMatch(/angenommen|abgelehnt/);
    // Zweiter Entscheid auf dieselbe Anfrage
    const nochmal = await entscheide(s.tausch.id, {
      entscheid: "abgelehnt",
      version: 2,
    });
    expect(nochmal.status).toBe(409);
    expect(nochmal.body.code).toBe("BEREITS_ENTSCHIEDEN");
    expect((await schichtZeile(s.schichtId)).personId).toBe(uebernimmt);
    // Die Schichtänderung steht im Änderungsfeed der Einteilung (Folgenummer der Schicht gestiegen)
    expect((await schichtZeile(s.schichtId)).lagerSeq).toBeGreaterThan(0);
  });

  test("annehmen (Tausch in verschiedenen Abschnitten): beide Personen wechseln", async () => {
    const andere = await wegwerfMitglied();
    const t = await neuerTag();
    const d1 = await neuerDienst(t.abschnitte[0]!);
    const d2 = await neuerDienst(t.abschnitte[1]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d1,
      konten.team.id!,
    );
    const ihre = await neueSchicht(t.tag, t.abschnitte[1]!, d2, andere);
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId: meine,
      mitSchichtId: ihre,
    });
    const e = await entscheide(a.body.id, {
      entscheid: "angenommen",
      version: 1,
    });
    expect(e.status).toBe(200);
    expect((await schichtZeile(meine)).personId).toBe(andere);
    expect((await schichtZeile(ihre)).personId).toBe(konten.team.id);
    expect(
      await benachrichtigungen(andere, "diensttausch_entscheid"),
    ).toHaveLength(1);
  });

  test("annehmen (Tausch im selben Abschnitt): die Dienste wechseln, die Personen bleiben", async () => {
    const andere = await wegwerfMitglied();
    const t = await neuerTag();
    const d1 = await neuerDienst(t.abschnitte[0]!);
    const d2 = await neuerDienst(t.abschnitte[0]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d1,
      konten.team.id!,
    );
    const ihre = await neueSchicht(t.tag, t.abschnitte[0]!, d2, andere);
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId: meine,
      mitSchichtId: ihre,
    });
    const e = await entscheide(a.body.id, {
      entscheid: "angenommen",
      version: 1,
    });
    expect(e.status).toBe(200);
    expect(await schichtZeile(meine)).toMatchObject({
      dienstId: d2,
      personId: konten.team.id,
    });
    expect(await schichtZeile(ihre)).toMatchObject({
      dienstId: d1,
      personId: andere,
    });
  });

  test("ohne Wunschperson nennt der Entscheid sie", async () => {
    const s = await mitAnfrage();
    const fehlt = await entscheide(s.tausch.id, {
      entscheid: "angenommen",
      version: 1,
    });
    expect(fehlt.status).toBe(400);
    expect(fehlt.body.code).toBe("MIT_PERSON_UNGUELTIG");
    // Beim Ablehnen ist keine Person erlaubt
    expect(
      (
        await entscheide(s.tausch.id, {
          entscheid: "abgelehnt",
          version: 1,
          mitPersonId: konten.leitung.id,
        })
      ).status,
    ).toBe(400);
    const person = await wegwerfMitglied();
    const e = await entscheide(s.tausch.id, {
      entscheid: "angenommen",
      version: 1,
      mitPersonId: person,
    });
    expect(e.status).toBe(200);
    expect(e.body.mitPersonId).toBe(person);
    expect((await schichtZeile(s.schichtId)).personId).toBe(person);
  });

  test("eine andere Person als die Wunschperson ist ungültig", async () => {
    const wunsch = await wegwerfMitglied();
    const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
    const e = await entscheide(s.tausch.id, {
      entscheid: "angenommen",
      version: 1,
      mitPersonId: konten.leitung.id,
    });
    expect(e.status).toBe(400);
    expect((await schichtZeile(s.schichtId)).personId).toBe(konten.team.id);
  });

  test("ablehnen ändert die Schicht nicht und benachrichtigt die anfragende Person", async () => {
    const wunsch = await wegwerfMitglied();
    const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
    const e = await entscheide(s.tausch.id, {
      entscheid: "abgelehnt",
      version: 1,
    });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ status: "abgelehnt", version: 2 });
    expect(await schichtZeile(s.schichtId)).toMatchObject({
      personId: konten.team.id,
      version: 1,
    });
    expect(
      await benachrichtigungen(konten.team.id!, "diensttausch_entscheid"),
    ).not.toHaveLength(0);
    // Die Wunschperson erfährt von einer Ablehnung nichts
    expect(
      await benachrichtigungen(wunsch, "diensttausch_entscheid"),
    ).toHaveLength(0);
  });

  test("unbekannte Anfrage 404, fremdes Lager 404, ungültige Eingabe 400", async () => {
    expect(
      (await entscheide(UNBEKANNT, { entscheid: "abgelehnt", version: 1 }))
        .status,
    ).toBe(404);
    const s = await mitAnfrage();
    expect(
      (
        await entscheide(
          s.tausch.id,
          { entscheid: "abgelehnt", version: 1 },
          leiter(),
          fremdLagerId,
        )
      ).status,
    ).toBe(404);
    expect(
      (await entscheide(s.tausch.id, { entscheid: "vielleicht", version: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await entscheide(s.tausch.id, { entscheid: "abgelehnt" })).status,
    ).toBe(400);
    expect(
      (
        await entscheide(s.tausch.id, {
          entscheid: "abgelehnt",
          version: 1,
          extra: 1,
        })
      ).status,
    ).toBe(400);
  });

  test("eine veraltete Version ist ein Versionskonflikt, nichts ändert sich", async () => {
    const wunsch = await wegwerfMitglied();
    const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
    const e = await entscheide(s.tausch.id, {
      entscheid: "angenommen",
      version: 7,
    });
    expect(e.status).toBe(409);
    expect(e.body.code).toBe("VERSION_KONFLIKT");
    expect(e.body.aktuell).toMatchObject({
      id: s.tausch.id,
      version: 1,
      status: "offen",
    });
    expect((await schichtZeile(s.schichtId)).personId).toBe(konten.team.id);
    const [zeile] = await db
      .select()
      .from(schema.diensttausch)
      .where(eq(schema.diensttausch.id, s.tausch.id));
    expect(zeile).toMatchObject({ status: "offen", version: 1 });
  });

  describe("Regeln des Schichtplans gelten erneut", () => {
    test("wer abwesend (F) ist, übernimmt nicht (ABWESEND); die Anfrage bleibt offen und lässt sich ablehnen", async () => {
      const wunsch = await wegwerfMitglied();
      const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
      await abwesend(wunsch, s.tag, s.abschnitte[0]!);
      const e = await entscheide(s.tausch.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect(e.status).toBe(409);
      expect(e.body.code).toBe("ABWESEND");
      expect((await schichtZeile(s.schichtId)).personId).toBe(konten.team.id);
      expect(
        (await entscheide(s.tausch.id, { entscheid: "abgelehnt", version: 1 }))
          .status,
      ).toBe(200);
    });

    test("wer im Abschnitt schon einen anderen Dienst hat, übernimmt nicht (DOPPELBELEGT)", async () => {
      const wunsch = await wegwerfMitglied();
      const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
      const anderer = await neuerDienst(s.abschnitte[0]!);
      await neueSchicht(s.tag, s.abschnitte[0]!, anderer, wunsch);
      const e = await entscheide(s.tausch.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect(e.status).toBe(409);
      expect(e.body.code).toBe("DOPPELBELEGT");
    });

    test("beim Tausch gilt es auch für die anfragende Person", async () => {
      const andere = await wegwerfMitglied();
      const t = await neuerTag();
      const d1 = await neuerDienst(t.abschnitte[0]!);
      const d2 = await neuerDienst(t.abschnitte[1]!);
      const meine = await neueSchicht(
        t.tag,
        t.abschnitte[0]!,
        d1,
        konten.team.id!,
      );
      const ihre = await neueSchicht(t.tag, t.abschnitte[1]!, d2, andere);
      const a = await anfrage(konten.team, "POST", T(), {
        schichtId: meine,
        mitSchichtId: ihre,
      });
      // Das Team wäre danach im zweiten Abschnitt, in dem es abwesend ist
      await abwesend(konten.team.id!, t.tag, t.abschnitte[1]!);
      const e = await entscheide(a.body.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect(e.status).toBe(409);
      expect(e.body.code).toBe("ABWESEND");
      expect((await schichtZeile(meine)).personId).toBe(konten.team.id);
      expect((await schichtZeile(ihre)).personId).toBe(andere);
    });

    test("ein deaktiviertes Konto übernimmt nicht (PERSON_NICHT_VERFUEGBAR)", async () => {
      const wunsch = await wegwerfMitglied();
      const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
      await db
        .update(schema.user)
        .set({ deaktiviertAm: new Date() })
        .where(eq(schema.user.id, wunsch));
      const e = await entscheide(s.tausch.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect(e.status).toBe(409);
      expect(e.body.code).toBe("PERSON_NICHT_VERFUEGBAR");
    });

    test("ist die Schicht inzwischen anders besetzt, scheitert das Annehmen (SCHICHT_GEAENDERT); ist sie gelöscht, ist die Anfrage mit ihr weg", async () => {
      const wunsch = await wegwerfMitglied();
      const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
      await db
        .update(schema.schicht)
        .set({ personId: konten.leitung.id })
        .where(eq(schema.schicht.id, s.schichtId));
      const e = await entscheide(s.tausch.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect(e.status).toBe(409);
      expect(e.body.code).toBe("SCHICHT_GEAENDERT");
      // Die Schicht ist endgültig weg: Die Anfrage geht mit ihr (CASCADE), es gibt nichts mehr zu entscheiden
      await db.delete(schema.schicht).where(eq(schema.schicht.id, s.schichtId));
      const e2 = await entscheide(s.tausch.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect([e2.status, e2.body.code]).toEqual([404, "NICHT_GEFUNDEN"]);
      expect(
        (await entscheide(s.tausch.id, { entscheid: "abgelehnt", version: 1 }))
          .status,
      ).toBe(404);
    });

    test("beim Tausch zählt auch die Wunschschicht (SCHICHT_GEAENDERT, wenn sie die Person gewechselt hat)", async () => {
      const andere = await wegwerfMitglied();
      const t = await neuerTag();
      const d1 = await neuerDienst(t.abschnitte[0]!);
      const d2 = await neuerDienst(t.abschnitte[1]!);
      const meine = await neueSchicht(
        t.tag,
        t.abschnitte[0]!,
        d1,
        konten.team.id!,
      );
      const ihre = await neueSchicht(t.tag, t.abschnitte[1]!, d2, andere);
      const a = await anfrage(konten.team, "POST", T(), {
        schichtId: meine,
        mitSchichtId: ihre,
      });
      await db
        .update(schema.schicht)
        .set({ personId: konten.leitung.id })
        .where(eq(schema.schicht.id, ihre));
      const e = await entscheide(a.body.id, {
        entscheid: "angenommen",
        version: 1,
      });
      expect(e.body.code).toBe("SCHICHT_GEAENDERT");
    });
  });

  describe("Gleichzeitigkeit", () => {
    test("zwei gleichzeitige Entscheide auf dieselbe Anfrage: genau einer gewinnt, die Schicht wechselt einmal", async () => {
      const wunsch = await wegwerfMitglied();
      const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
      const [a, b] = await Promise.all([
        entscheide(s.tausch.id, { entscheid: "angenommen", version: 1 }),
        entscheide(
          s.tausch.id,
          { entscheid: "angenommen", version: 1 },
          konten.leitung,
        ),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const verlierer = a.status === 409 ? a : b;
      expect(verlierer.body.code).toBe("BEREITS_ENTSCHIEDEN");
      expect(await schichtZeile(s.schichtId)).toMatchObject({
        personId: wunsch,
        version: 2,
      });
      expect(
        await benachrichtigungen(wunsch, "diensttausch_entscheid"),
      ).toHaveLength(1);
    });

    test("gleichzeitig annehmen und ablehnen: genau einer gewinnt", async () => {
      const wunsch = await wegwerfMitglied();
      const s = await mitAnfrage(() => ({ mitPersonId: wunsch }));
      const [a, b] = await Promise.all([
        entscheide(s.tausch.id, { entscheid: "angenommen", version: 1 }),
        entscheide(s.tausch.id, { entscheid: "abgelehnt", version: 1 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const [zeile] = await db
        .select()
        .from(schema.diensttausch)
        .where(eq(schema.diensttausch.id, s.tausch.id));
      expect(zeile!.version).toBe(2);
      expect((await schichtZeile(s.schichtId)).personId).toBe(
        zeile!.status === "angenommen" ? wunsch : konten.team.id,
      );
    });

    test("zwei Anfragen wollen dieselbe Person im selben Abschnitt: die zweite Annahme scheitert (DOPPELBELEGT)", async () => {
      const wunsch = await wegwerfMitglied();
      const t = await neuerTag();
      const d1 = await neuerDienst(t.abschnitte[0]!);
      const d2 = await neuerDienst(t.abschnitte[0]!);
      const s1 = await neueSchicht(
        t.tag,
        t.abschnitte[0]!,
        d1,
        konten.team.id!,
      );
      const s2 = await neueSchicht(
        t.tag,
        t.abschnitte[0]!,
        d2,
        konten.leitung.id!,
      );
      const a1 = await anfrage(konten.team, "POST", T(), {
        schichtId: s1,
        mitPersonId: wunsch,
      });
      const a2 = await anfrage(konten.leitung, "POST", T(), {
        schichtId: s2,
        mitPersonId: wunsch,
      });
      expect(a1.status).toBe(201);
      expect(a2.status).toBe(201);
      const [x, y] = await Promise.all([
        entscheide(a1.body.id, { entscheid: "angenommen", version: 1 }),
        entscheide(a2.body.id, { entscheid: "angenommen", version: 1 }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      expect((x.status === 409 ? x : y).body.code).toBe("DOPPELBELEGT");
      // Wunschperson steht genau einmal im Abschnitt
      const zeilen = await db
        .select()
        .from(schema.schicht)
        .where(
          and(
            eq(schema.schicht.lagertagId, t.tag),
            eq(schema.schicht.personId, wunsch),
          ),
        );
      expect(zeilen).toHaveLength(1);
    });
  });
});

describe("Entscheid zurücknehmen (#848)", () => {
  const zuruecknehmen = (
    tauschId: string,
    version: number,
    konto = leiter(),
    id = lagerId,
  ) =>
    anfrage(konto, "POST", `${T(id)}/${tauschId}/entscheid/zuruecknehmen`, {
      version,
    });
  const tauschZeile = async (id: string) =>
    (
      await db
        .select()
        .from(schema.diensttausch)
        .where(eq(schema.diensttausch.id, id))
    )[0]!;

  test("Übernahme: die Schicht kommt zurück, die Anfrage ist offen und lässt sich neu entscheiden", async () => {
    const uebernimmt = await wegwerfMitglied();
    const s = await mitAnfrage(() => ({ mitPersonId: uebernimmt }));
    await entscheide(s.tausch.id, { entscheid: "angenommen", version: 1 });
    const z = await zuruecknehmen(s.tausch.id, 2);
    expect(z.status).toBe(200);
    expect(z.body).toMatchObject({
      id: s.tausch.id,
      status: "offen",
      version: 3,
      mitPersonId: uebernimmt,
      entschiedenVon: null,
      entschiedenAm: null,
    });
    expect(await schichtZeile(s.schichtId)).toMatchObject({
      personId: konten.team.id,
      version: 3,
    });
    const e = await entscheide(s.tausch.id, {
      entscheid: "abgelehnt",
      version: 3,
    });
    expect(e.status).toBe(200);
  });

  test("Tausch in verschiedenen Abschnitten: beide Personen kommen zurück", async () => {
    const andere = await wegwerfMitglied();
    const t = await neuerTag();
    const d1 = await neuerDienst(t.abschnitte[0]!);
    const d2 = await neuerDienst(t.abschnitte[1]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d1,
      konten.team.id!,
    );
    const ihre = await neueSchicht(t.tag, t.abschnitte[1]!, d2, andere);
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId: meine,
      mitSchichtId: ihre,
    });
    await entscheide(a.body.id, { entscheid: "angenommen", version: 1 });
    expect((await zuruecknehmen(a.body.id, 2)).status).toBe(200);
    expect((await schichtZeile(meine)).personId).toBe(konten.team.id);
    expect((await schichtZeile(ihre)).personId).toBe(andere);
  });

  test("Tausch im selben Abschnitt: die Dienste kommen zurück", async () => {
    const andere = await wegwerfMitglied();
    const t = await neuerTag();
    const d1 = await neuerDienst(t.abschnitte[0]!);
    const d2 = await neuerDienst(t.abschnitte[0]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d1,
      konten.team.id!,
    );
    const ihre = await neueSchicht(t.tag, t.abschnitte[0]!, d2, andere);
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId: meine,
      mitSchichtId: ihre,
    });
    await entscheide(a.body.id, { entscheid: "angenommen", version: 1 });
    expect((await zuruecknehmen(a.body.id, 2)).status).toBe(200);
    expect(await schichtZeile(meine)).toMatchObject({
      dienstId: d1,
      personId: konten.team.id,
    });
    expect(await schichtZeile(ihre)).toMatchObject({
      dienstId: d2,
      personId: andere,
    });
  });

  test("abgelehnt: die Anfrage ist wieder offen, die Schicht bleibt", async () => {
    const s = await mitAnfrage();
    await entscheide(s.tausch.id, { entscheid: "abgelehnt", version: 1 });
    const vorher = await schichtZeile(s.schichtId);
    const z = await zuruecknehmen(s.tausch.id, 2);
    expect(z.status).toBe(200);
    expect(z.body).toMatchObject({ status: "offen", version: 3 });
    expect(await schichtZeile(s.schichtId)).toMatchObject({
      personId: konten.team.id,
      version: vorher.version,
    });
  });

  test("offen oder zurückgezogen ist nicht entschieden (409), eine neue offene Anfrage für die Schicht verhindert es (409)", async () => {
    const s = await mitAnfrage();
    const offen = await zuruecknehmen(s.tausch.id, 1);
    expect(offen.status).toBe(409);
    expect(offen.body.code).toBe("NICHT_ENTSCHIEDEN");
    await anfrage(konten.team, "POST", `${T()}/${s.tausch.id}/zurueckziehen`, {
      version: 1,
    });
    expect((await zuruecknehmen(s.tausch.id, 2)).body.code).toBe(
      "NICHT_ENTSCHIEDEN",
    );

    const r = await mitAnfrage();
    await entscheide(r.tausch.id, { entscheid: "abgelehnt", version: 1 });
    const neu = await anfrage(konten.team, "POST", T(), {
      schichtId: r.schichtId,
    });
    expect(neu.status).toBe(201);
    const z = await zuruecknehmen(r.tausch.id, 2);
    expect(z.status).toBe(409);
    expect(z.body.code).toBe("ANFRAGE_OFFEN");
    expect((await tauschZeile(r.tausch.id)).status).toBe("abgelehnt");
  });

  test("ist eine Schicht seit dem Entscheid geändert, bucht nichts zurück (SCHICHT_GEAENDERT)", async () => {
    const uebernimmt = await wegwerfMitglied();
    const s = await mitAnfrage(() => ({ mitPersonId: uebernimmt }));
    await entscheide(s.tausch.id, { entscheid: "angenommen", version: 1 });
    // Eine spätere Änderung hat eine höhere Folgenummer
    const nach = await schichtZeile(s.schichtId);
    await db
      .update(schema.schicht)
      .set({ lagerSeq: nach.lagerSeq + 10 })
      .where(eq(schema.schicht.id, s.schichtId));
    const z = await zuruecknehmen(s.tausch.id, 2);
    expect(z.status).toBe(409);
    expect(z.body.code).toBe("SCHICHT_GEAENDERT");
    expect((await schichtZeile(s.schichtId)).personId).toBe(uebernimmt);
    expect((await tauschZeile(s.tausch.id)).status).toBe("angenommen");
  });

  test("wer zurückkommt, muss die Regeln erfüllen: abwesend (F) bucht nichts zurück", async () => {
    const uebernimmt = await wegwerfMitglied();
    const s = await mitAnfrage(() => ({ mitPersonId: uebernimmt }));
    await entscheide(s.tausch.id, { entscheid: "angenommen", version: 1 });
    await abwesend(konten.team.id!, s.tag, s.abschnitte[0]!);
    const z = await zuruecknehmen(s.tausch.id, 2);
    expect(z.status).toBe(409);
    expect(z.body.code).toBe("ABWESEND");
    expect((await schichtZeile(s.schichtId)).personId).toBe(uebernimmt);
    expect((await tauschZeile(s.tausch.id)).status).toBe("angenommen");
  });

  test("Rechte: Team und Lesen 403, die Leitung darf; unbekannt 404, fremdes Lager 404, veraltete Version 409", async () => {
    const s = await mitAnfrage();
    await entscheide(s.tausch.id, { entscheid: "abgelehnt", version: 1 });
    for (const konto of [konten.team, konten.lesen]) {
      expect((await zuruecknehmen(s.tausch.id, 2, konto)).status).toBe(403);
    }
    expect((await zuruecknehmen(UNBEKANNT, 1)).status).toBe(404);
    expect(
      (await zuruecknehmen(s.tausch.id, 2, leiter(), fremdLagerId)).status,
    ).toBe(404);
    const alt = await zuruecknehmen(s.tausch.id, 1);
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
    expect((await zuruecknehmen(s.tausch.id, 2, konten.leitung)).status).toBe(
      200,
    );
  });
});

describe("Zurückziehen und Listen", () => {
  test("die anfragende Person zieht zurück; danach ist kein Entscheid mehr möglich", async () => {
    const s = await mitAnfrage();
    const z = await anfrage(
      konten.team,
      "POST",
      `${T()}/${s.tausch.id}/zurueckziehen`,
      { version: 1 },
    );
    expect(z.status).toBe(200);
    expect(z.body).toMatchObject({
      status: "zurueckgezogen",
      version: 2,
      entschiedenVon: konten.team.id,
    });
    const e = await entscheide(s.tausch.id, {
      entscheid: "angenommen",
      version: 2,
      mitPersonId: konten.leitung.id,
    });
    expect(e.status).toBe(409);
    expect(e.body.code).toBe("BEREITS_ENTSCHIEDEN");
    const nochmal = await anfrage(
      konten.team,
      "POST",
      `${T()}/${s.tausch.id}/zurueckziehen`,
      { version: 2 },
    );
    expect(nochmal.body.code).toBe("BEREITS_ENTSCHIEDEN");
  });

  test("eine fremde Anfrage zieht niemand zurück (403), eine unbekannte ist 404, eine veraltete Version 409", async () => {
    const s = await mitAnfrage();
    const fremd = await anfrage(
      konten.leitung,
      "POST",
      `${T()}/${s.tausch.id}/zurueckziehen`,
      { version: 1 },
    );
    expect(fremd.status).toBe(403);
    expect(fremd.body.code).toBe("NICHT_DEINE_ANFRAGE");
    expect(
      (
        await anfrage(
          konten.team,
          "POST",
          `${T()}/${UNBEKANNT}/zurueckziehen`,
          { version: 1 },
        )
      ).status,
    ).toBe(404);
    const alt = await anfrage(
      konten.team,
      "POST",
      `${T()}/${s.tausch.id}/zurueckziehen`,
      { version: 9 },
    );
    expect(alt.status).toBe(409);
    expect(alt.body.code).toBe("VERSION_KONFLIKT");
  });

  test("eigene Liste: nur die eigenen Anfragen; Gesamtliste mit Filter und Seiten", async () => {
    const a = await mitAnfrage();
    const t = await neuerTag();
    const d = await neuerDienst(t.abschnitte[0]!);
    const fremdeSchicht = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      d,
      konten.leitung.id!,
    );
    const b = await anfrage(konten.leitung, "POST", T(), {
      schichtId: fremdeSchicht,
    });
    const eigene = await anfrage(konten.team, "GET", `${T()}/eigene`);
    expect(eigene.status).toBe(200);
    const ids = eigene.body.tausche.map((x: { id: string }) => x.id);
    expect(ids).toContain(a.tausch.id);
    expect(ids).not.toContain(b.body.id);
    expect(
      eigene.body.tausche.every(
        (x: { vonPersonId: string }) => x.vonPersonId === konten.team.id,
      ),
    ).toBe(true);

    const alle = await anfrage(leiter(), "GET", `${T()}?status=offen&limit=1`);
    expect(alle.status).toBe(200);
    expect(alle.body.tausche).toHaveLength(1);
    expect(alle.body.naechster).toBe(alle.body.tausche[0].id);
    const weiter = await anfrage(
      leiter(),
      "GET",
      `${T()}?status=offen&limit=1&nach=${alle.body.naechster}`,
    );
    expect(weiter.body.tausche[0].id).not.toBe(alle.body.tausche[0].id);
    expect(
      (await anfrage(leiter(), "GET", `${T()}?status=unbekannt`)).status,
    ).toBe(400);
    expect((await anfrage(leiter(), "GET", `${T()}?limit=1000`)).status).toBe(
      400,
    );
  });

  test("Datenbanklast: die Zahl der Abfragen hängt nicht von der Zahl der Anfragen ab", async () => {
    const zaehle = async (pfad: string, konto: PersonaKonto) => {
      await anfrage(konto, "GET", pfad);
      const vorher = abfragen;
      const a = await anfrage(konto, "GET", pfad);
      expect(a.status).toBe(200);
      return abfragen - vorher;
    };
    const lager = await legeLager(welt.testabteilungId);
    await mitgliederEintragen(lager);
    // Nacheinander: der Zähler ist global, parallele Aufrufe würden sich gegenseitig mitzählen
    const messen = async () => [
      await zaehle(T(lager), leiter()),
      await zaehle(`${T(lager)}/eigene`, konten.team),
    ];
    // 30 offene Anfragen mit je einer eigenen Schicht, in drei Statements; die erste vorab, weil eine leere Seite die Abfragen für Namen und Schichten spart (#520)
    const tage = await db
      .insert(schema.lagertag)
      .values(
        Array.from({ length: 30 }, (_, i) => ({
          lagerId: lager,
          datum: new Date(Date.UTC(2027, 6, 10 + i)).toISOString().slice(0, 10),
          lagerSeq: 0,
        })),
      )
      .returning({ id: schema.lagertag.id });
    const [abschnitt] = await db
      .insert(schema.tagesabschnitt)
      .values({ lagerId: lager, name: "Last", lagerSeq: 0 })
      .returning({ id: schema.tagesabschnitt.id });
    const dienst = await neuerDienst(abschnitt!.id, lager);
    const anfragenFuer = async (teil: typeof tage) => {
      const schichten = await db
        .insert(schema.schicht)
        .values(
          teil.map((t) => ({
            lagerId: lager,
            lagertagId: t.id,
            tagesabschnittId: abschnitt!.id,
            dienstId: dienst,
            personId: konten.team.id!,
            lagerSeq: 0,
          })),
        )
        .returning({ id: schema.schicht.id });
      await db.insert(schema.diensttausch).values(
        schichten.map((x) => ({
          lagerId: lager,
          vonPersonId: konten.team.id!,
          schichtId: x.id,
          lagerSeq: 0,
        })),
      );
    };
    await anfragenFuer(tage.slice(0, 1));
    const wenig = await messen();
    await anfragenFuer(tage.slice(1));
    const viel = await messen();
    // Eine Abfrage mehr oder weniger je Aufruf (Sitzung) ist Rauschen; 30 Zeilen mehr dürfen keine 30 Abfragen kosten
    viel.forEach((n, i) =>
      expect(Math.abs(n - wenig[i]!)).toBeLessThanOrEqual(1),
    );
    // Die Anfrage stellen und entscheiden: feste Zahl Abfragen, unabhängig von der Zahl der offenen Anfragen
    console.info("Abfragen je Aufruf (Liste, eigene):", viel);
  });
});

describe("Namen und Schicht-Details in den Antworten (#520)", () => {
  const mitglieder = async () =>
    new Map(
      (
        (await anfrage(leiter(), "GET", `/api/v1/lager/${lagerId}/mitglieder`))
          .body.mitglieder as { personId: string; name: string }[]
      ).map((m) => [m.personId, m.name]),
    );

  test("Anfrage, Listen und Entscheid nennen Anzeigenamen, Dienst, Tag und Abschnitt", async () => {
    const namen = await mitglieder();
    const m = await mitAnfrage(() => ({ mitPersonId: konten.leitung.id }));
    const [dienst] = await db
      .select()
      .from(schema.dienst)
      .where(eq(schema.dienst.id, m.dienst));
    const [abschnitt] = await db
      .select()
      .from(schema.tagesabschnitt)
      .where(eq(schema.tagesabschnitt.id, m.abschnitte[0]!));
    const [tag] = await db
      .select()
      .from(schema.lagertag)
      .where(eq(schema.lagertag.id, m.tag));
    const erwartet = {
      vonName: namen.get(konten.team.id!),
      mitName: namen.get(konten.leitung.id!),
      schicht: {
        dienst: dienst!.name,
        datum: tag!.datum,
        tagesabschnitt: abschnitt!.name,
      },
      mitSchicht: null,
    };
    expect(erwartet.vonName).toBeTruthy();
    // Die Antwort auf das Anlegen
    expect(m.tausch).toMatchObject(erwartet);
    // Die eigene Liste des Teams
    const eigene = await anfrage(konten.team, "GET", `${T()}/eigene`);
    expect(
      eigene.body.tausche.find((t: { id: string }) => t.id === m.tausch.id),
    ).toMatchObject(erwartet);
    // Die Liste der Lagerleitung
    const alle = await anfrage(leiter(), "GET", T());
    expect(
      alle.body.tausche.find((t: { id: string }) => t.id === m.tausch.id),
    ).toMatchObject(erwartet);
    // Der Entscheid
    const e = await entscheide(m.tausch.id, {
      entscheid: "abgelehnt",
      version: m.tausch.version,
    });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject(erwartet);
  });

  test("Zurückziehen nennt die Namen, ohne Wunschperson ist mitName null", async () => {
    const m = await mitAnfrage();
    expect(m.tausch.mitName).toBeNull();
    expect(m.tausch.mitSchicht).toBeNull();
    const z = await anfrage(
      konten.team,
      "POST",
      `${T()}/${m.tausch.id}/zurueckziehen`,
      { version: m.tausch.version },
    );
    expect(z.status).toBe(200);
    expect(z.body.vonName).toBeTruthy();
    expect(z.body.schicht).not.toBeNull();
  });

  test("Tausch mit einer Schicht der Wunschperson nennt auch deren Details", async () => {
    const t = await neuerTag();
    const dienst = await neuerDienst(t.abschnitte[0]!);
    const meine = await neueSchicht(
      t.tag,
      t.abschnitte[0]!,
      dienst,
      konten.team.id!,
    );
    const dienst2 = await neuerDienst(t.abschnitte[1]!);
    const ihre = await neueSchicht(
      t.tag,
      t.abschnitte[1]!,
      dienst2,
      konten.leitung.id!,
    );
    const a = await anfrage(konten.team, "POST", T(), {
      schichtId: meine,
      mitSchichtId: ihre,
    });
    expect(a.status).toBe(201);
    expect(a.body.mitSchicht).toMatchObject({
      tagesabschnitt: expect.any(String),
    });
    expect(a.body.mitSchicht.dienst).not.toBe(a.body.schicht.dienst);
    expect(a.body.mitName).toBeTruthy();
  });

  test("die Zahl der Abfragen hängt nicht von der Zahl der Anfragen ab", async () => {
    const messe = async () => {
      await anfrage(leiter(), "GET", T());
      const vorher = abfragen;
      const r = await anfrage(leiter(), "GET", T());
      return { n: abfragen - vorher, anzahl: r.body.tausche.length };
    };
    const klein = await messe();
    for (let i = 0; i < 4; i++) {
      const t = await neuerTag();
      const dienst = await neuerDienst(t.abschnitte[0]!);
      const mitglied = await wegwerfMitglied();
      const schicht = await neueSchicht(
        t.tag,
        t.abschnitte[0]!,
        dienst,
        mitglied,
      );
      await db.insert(schema.diensttausch).values({
        lagerId,
        vonPersonId: mitglied,
        schichtId: schicht,
        lagerSeq: 0,
      });
    }
    const gross = await messe();
    expect(gross.anzahl).toBeGreaterThanOrEqual(klein.anzahl + 4);
    expect(gross.n).toBe(klein.n);
  });
});
