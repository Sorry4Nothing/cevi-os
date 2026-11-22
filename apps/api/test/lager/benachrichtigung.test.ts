import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
} from "vitest";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import {
  ARTEN,
  ART_IDS,
  type BenachrichtigungsArt,
} from "../../src/lager/benachrichtigung-arten.js";
import {
  benachrichtige,
  GELESEN_AUFBEWAHRUNG_TAGE,
  loescheGeleseneBenachrichtigungen,
} from "../../src/lager/benachrichtigung.js";
import type { Fcm } from "../../src/push.js";
import { ladeSeiten } from "../../src/seiten.js";
import {
  bereiteAuthTestsVor,
  erstelleTestAuth,
  fcmNachricht,
} from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  schalteZweitenFaktorEin,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";

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

// Eine Attrappe statt firebase-admin: Kein Netz, keine Schlüssel
let gesendet: TokenMessage[];
let wirft: unknown;
const fcm: Fcm = {
  async sendEach(nachrichten) {
    gesendet.push(...nachrichten);
    if (wirft) throw wirft;
    return { responses: nachrichten.map(() => ({ success: true })) };
  },
};

let welt: Welt;
let admin: PersonaKonto;
let demoAdmin: PersonaKonto;
let eltern: PersonaKonto;
let sl: PersonaKonto;
let leitende: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, eltern, sl, leitende] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "leitendeA"),
  ]);
  // Auch als Lagerleitung (Rolle in einem Test) kommt sie durch: Die Lagerleitung braucht den zweiten Faktor (#423)
  sl = await schalteZweitenFaktorEin(welt, sl);
});

// Jede Anfrage schreibt sonst eine Log-Zeile in die Testausgabe
beforeEach(() => {
  gesendet = [];
  wirft = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function anfrage(
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
) {
  return app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

type Rolle = (typeof schema.lagerMitglied.$inferSelect)["rolle"];

async function legeLager(
  mitglieder: [string, Rolle][] = [],
  {
    status = "aktiv",
    abteilungId = welt.testabteilungId,
    titel = "Sommerlager",
  } = {},
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel,
      von: "2027-07-10",
      bis: "2027-07-24",
      status: status as "aktiv" | "abgeschlossen",
    })
    .returning({ id: schema.lager.id });
  for (const [personId, rolle] of mitglieder) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: zeile!.id, personId, rolle });
  }
  return zeile!.id;
}

const wegwerfPerson = async (
  extra: Partial<typeof schema.user.$inferInsert> = {},
) =>
  (
    await db
      .insert(schema.user)
      .values({
        name: "Wegwerf Person",
        email: `${randomUUID()}@example.org`,
        username: `wegwerf.${randomUUID().slice(0, 8)}`,
        abteilungId: welt.testabteilungId,
        mussPasswortAendern: false,
        ...extra,
      })
      .returning({ id: schema.user.id })
  )[0]!.id;

// Eine Sitzung und ein Push-Token für die Person
async function legeToken(userId: string) {
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

const zeilenVon = (personId: string, lagerId?: string) =>
  db
    .select()
    .from(schema.lagerBenachrichtigung)
    .where(
      and(
        eq(schema.lagerBenachrichtigung.personId, personId),
        lagerId ? eq(schema.lagerBenachrichtigung.lagerId, lagerId) : undefined,
      ),
    );

const sende = async (
  daten: Parameters<typeof benachrichtige>[1],
  ohneFcm = false,
) => {
  const zustellung = await db.transaction((tx) => benachrichtige(tx, daten));
  await zustellung.senden({ db, fcm: ohneFcm ? undefined : fcm });
  return zustellung;
};

describe("benachrichtige()", () => {
  test("Empfänger sind nur aktive Mitglieder des Lagers, nie fremde Konten", async () => {
    const [a, b, nichtMitglied, deaktiviert, gesperrt, fremd] =
      await Promise.all([
        wegwerfPerson(),
        wegwerfPerson(),
        wegwerfPerson(),
        wegwerfPerson({ deaktiviertAm: new Date() }),
        wegwerfPerson({ banned: true }),
        wegwerfPerson({ abteilungId: welt.demoAbteilungId }),
      ]);
    const lagerId = await legeLager([
      [a, "team"],
      [b, "lesen"],
      [deaktiviert, "team"],
      [gesperrt, "team"],
      // Eine Mitgliedszeile aus einer anderen Abteilung gibt nichts frei
      [fremd, "lagerleitung"],
    ]);
    const tokens = await Promise.all(
      [a, b, nichtMitglied, deaktiviert, gesperrt, fremd].map(legeToken),
    );
    const objektId = randomUUID();

    const zustellung = await sende({
      lagerId,
      empfaengerIds: [a, b, b, nichtMitglied, deaktiviert, gesperrt, fremd],
      art: "aufgabe_zugeteilt",
      objekt: { typ: "aufgabe", id: objektId },
    });

    expect(zustellung.empfaengerIds.sort()).toEqual([a, b].sort());
    for (const id of [nichtMitglied, deaktiviert, gesperrt, fremd]) {
      expect(await zeilenVon(id)).toEqual([]);
    }
    expect(await zeilenVon(a, lagerId)).toMatchObject([
      {
        art: "aufgabe_zugeteilt",
        objektTyp: "aufgabe",
        objektId,
        gelesenAm: null,
      },
    ]);
    expect(await zeilenVon(b, lagerId)).toHaveLength(1);
    expect(gesendet.map((n) => n.token).sort()).toEqual(
      [tokens[0]!, tokens[1]!].sort(),
    );
  });

  test("der Push trägt nur festen Titel, Lagertitel, typ und ID: nie Namen oder Inhalte", async () => {
    const empfaenger = await wegwerfPerson({ name: "Zora Einzigartig" });
    const lagerId = await legeLager([[empfaenger, "team"]], {
      titel: "Sommerlager",
    });
    const token = await legeToken(empfaenger);
    const objektId = randomUUID();

    await sende({
      lagerId,
      empfaengerIds: [empfaenger],
      art: "aufgabe_zugeteilt",
      // Ein Aufgabentitel gehört nicht in den Push, auch nicht, wenn das Modul ihn als Typ missbrauchen würde
      objekt: { typ: "Geheimer Aufgabentitel", id: objektId },
    });

    expect(gesendet).toEqual([
      fcmNachricht(
        token,
        "Neue Aufgabe für dich",
        { typ: "lager_aufgabe", id: objektId },
        "lager_aufgaben",
        "Sommerlager",
      ),
    ]);
    expect(JSON.stringify(gesendet)).not.toMatch(/Zora|Geheim|Einzigartig/);
  });

  test.each(ART_IDS)(
    "Art %s: Typ und Kanal folgen aus der Art",
    async (art) => {
      const empfaenger = await wegwerfPerson();
      const lagerId = await legeLager([[empfaenger, "team"]]);
      await legeToken(empfaenger);
      const objektId = randomUUID();
      await sende({
        lagerId,
        empfaengerIds: [empfaenger],
        art,
        objekt: { typ: "x", id: objektId },
      });
      const kanaele = {
        lager_aufgabe: "lager_aufgaben",
        lager_erwaehnung: "lager_mitteilungen",
        lager_pinnwand: "lager_mitteilungen",
        lager_eingang: "lager_mitteilungen",
        lager_einteilung: "lager_einteilung",
        lager_anwesenheit: "lager_einteilung",
      } as const;
      expect(gesendet).toHaveLength(1);
      expect(gesendet[0]!.data).toEqual({ typ: ARTEN[art].push, id: objektId });
      expect(gesendet[0]!.android?.notification?.channelId).toBe(
        kanaele[ARTEN[art].push],
      );
    },
  );

  test("der Auslöser bekommt weder Zeile noch Push", async () => {
    const [handelnd, andere] = await Promise.all([
      wegwerfPerson(),
      wegwerfPerson(),
    ]);
    const lagerId = await legeLager([
      [handelnd, "leitung"],
      [andere, "team"],
    ]);
    await Promise.all([legeToken(handelnd), legeToken(andere)]);
    const zustellung = await sende({
      lagerId,
      empfaengerIds: [handelnd, andere],
      art: "aufgabe_geaendert",
      objekt: { typ: "aufgabe", id: randomUUID() },
      ausgeloestVon: handelnd,
    });
    expect(zustellung.empfaengerIds).toEqual([andere]);
    expect(await zeilenVon(handelnd)).toEqual([]);
    expect(gesendet).toHaveLength(1);
  });

  test("eine abgeschaltete Art wirkt je Person und je Art: weder Zeile noch Push", async () => {
    const [aus, an] = await Promise.all([wegwerfPerson(), wegwerfPerson()]);
    const lagerId = await legeLager([
      [aus, "team"],
      [an, "team"],
    ]);
    const [tokenAus, tokenAn] = await Promise.all([
      legeToken(aus),
      legeToken(an),
    ]);
    await db.insert(schema.lagerBenachrichtigungEinstellung).values([
      { personId: aus, art: "frist", aktiv: false },
      // Eine eingeschaltete Zeile ändert nichts
      { personId: an, art: "frist", aktiv: true },
    ]);

    await sende({
      lagerId,
      empfaengerIds: [aus, an],
      art: "frist",
      objekt: { typ: "aufgabe", id: randomUUID() },
    });
    expect(await zeilenVon(aus)).toEqual([]);
    expect(await zeilenVon(an)).toHaveLength(1);
    expect(gesendet.map((n) => n.token)).toEqual([tokenAn]);

    // Eine andere Art derselben Person bleibt an
    gesendet = [];
    await sende({
      lagerId,
      empfaengerIds: [aus],
      art: "erwaehnung",
      objekt: { typ: "protokoll", id: randomUUID() },
    });
    expect(await zeilenVon(aus)).toHaveLength(1);
    expect(gesendet.map((n) => n.token)).toEqual([tokenAus]);
  });

  test("ohne Empfänger geschieht nichts", async () => {
    const lagerId = await legeLager();
    const zustellung = await sende({
      lagerId,
      empfaengerIds: [],
      art: "frist",
      objekt: { typ: "aufgabe", id: randomUUID() },
    });
    expect(zustellung.empfaengerIds).toEqual([]);
    expect(gesendet).toEqual([]);
  });

  test("ein Fehler beim Push bricht nichts: Zeile bleibt, senden() wirft nicht", async () => {
    const empfaenger = await wegwerfPerson();
    const lagerId = await legeLager([[empfaenger, "team"]]);
    await legeToken(empfaenger);
    wirft = Object.assign(new Error("FCM nicht erreichbar"), {
      code: "messaging/internal-error",
    });
    await expect(
      sende({
        lagerId,
        empfaengerIds: [empfaenger],
        art: "pinnwand_wichtig",
        objekt: { typ: "beitrag", id: randomUUID() },
      }),
    ).resolves.toBeDefined();
    expect(gesendet).toHaveLength(1);
    expect(await zeilenVon(empfaenger)).toHaveLength(1);
  });

  test("ohne FCM (kein Schlüssel) bleibt die Zeile und nichts geht hinaus", async () => {
    const empfaenger = await wegwerfPerson();
    const lagerId = await legeLager([[empfaenger, "team"]]);
    await legeToken(empfaenger);
    await sende(
      {
        lagerId,
        empfaengerIds: [empfaenger],
        art: "frist",
        objekt: { typ: "aufgabe", id: randomUUID() },
      },
      true,
    );
    expect(await zeilenVon(empfaenger)).toHaveLength(1);
    expect(gesendet).toEqual([]);
  });

  test("ein Rollback nimmt die Zeilen mit, und ohne senden() geht nichts hinaus", async () => {
    const empfaenger = await wegwerfPerson();
    const lagerId = await legeLager([[empfaenger, "team"]]);
    await legeToken(empfaenger);
    await expect(
      db.transaction(async (tx) => {
        await benachrichtige(tx, {
          lagerId,
          empfaengerIds: [empfaenger],
          art: "frist",
          objekt: { typ: "aufgabe", id: randomUUID() },
        });
        throw new Error("Rollback");
      }),
    ).rejects.toThrow("Rollback");
    expect(await zeilenVon(empfaenger)).toEqual([]);
    expect(gesendet).toEqual([]);
  });
});

describe("Aufräumen", () => {
  test("gelesene Einträge verschwinden nach der Frist, ungelesene bleiben", async () => {
    const person = await wegwerfPerson();
    const lagerId = await legeLager([[person, "team"]]);
    const tage = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    const zeile = (gelesenAm: Date | null) => ({
      lagerId,
      personId: person,
      art: "frist" as const,
      objektTyp: "aufgabe",
      objektId: randomUUID(),
      gelesenAm,
    });
    const [alt, frisch, ungelesen] = await db
      .insert(schema.lagerBenachrichtigung)
      .values([
        zeile(tage(GELESEN_AUFBEWAHRUNG_TAGE + 1)),
        zeile(tage(GELESEN_AUFBEWAHRUNG_TAGE - 1)),
        // Ungelesen und uralt: bleibt, bis die Person es liest
        { ...zeile(null), erstelltAm: tage(400) },
      ])
      .returning({ id: schema.lagerBenachrichtigung.id });

    expect(await loescheGeleseneBenachrichtigungen(db)).toBeGreaterThanOrEqual(
      1,
    );
    const rest = (await zeilenVon(person)).map((z) => z.id);
    expect(rest.sort()).toEqual([frisch!.id, ungelesen!.id].sort());
    expect(rest).not.toContain(alt!.id);
  });
});

describe("GET und POST /api/v1/lager/{id}/benachrichtigungen", () => {
  const liste = async (konto: PersonaKonto, lagerId: string, query = "") =>
    anfrage(
      konto,
      "GET",
      `/api/v1/lager/${lagerId}/benachrichtigungen${query}`,
    );

  // Direkt in die Datenbank, damit die Reihenfolge feststeht
  async function fuelle(
    lagerId: string,
    personId: string,
    anzahl: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < anzahl; i++) {
      const [z] = await db
        .insert(schema.lagerBenachrichtigung)
        .values({
          lagerId,
          personId,
          art: "frist",
          objektTyp: "aufgabe",
          objektId: randomUUID(),
        })
        .returning({ id: schema.lagerBenachrichtigung.id });
      ids.push(z!.id);
    }
    return ids;
  }

  test("liefert nur die eigenen Einträge, neueste zuerst, seitenweise", async () => {
    const lagerId = await legeLager([
      [sl.id!, "leitung"],
      [leitende.id!, "team"],
    ]);
    const meine = await fuelle(lagerId, sl.id!, 5);
    await fuelle(lagerId, leitende.id!, 3);

    const seite1 = await (await liste(sl, lagerId, "?limit=2")).json();
    expect(seite1.eintraege.map((e: { id: string }) => e.id)).toEqual([
      meine[4],
      meine[3],
    ]);
    expect(seite1.naechster).toBe(meine[3]);
    expect(seite1.eintraege[0]).toEqual({
      id: meine[4],
      art: "frist",
      objektTyp: "aufgabe",
      objektId: expect.any(String),
      gelesen: false,
      erstelltAm: expect.any(String),
    });

    const seite2 = await (
      await liste(sl, lagerId, `?limit=2&nach=${seite1.naechster}`)
    ).json();
    expect(seite2.eintraege.map((e: { id: string }) => e.id)).toEqual([
      meine[2],
      meine[1],
    ]);
    const seite3 = await (
      await liste(sl, lagerId, `?limit=2&nach=${seite2.naechster}`)
    ).json();
    expect(seite3.eintraege.map((e: { id: string }) => e.id)).toEqual([
      meine[0],
    ]);
    expect(seite3.naechster).toBeNull();

    // Genau eine volle Seite: kein weiterer Cursor
    const voll = await (await liste(sl, lagerId, "?limit=5")).json();
    expect(voll.eintraege).toHaveLength(5);
    expect(voll.naechster).toBeNull();
  });

  test.each(["limit=0", "limit=101", "limit=x", "nach=x", "fremd=1"])(
    "ungültige Anfrage %s ergibt 400",
    async (query) => {
      const lagerId = await legeLager([[sl.id!, "team"]]);
      expect((await liste(sl, lagerId, `?${query}`)).status).toBe(400);
    },
  );

  test.each<Rolle>(["lagerleitung", "leitung", "team", "lesen"])(
    "Rolle %s liest und leert ihre eigene Glocke, auch im abgeschlossenen Lager",
    async (rolle) => {
      for (const status of ["aktiv", "abgeschlossen"]) {
        const lagerId = await legeLager([[sl.id!, rolle]], { status });
        const [id] = await fuelle(lagerId, sl.id!, 1);
        expect((await liste(sl, lagerId)).status).toBe(200);
        const zaehler = `/api/v1/lager/${lagerId}/benachrichtigungen/ungelesen`;
        expect(await (await anfrage(sl, "GET", zaehler)).json()).toEqual({
          anzahl: 1,
        });
        const gelesen = await anfrage(
          sl,
          "POST",
          `/api/v1/lager/${lagerId}/benachrichtigungen/gelesen`,
          { ids: [id] },
        );
        expect(gelesen.status).toBe(204);
        expect(await (await anfrage(sl, "GET", zaehler)).json()).toEqual({
          anzahl: 0,
        });
      }
    },
  );

  test("gelesen: ohne ids alle des Lagers, andere Lager und andere Personen bleiben", async () => {
    const lagerA = await legeLager([
      [sl.id!, "team"],
      [leitende.id!, "team"],
    ]);
    const lagerB = await legeLager([[sl.id!, "team"]]);
    const [a1, a2] = await fuelle(lagerA, sl.id!, 2);
    const [b1] = await fuelle(lagerB, sl.id!, 1);
    const [fremde] = await fuelle(lagerA, leitende.id!, 1);

    // Eine fremde und eine unbekannte ID ändern nichts und sind kein Fehler
    const mitFremder = await anfrage(
      sl,
      "POST",
      `/api/v1/lager/${lagerA}/benachrichtigungen/gelesen`,
      { ids: [fremde, randomUUID(), b1] },
    );
    expect(mitFremder.status).toBe(204);
    const ungelesen = async (id: string) =>
      (
        await db
          .select({ gelesenAm: schema.lagerBenachrichtigung.gelesenAm })
          .from(schema.lagerBenachrichtigung)
          .where(eq(schema.lagerBenachrichtigung.id, id))
      )[0]!.gelesenAm === null;
    expect(
      await Promise.all([a1, a2, b1, fremde].map((id) => ungelesen(id!))),
    ).toEqual([true, true, true, true]);

    const alle = await anfrage(
      sl,
      "POST",
      `/api/v1/lager/${lagerA}/benachrichtigungen/gelesen`,
      {},
    );
    expect(alle.status).toBe(204);
    expect(
      await Promise.all([a1, a2, b1, fremde].map((id) => ungelesen(id!))),
    ).toEqual([false, false, true, true]);
    const seite = await (await liste(sl, lagerA)).json();
    expect(seite.eintraege.map((e: { gelesen: boolean }) => e.gelesen)).toEqual(
      [true, true],
    );
  });

  test.each([
    ["ids leer", { ids: [] }],
    ["ids keine UUID", { ids: ["x"] }],
    ["zu viele ids", { ids: Array.from({ length: 101 }, () => randomUUID()) }],
    ["unbekanntes Feld", { alle: true }],
  ])("gelesen: %s ergibt 400", async (_, body) => {
    const lagerId = await legeLager([[sl.id!, "team"]]);
    const antwort = await anfrage(
      sl,
      "POST",
      `/api/v1/lager/${lagerId}/benachrichtigungen/gelesen`,
      body,
    );
    expect(antwort.status).toBe(400);
  });

  test("Nicht-Mitglied, fremde Abteilung und unbekanntes Lager sind 404; die Abteilungsleitung sieht ihre leere Glocke", async () => {
    const lagerId = await legeLager([[sl.id!, "team"]]);
    await fuelle(lagerId, sl.id!, 1);
    for (const pfad of ["", "/ungelesen"]) {
      const url = (id: string) =>
        `/api/v1/lager/${id}/benachrichtigungen${pfad}`;
      expect((await anfrage(eltern, "GET", url(lagerId))).status).toBe(404);
      expect((await anfrage(demoAdmin, "GET", url(lagerId))).status).toBe(404);
      expect((await anfrage(sl, "GET", url(randomUUID()))).status).toBe(404);
      expect((await anfrage(sl, "GET", url("x"))).status).toBe(400);
    }
    const gelesen = (konto: PersonaKonto) =>
      anfrage(
        konto,
        "POST",
        `/api/v1/lager/${lagerId}/benachrichtigungen/gelesen`,
        {},
      );
    expect((await gelesen(eltern)).status).toBe(404);
    expect((await gelesen(demoAdmin)).status).toBe(404);
    // Admin ohne Mitgliedszeile: Lagerleitung, aber ohne eigene Einträge
    expect(await (await liste(admin, lagerId)).json()).toEqual({
      eintraege: [],
      naechster: null,
    });
  });

  test("ohne Anmeldung 401", async () => {
    const lagerId = await legeLager();
    for (const [methode, pfad] of [
      ["GET", ""],
      ["GET", "/ungelesen"],
      ["POST", "/gelesen"],
    ] as const) {
      const antwort = await app.request(
        `/api/v1/lager/${lagerId}/benachrichtigungen${pfad}`,
        { method: methode },
      );
      expect(antwort.status).toBe(401);
    }
  });
});

describe("GET /api/v1/lager/aufloesen/{typ}/{id}", () => {
  const aufloesen = (konto: PersonaKonto, typ: string, id: string) =>
    anfrage(konto, "GET", `/api/v1/lager/aufloesen/${typ}/${id}`);

  test("liefert Lager und Ziel nur der benachrichtigten Person", async () => {
    const lagerId = await legeLager([
      [sl.id!, "team"],
      [leitende.id!, "team"],
    ]);
    const objektId = randomUUID();
    await db.transaction((tx) =>
      benachrichtige(tx, {
        lagerId,
        empfaengerIds: [sl.id!],
        art: "aufgabe_zugeteilt",
        objekt: { typ: "aufgabe", id: objektId },
      }),
    );

    const antwort = await aufloesen(sl, "lager_aufgabe", objektId);
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({
      lagerId,
      objektTyp: "aufgabe",
      objektId,
    });
    // Auch im abgeschlossenen Lager (nur lesen)
    await db
      .update(schema.lager)
      .set({ status: "abgeschlossen" })
      .where(eq(schema.lager.id, lagerId));
    expect((await aufloesen(sl, "lager_aufgabe", objektId)).status).toBe(200);
  });

  test("verrät nichts: jedes andere Ziel ergibt dieselbe 404", async () => {
    const lagerId = await legeLager([
      [sl.id!, "team"],
      [leitende.id!, "team"],
    ]);
    const objektId = randomUUID();
    await db.transaction((tx) =>
      benachrichtige(tx, {
        lagerId,
        empfaengerIds: [sl.id!],
        art: "aufgabe_zugeteilt",
        objekt: { typ: "aufgabe", id: objektId },
      }),
    );
    // Eine Zeile für jemanden aus einer fremden Abteilung (wie nach einem Fehler beim Setzen der Mitglieder)
    await db.insert(schema.lagerBenachrichtigung).values({
      lagerId,
      personId: demoAdmin.id!,
      art: "aufgabe_zugeteilt",
      objektTyp: "aufgabe",
      objektId,
    });

    const faelle = [
      // Mitglied, aber nicht benachrichtigt
      await aufloesen(leitende, "lager_aufgabe", objektId),
      // Kein Mitglied, nicht benachrichtigt
      await aufloesen(eltern, "lager_aufgabe", objektId),
      // Abteilungsleitung ohne Benachrichtigung
      await aufloesen(admin, "lager_aufgabe", objektId),
      // Fremde Abteilung, auch mit einer Zeile
      await aufloesen(demoAdmin, "lager_aufgabe", objektId),
      // Falscher Typ für dasselbe Objekt
      await aufloesen(sl, "lager_pinnwand", objektId),
      // Unbekanntes Objekt
      await aufloesen(sl, "lager_aufgabe", randomUUID()),
    ];
    for (const antwort of faelle) expect(antwort.status).toBe(404);
    const koerper = await Promise.all(faelle.map((a) => a.text()));
    expect(new Set(koerper).size).toBe(1);
    expect(koerper[0]).not.toContain(lagerId);
    expect(koerper[0]).not.toContain(objektId);

    // Wer nicht mehr Mitglied ist, bekommt auch das Ziel nicht mehr
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, sl.id!),
        ),
      );
    expect((await aufloesen(sl, "lager_aufgabe", objektId)).status).toBe(404);
  });

  test("ungültiger Typ oder ungültige ID ergibt 400, ohne Anmeldung 401", async () => {
    expect((await aufloesen(sl, "chat", randomUUID())).status).toBe(400);
    expect((await aufloesen(sl, "lager_aufgabe", "x")).status).toBe(400);
    const ohne = await app.request(
      `/api/v1/lager/aufloesen/lager_aufgabe/${randomUUID()}`,
    );
    expect(ohne.status).toBe(401);
  });

  test("ein entferntes Mitglied bekommt keine neue Benachrichtigung und keinen Push", async () => {
    const entfernt = await wegwerfPerson();
    const lagerId = await legeLager([[entfernt, "team"]]);
    await legeToken(entfernt);
    await db
      .delete(schema.lagerMitglied)
      .where(eq(schema.lagerMitglied.personId, entfernt));
    await sende({
      lagerId,
      empfaengerIds: [entfernt],
      art: "frist",
      objekt: { typ: "aufgabe", id: randomUUID() },
    });
    expect(await zeilenVon(entfernt)).toEqual([]);
    expect(gesendet).toEqual([]);
  });
});

describe("/api/v1/ich/lager-benachrichtigungen", () => {
  const url = "/api/v1/ich/lager-benachrichtigungen";
  const holen = async (konto: PersonaKonto) =>
    (await (await anfrage(konto, "GET", url)).json()) as {
      arten: { art: BenachrichtigungsArt; aktiv: boolean }[];
    };

  test("Standard ist an für jede Art; PUT ändert nur die genannten und nur die eigenen", async () => {
    // Eigene Personen, damit die Tests dieser Datei sich nicht stören
    const standard = await holen(eltern);
    expect(standard.arten.map((a) => a.art)).toEqual(ART_IDS);
    expect(standard.arten.every((a) => a.aktiv)).toBe(true);

    const antwort = await anfrage(sl, "PUT", url, {
      arten: [
        { art: "frist", aktiv: false },
        { art: "erwaehnung", aktiv: false },
      ],
    });
    expect(antwort.status).toBe(204);
    const eigene = await holen(sl);
    expect(
      eigene.arten
        .filter((a) => !a.aktiv)
        .map((a) => a.art)
        .sort(),
    ).toEqual(["erwaehnung", "frist"]);
    // Wieder einschalten, die andere Art bleibt aus
    await anfrage(sl, "PUT", url, { arten: [{ art: "frist", aktiv: true }] });
    expect(
      (await holen(sl)).arten.filter((a) => !a.aktiv).map((a) => a.art),
    ).toEqual(["erwaehnung"]);
    // Andere Personen bleiben unberührt
    expect((await holen(leitende)).arten.every((a) => a.aktiv)).toBe(true);
    const zeilen = await db
      .select()
      .from(schema.lagerBenachrichtigungEinstellung)
      .where(
        inArray(schema.lagerBenachrichtigungEinstellung.personId, [
          sl.id!,
          leitende.id!,
        ]),
      );
    expect(zeilen.filter((z) => z.personId === leitende.id)).toEqual([]);

    // Aufräumen für die Personas, die andere Tests der Datei brauchen
    await anfrage(sl, "PUT", url, {
      arten: [{ art: "erwaehnung", aktiv: true }],
    });
  });

  test.each([
    ["leere Liste", { arten: [] }],
    ["unbekannte Art", { arten: [{ art: "chat", aktiv: false }] }],
    [
      "dieselbe Art zweimal",
      {
        arten: [
          { art: "frist", aktiv: true },
          { art: "frist", aktiv: false },
        ],
      },
    ],
    ["aktiv kein Boolean", { arten: [{ art: "frist", aktiv: "nein" }] }],
    [
      "fremdes Feld in der Art",
      { arten: [{ art: "frist", aktiv: true, x: 1 }] },
    ],
    [
      "fremdes Feld im Body",
      { arten: [{ art: "frist", aktiv: true }], personId: randomUUID() },
    ],
    ["ohne arten", {}],
  ])("PUT mit %s ergibt 400", async (_, body) => {
    expect((await anfrage(sl, "PUT", url, body)).status).toBe(400);
  });

  test("ohne Anmeldung 401", async () => {
    expect((await app.request(url)).status).toBe(401);
    expect((await app.request(url, { method: "PUT" })).status).toBe(401);
  });
});
