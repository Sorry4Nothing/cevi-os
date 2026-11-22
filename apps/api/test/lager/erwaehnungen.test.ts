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
import { markenVon } from "../../src/lager/erwaehnungen.js";
import type { Fcm } from "../../src/push.js";
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
const sql = postgres(API_URL, { debug: () => void abfragen++ });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
let gesendet: { token: string; notification?: unknown; data?: unknown }[];
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
beforeEach(() => {
  gesendet = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;
let fremdKontoId: string;

const L = (id: string) => `/api/v1/lager/${id}`;
const marke = (persona: LagerPersona) => `@{person:${konten[persona].id}}`;

// Ein frisches Lager mit den vier Lager-Rollen; die Mitgliedszeile der fremden Abteilung gibt nichts frei
async function neuesLager(status: "aktiv" | "abgeschlossen" = "aktiv") {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Erwähnungslager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
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
  fremdKontoId = konten.fremdeAbteilung.id!;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Antwort = { status: number; body: any };
async function anfrage(
  persona: LagerPersona,
  methode: string,
  pfad: string,
  body?: Record<string, unknown>,
): Promise<Antwort> {
  const res = await app.request(pfad, {
    method: methode,
    headers: body
      ? { ...konten[persona].headers, "content-type": "application/json" }
      : konten[persona].headers,
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Inhalte direkt in der Datenbank (die Routen der Module prüfen ihre Texte selbst, hier zählen nur die Marken)
async function aufgabe(
  lagerId: string,
  f: Partial<typeof schema.aufgabe.$inferInsert> = {},
) {
  const [z] = await db
    .insert(schema.aufgabe)
    .values({ lagerId, titel: "Offerte einholen", lagerSeq: 0, ...f })
    .returning({ id: schema.aufgabe.id });
  return z!.id;
}
async function hoeck(lagerId: string, art: "team" | "lagerleitung") {
  const [z] = await db
    .insert(schema.hoeck)
    .values({ lagerId, art, datum: "2027-07-12", titel: "Höck", lagerSeq: 0 })
    .returning({ id: schema.hoeck.id });
  return z!.id;
}
async function traktandum(
  lagerId: string,
  art: "team" | "lagerleitung",
  text: string,
) {
  const [z] = await db
    .insert(schema.traktandum)
    .values({
      lagerId,
      hoeckId: await hoeck(lagerId, art),
      titel: "Budget",
      text,
      lagerSeq: 0,
    })
    .returning({ id: schema.traktandum.id });
  return z!.id;
}
async function beschluss(
  lagerId: string,
  text: string,
  art?: "team" | "lagerleitung",
) {
  const [z] = await db
    .insert(schema.beschluss)
    .values({
      lagerId,
      text,
      hoeckId: art ? await hoeck(lagerId, art) : null,
      lagerSeq: 0,
    })
    .returning({ id: schema.beschluss.id });
  return z!.id;
}
async function beitrag(
  lagerId: string,
  text: string,
  nurRolle?: "leitung" | "team" | "lesen",
) {
  const [z] = await db
    .insert(schema.pinnwandBeitrag)
    .values({ lagerId, titel: "Packliste", text, lagerSeq: 0 })
    .returning({ id: schema.pinnwandBeitrag.id });
  if (nurRolle) {
    await db
      .insert(schema.pinnwandEmpfaenger)
      .values({ lagerId, beitragId: z!.id, rolle: nurRolle });
  }
  return z!.id;
}
const abgleichen = (
  persona: LagerPersona,
  lagerId: string,
  typ: string,
  id: string,
) => anfrage(persona, "PUT", `${L(lagerId)}/erwaehnungen/${typ}/${id}`);
const zeilen = (lagerId: string) =>
  db
    .select()
    .from(schema.erwaehnung)
    .where(eq(schema.erwaehnung.lagerId, lagerId));
const glocke = (lagerId: string, personId: string) =>
  db
    .select()
    .from(schema.lagerBenachrichtigung)
    .where(
      and(
        eq(schema.lagerBenachrichtigung.lagerId, lagerId),
        eq(schema.lagerBenachrichtigung.personId, personId),
        eq(schema.lagerBenachrichtigung.art, "erwaehnung"),
      ),
    );
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
const setzeRecht = (
  lagerId: string,
  rolle: "leitung" | "team" | "lesen",
  recht: string,
  erlaubt: boolean,
) =>
  db
    .insert(schema.lagerRolleRecht)
    .values({ lagerId, rolle, recht, erlaubt })
    .onConflictDoUpdate({
      target: [
        schema.lagerRolleRecht.lagerId,
        schema.lagerRolleRecht.rolle,
        schema.lagerRolleRecht.recht,
      ],
      set: { erlaubt },
    });

describe("Marken im Text", () => {
  const a = randomUUID();
  const b = randomUUID();
  test("nur Marken mit ID zählen, ohne Wiederholung und klein geschrieben", () => {
    expect(
      markenVon([
        `Danke @{person:${a}} und @{person:${a.toUpperCase()}}`,
        null,
        `@{person:${b}} @{ziel:alle} @Anna @{person:kaputt} @{person:${a}`,
      ]),
    ).toEqual([a, b]);
    expect(markenVon(["@Anna und @Ben", ""])).toEqual([]);
  });
});

describe("Abgleich", () => {
  test("eine neue Marke legt eine Erwähnung an und benachrichtigt genau einmal, ohne Inhalt", async () => {
    const lagerId = await neuesLager();
    const token = await legeToken(konten.team.id!);
    const id = await beitrag(
      lagerId,
      `Geheimer Text für ${marke("team")}: Kind Ben fehlt`,
    );
    const a = await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ personIds: [konten.team.id], neu: 1 });

    const z = await zeilen(lagerId);
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({
      quelleTyp: "pinnwand",
      quelleId: id,
      personId: konten.team.id,
      erledigtAm: null,
      aufgabeId: null,
    });
    const g = await glocke(lagerId, konten.team.id!);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ objektTyp: "pinnwand", objektId: id });
    expect(gesendet.map((x) => x.token)).toEqual([token]);
    expect(gesendet[0]!.notification).toEqual({
      title: "Du wurdest erwähnt",
      body: "Erwähnungslager",
    });
    expect(gesendet[0]!.data).toEqual({ typ: "lager_erwaehnung", id });
    const roh = JSON.stringify(gesendet);
    expect(roh).not.toContain("Geheimer");
    expect(roh).not.toContain("Ben");

    // Erneut speichern und abgleichen: keine zweite Erwähnung, keine zweite Benachrichtigung, kein Push
    gesendet = [];
    const nochmal = await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(nochmal.body).toEqual({ personIds: [konten.team.id], neu: 0 });
    expect(await zeilen(lagerId)).toHaveLength(1);
    expect(await glocke(lagerId, konten.team.id!)).toHaveLength(1);
    expect(gesendet).toEqual([]);
  });

  test("gleichzeitige Abgleiche benachrichtigen einmal", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, marke("team"));
    const antworten = await Promise.all(
      Array.from({ length: 6 }, () =>
        abgleichen("leitung", lagerId, "pinnwand", id),
      ),
    );
    expect(antworten.every((a) => a.status === 200)).toBe(true);
    expect(antworten.reduce((n, a) => n + a.body.neu, 0)).toBe(1);
    expect(await zeilen(lagerId)).toHaveLength(1);
    expect(await glocke(lagerId, konten.team.id!)).toHaveLength(1);
  });

  test("mehrere Marken in allen Textfeldern: eine Abfrage für alle Personen, jede bekommt genau eine Benachrichtigung", async () => {
    const lagerId = await neuesLager();
    const id = await aufgabe(lagerId, {
      titel: `Zelt mit ${marke("lesen")}`,
      notiz: `${marke("leitung")} und ${marke("lagerleitung")}, nochmals ${marke("lesen")}`,
      verantwortlichPersonId: konten.team.id,
    });
    const a = await abgleichen("lagerleitung", lagerId, "aufgabe", id);
    // Das Team ist Verantwortliche, Lesen liest alle Aufgaben: Beide sehen sie
    expect(a.status).toBe(200);
    expect(a.body.neu).toBe(3);
    expect([...a.body.personIds].sort()).toEqual(
      [konten.lesen.id, konten.leitung.id, konten.lagerleitung.id].sort(),
    );
    // Die Auslöserin bekommt nie eine Benachrichtigung, die Erwähnung bleibt
    expect(await glocke(lagerId, konten.lagerleitung.id!)).toHaveLength(0);
    expect(await glocke(lagerId, konten.leitung.id!)).toHaveLength(1);
    expect(await glocke(lagerId, konten.lesen.id!)).toHaveLength(1);
    expect(await zeilen(lagerId)).toHaveLength(3);
  });

  test("wer die Art abgeschaltet hat, bekommt keine Benachrichtigung, die Erwähnung steht", async () => {
    const lagerId = await neuesLager();
    await db
      .insert(schema.lagerBenachrichtigungEinstellung)
      .values({ personId: konten.team.id!, art: "erwaehnung", aktiv: false })
      .onConflictDoNothing();
    try {
      const id = await beitrag(lagerId, marke("team"));
      await abgleichen("leitung", lagerId, "pinnwand", id);
      expect(await zeilen(lagerId)).toHaveLength(1);
      expect(await glocke(lagerId, konten.team.id!)).toHaveLength(0);
    } finally {
      await db
        .delete(schema.lagerBenachrichtigungEinstellung)
        .where(
          eq(schema.lagerBenachrichtigungEinstellung.personId, konten.team.id!),
        );
    }
  });

  test("eine Person ausserhalb des Lagers wird abgelehnt: kein Mitglied, fremde Abteilung, unbekannt", async () => {
    const lagerId = await neuesLager();
    for (const person of [
      konten.ohneMitgliedschaft.id,
      randomUUID(),
      // Mitgliedszeile im Lager, Konto aber in einer anderen Abteilung
      fremdKontoId,
    ]) {
      const id = await beitrag(lagerId, `@{person:${person}}`);
      const a = await abgleichen("leitung", lagerId, "pinnwand", id);
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("ERWAEHNUNG_UNGUELTIG");
    }
    // Gemischt: Wer eine ungültige Marke dabei hat, legt auch die gültigen nicht an
    const gemischt = await beitrag(
      lagerId,
      `${marke("team")} @{person:${konten.ohneMitgliedschaft.id}}`,
    );
    expect(
      (await abgleichen("leitung", lagerId, "pinnwand", gemischt)).status,
    ).toBe(400);
    expect(await zeilen(lagerId)).toEqual([]);
    expect(await glocke(lagerId, konten.team.id!)).toEqual([]);
  });

  test("mehr als 10 verschiedene Marken: 400", async () => {
    const lagerId = await neuesLager();
    const text = Array.from(
      { length: 11 },
      () => `@{person:${randomUUID()}}`,
    ).join(" ");
    const id = await beitrag(lagerId, text);
    const a = await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("ZU_VIELE_MARKEN");
  });

  test("eine entfallene Marke nimmt die Erwähnung mit, ausser es ist daraus eine Aufgabe entstanden", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, `${marke("team")} ${marke("lesen")}`);
    await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(await zeilen(lagerId)).toHaveLength(2);

    // Das Team macht eine Aufgabe daraus; dann entfallen beide Marken
    const liste = await anfrage("team", "GET", `${L(lagerId)}/erwaehnungen`);
    const e = liste.body.erwaehnungen[0];
    expect(
      (
        await anfrage(
          "team",
          "POST",
          `${L(lagerId)}/erwaehnungen/${e.id}/als-aufgabe`,
        )
      ).status,
    ).toBe(201);
    await db
      .update(schema.pinnwandBeitrag)
      .set({ text: "Keine Marken mehr" })
      .where(eq(schema.pinnwandBeitrag.id, id));
    const a = await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(a.body).toEqual({ personIds: [], neu: 0 });
    const rest = await zeilen(lagerId);
    expect(rest.map((z) => z.personId)).toEqual([konten.team.id]);

    // Dieselbe Marke wieder gesetzt: Die Erwähnung besteht, niemand wird noch einmal benachrichtigt
    await db
      .update(schema.pinnwandBeitrag)
      .set({ text: marke("team") })
      .where(eq(schema.pinnwandBeitrag.id, id));
    expect(
      (await abgleichen("leitung", lagerId, "pinnwand", id)).body.neu,
    ).toBe(0);
  });

  test("ohne Marken und ohne Erwähnungen: eine Anfrage ohne Folgen und mit wenigen Abfragen", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, "Nichts Besonderes");
    const vorher = abfragen;
    const a = await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(a.body).toEqual({ personIds: [], neu: 0 });
    // Anmeldung und Policy eingerechnet; je Inhalt und Abgleich eine feste kleine Zahl
    expect(abfragen - vorher).toBeLessThan(20);
    const mit = await beitrag(lagerId, marke("team"));
    await abgleichen("leitung", lagerId, "pinnwand", mit);
    const v2 = abfragen;
    await abgleichen("leitung", lagerId, "pinnwand", mit);
    expect(abfragen - v2).toBeLessThanOrEqual(abfragen - vorher);
  });

  test("ein fremder oder unbekannter Inhalt ist 404", async () => {
    const lagerId = await neuesLager();
    const anderes = await neuesLager();
    const fremd = await aufgabe(anderes);
    expect(
      (await abgleichen("lagerleitung", lagerId, "aufgabe", fremd)).status,
    ).toBe(404);
    expect(
      (await abgleichen("lagerleitung", lagerId, "aufgabe", randomUUID()))
        .status,
    ).toBe(404);
  });
});

describe("Rechte", () => {
  test("Team und Lesen dürfen nicht abgleichen, Nicht-Mitglieder bekommen 404, im abgeschlossenen Lager 409", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, marke("lesen"));
    for (const [persona, status] of [
      ["team", 403],
      ["lesen", 403],
      ["ohneMitgliedschaft", 404],
      ["fremdeAbteilung", 404],
      ["ohneLogin", 401],
      ["leitung", 200],
      ["abteilungsleitung", 200],
    ] as const) {
      expect((await abgleichen(persona, lagerId, "pinnwand", id)).status).toBe(
        status,
      );
    }
    const zu = await neuesLager("abgeschlossen");
    const zid = await beitrag(zu, marke("lesen"));
    expect((await abgleichen("leitung", zu, "pinnwand", zid)).status).toBe(409);
    expect(await zeilen(zu)).toEqual([]);
  });

  test("das Recht richtet sich nach der Inhaltsart", async () => {
    const lagerId = await neuesLager();
    await setzeRecht(lagerId, "leitung", "pinnwand.bearbeiten", false);
    const p = await beitrag(lagerId, "x");
    const a = await aufgabe(lagerId);
    expect((await abgleichen("leitung", lagerId, "pinnwand", p)).status).toBe(
      403,
    );
    expect((await abgleichen("leitung", lagerId, "aufgabe", a)).status).toBe(
      200,
    );
    expect(
      (await abgleichen("lagerleitung", lagerId, "pinnwand", p)).status,
    ).toBe(200);
  });

  test("wer den Inhalt nicht sehen darf, bekommt 404 (Beschluss eines Höcks der Lagerleitung)", async () => {
    const lagerId = await neuesLager();
    await setzeRecht(lagerId, "leitung", "hoecks.bearbeiten", false);
    await setzeRecht(lagerId, "leitung", "hoecks.lesen_alle", false);
    const b = await beschluss(lagerId, marke("lesen"), "lagerleitung");
    expect((await abgleichen("leitung", lagerId, "beschluss", b)).status).toBe(
      404,
    );
    expect(
      (await abgleichen("lagerleitung", lagerId, "beschluss", b)).status,
    ).toBe(200);
  });
});

describe("Sichtbarkeit des Ziels für die erwähnte Person", () => {
  const abgleich = async (
    lagerId: string,
    typ: string,
    id: string,
  ): Promise<number> =>
    (await abgleichen("lagerleitung", lagerId, typ, id)).status;

  test("Traktandum: nur Rollen, die alle Höcks lesen (Team nie), auch bei einem Höck der Art team", async () => {
    const lagerId = await neuesLager();
    for (const art of ["team", "lagerleitung"] as const) {
      const id = await traktandum(lagerId, art, marke("team"));
      expect(await abgleich(lagerId, "traktandum", id)).toBe(400);
      const id2 = await traktandum(lagerId, art, marke("lesen"));
      expect(await abgleich(lagerId, "traktandum", id2)).toBe(200);
    }
  });

  test("Beschluss: Leserecht für Protokolle und Höck der Lagerleitung", async () => {
    const lagerId = await neuesLager();
    // Das Team liest im Standard keine Protokolle und Beschlüsse
    const ohneRecht = await beschluss(lagerId, marke("team"), "team");
    expect(await abgleich(lagerId, "beschluss", ohneRecht)).toBe(400);

    await setzeRecht(lagerId, "team", "protokolle.lesen", true);
    const teamHoeck = await beschluss(lagerId, marke("team"), "team");
    expect(await abgleich(lagerId, "beschluss", teamHoeck)).toBe(200);
    // Mit dem Recht, aber Höck der Lagerleitung: Das Team sieht ihn nie
    const leitungsHoeck = await beschluss(
      lagerId,
      marke("team"),
      "lagerleitung",
    );
    expect(await abgleich(lagerId, "beschluss", leitungsHoeck)).toBe(400);
    // Lesen liest alle Höcks
    const lesen = await beschluss(lagerId, marke("lesen"), "lagerleitung");
    expect(await abgleich(lagerId, "beschluss", lesen)).toBe(200);
  });

  test("Aufgabe: das Team sieht nur die eigenen", async () => {
    const lagerId = await neuesLager();
    const fremd = await aufgabe(lagerId, { notiz: marke("team") });
    expect(await abgleich(lagerId, "aufgabe", fremd)).toBe(400);
    const eigene = await aufgabe(lagerId, {
      notiz: marke("team"),
      verantwortlichPersonId: konten.team.id,
    });
    expect(await abgleich(lagerId, "aufgabe", eigene)).toBe(200);
  });

  test("Pinnwand: Empfänger nach Rolle", async () => {
    const lagerId = await neuesLager();
    const nurLeitung = await beitrag(lagerId, marke("team"), "leitung");
    expect(await abgleich(lagerId, "pinnwand", nurLeitung)).toBe(400);
    const nurTeam = await beitrag(lagerId, marke("team"), "team");
    expect(await abgleich(lagerId, "pinnwand", nurTeam)).toBe(200);
    // Das Zeitfenster gilt wie im Änderungsfeed nicht: Die Route des Beitrags liefert den Inhalt erst im Fenster, die Erwähnung hängt nur an Rolle und Empfängern
    const spaeter = await beitrag(lagerId, marke("lesen"));
    await db
      .update(schema.pinnwandBeitrag)
      .set({ sichtbarAb: new Date(Date.now() + 3_600_000) })
      .where(eq(schema.pinnwandBeitrag.id, spaeter));
    expect(await abgleich(lagerId, "pinnwand", spaeter)).toBe(200);
  });
});

describe("Liste, erledigt und Als Aufgabe", () => {
  test("die Liste zeigt nur die eigenen Erwähnungen mit Titel, neueste zuerst, mit Seitenwechsel und Filter", async () => {
    const lagerId = await neuesLager();
    const erste = await beitrag(lagerId, marke("team"));
    const zweite = await beitrag(lagerId, marke("team"));
    const beschlussId = await beschluss(lagerId, `Wir packen\nZweite Zeile`);
    await db
      .update(schema.beschluss)
      .set({ text: `${marke("lesen")} Wir packen\nZweite Zeile` })
      .where(eq(schema.beschluss.id, beschlussId));
    await setzeRecht(lagerId, "lesen", "protokolle.lesen", true);
    for (const [typ, id] of [
      ["pinnwand", erste],
      ["pinnwand", zweite],
      ["beschluss", beschlussId],
    ] as const) {
      expect((await abgleichen("lagerleitung", lagerId, typ, id)).status).toBe(
        200,
      );
    }

    const liste = await anfrage("team", "GET", `${L(lagerId)}/erwaehnungen`);
    expect(liste.status).toBe(200);
    expect(liste.body.naechster).toBeNull();
    expect(
      liste.body.erwaehnungen.map((e: { quelleId: string }) => e.quelleId),
    ).toEqual([zweite, erste]);
    expect(liste.body.erwaehnungen[0]).toMatchObject({
      quelleTyp: "pinnwand",
      titel: "Packliste",
      erledigt: false,
      aufgabeId: null,
    });
    // Nur die eigenen: Lesen sieht nur den Beschluss, mit der ersten Zeile als Titel
    const lesen = await anfrage("lesen", "GET", `${L(lagerId)}/erwaehnungen`);
    expect(lesen.body.erwaehnungen).toHaveLength(1);
    expect(lesen.body.erwaehnungen[0].titel).toMatch(
      /^@\{person:.*\} Wir packen$/,
    );
    expect(
      (await anfrage("leitung", "GET", `${L(lagerId)}/erwaehnungen`)).body
        .erwaehnungen,
    ).toEqual([]);

    // Seitenwechsel
    const s1 = await anfrage(
      "team",
      "GET",
      `${L(lagerId)}/erwaehnungen?limit=1`,
    );
    expect(s1.body.erwaehnungen).toHaveLength(1);
    expect(s1.body.naechster).toBe(s1.body.erwaehnungen[0].id);
    const s2 = await anfrage(
      "team",
      "GET",
      `${L(lagerId)}/erwaehnungen?limit=1&nach=${s1.body.naechster}`,
    );
    expect(s2.body.erwaehnungen[0].quelleId).toBe(erste);
    expect(s2.body.naechster).toBeNull();

    // Erledigte fallen aus dem Filter «offen»
    await anfrage(
      "team",
      "PATCH",
      `${L(lagerId)}/erwaehnungen/${s1.body.erwaehnungen[0].id}`,
      { erledigt: true },
    );
    const offen = await anfrage(
      "team",
      "GET",
      `${L(lagerId)}/erwaehnungen?offen=true`,
    );
    expect(
      offen.body.erwaehnungen.map((e: { quelleId: string }) => e.quelleId),
    ).toEqual([erste]);
    expect(
      (await anfrage("team", "GET", `${L(lagerId)}/erwaehnungen?limit=0`))
        .status,
    ).toBe(400);
  });

  test("ein gelöschter Inhalt und ein Inhalt, den die Person nicht mehr sehen darf, fehlen in der Liste", async () => {
    const lagerId = await neuesLager();
    const a = await beitrag(lagerId, marke("team"));
    const b = await beitrag(lagerId, marke("team"));
    for (const id of [a, b])
      await abgleichen("leitung", lagerId, "pinnwand", id);
    const sehen = async () =>
      (await anfrage("team", "GET", `${L(lagerId)}/erwaehnungen`)).body
        .erwaehnungen.length;
    expect(await sehen()).toBe(2);
    await db
      .delete(schema.pinnwandBeitrag)
      .where(eq(schema.pinnwandBeitrag.id, a));
    expect(await sehen()).toBe(1);
    await db
      .insert(schema.pinnwandEmpfaenger)
      .values({ lagerId, beitragId: b, rolle: "leitung" });
    expect(await sehen()).toBe(0);
  });

  test("erledigt setzen und zurücknehmen, nur an der eigenen Erwähnung", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, marke("team"));
    await abgleichen("leitung", lagerId, "pinnwand", id);
    const [e] = await zeilen(lagerId);
    const pfad = `${L(lagerId)}/erwaehnungen/${e!.id}`;

    const fremd = await anfrage("leitung", "PATCH", pfad, { erledigt: true });
    expect(fremd.status).toBe(404);
    expect((await zeilen(lagerId))[0]!.erledigtAm).toBeNull();

    const a = await anfrage("team", "PATCH", pfad, { erledigt: true });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ id: e!.id, erledigt: true });
    const erster = (await zeilen(lagerId))[0]!.erledigtAm;
    expect(erster).not.toBeNull();
    // Gleicher Aufruf, gleicher Zeitpunkt
    await anfrage("team", "PATCH", pfad, { erledigt: true });
    expect((await zeilen(lagerId))[0]!.erledigtAm).toEqual(erster);
    const zurueck = await anfrage("team", "PATCH", pfad, { erledigt: false });
    expect(zurueck.body.erledigt).toBe(false);
    expect((await zeilen(lagerId))[0]!.erledigtAm).toBeNull();

    expect(
      (await anfrage("team", "PATCH", pfad, { erledigt: "ja" })).status,
    ).toBe(400);
    expect(
      (await anfrage("team", "PATCH", pfad, { erledigt: true, x: 1 })).status,
    ).toBe(400);
  });

  test("Als Aufgabe legt genau eine Aufgabe für die erwähnte Person an, auch bei doppelter und gleichzeitiger Anfrage", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, `Geheim ${marke("team")}`);
    await abgleichen("leitung", lagerId, "pinnwand", id);
    const [e] = await zeilen(lagerId);
    const pfad = `${L(lagerId)}/erwaehnungen/${e!.id}/als-aufgabe`;

    const antworten = await Promise.all(
      Array.from({ length: 4 }, () => anfrage("team", "POST", pfad)),
    );
    expect(antworten.map((a) => a.status).sort()).toEqual([200, 200, 200, 201]);
    const ids = new Set(antworten.map((a) => a.body.aufgabeId));
    expect(ids.size).toBe(1);

    const aufgaben = await db
      .select()
      .from(schema.aufgabe)
      .where(eq(schema.aufgabe.quelle, `erwaehnung:${e!.id}`));
    expect(aufgaben).toHaveLength(1);
    expect(aufgaben[0]).toMatchObject({
      id: [...ids][0],
      titel: "Packliste",
      verantwortlichPersonId: konten.team.id,
      status: "offen",
      notiz: null,
    });
    expect((await zeilen(lagerId))[0]!.aufgabeId).toBe(aufgaben[0]!.id);

    // Später noch einmal: dieselbe Aufgabe, keine zweite
    const spaeter = await anfrage("team", "POST", pfad);
    expect(spaeter.status).toBe(200);
    expect(spaeter.body.aufgabeId).toBe(aufgaben[0]!.id);

    // Das Team sieht die Aufgabe als eigene
    const liste = await anfrage("team", "GET", `${L(lagerId)}/aufgaben`);
    expect(liste.status).toBe(200);
    expect(liste.body.aufgaben.map((a: { id: string }) => a.id)).toContain(
      aufgaben[0]!.id,
    );
    // Und die Liste der Erwähnungen verweist auf sie
    const meine = await anfrage("team", "GET", `${L(lagerId)}/erwaehnungen`);
    expect(meine.body.erwaehnungen[0].aufgabeId).toBe(aufgaben[0]!.id);
  });

  test("Als Aufgabe: fremde Erwähnung 404, Lesen ohne Recht 403", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, `${marke("team")} ${marke("lesen")}`);
    await abgleichen("leitung", lagerId, "pinnwand", id);
    const zeile = (persona: LagerPersona) =>
      zeilen(lagerId).then((z) =>
        z.find((x) => x.personId === konten[persona].id)!,
      );
    const team = await zeile("team");
    const lesen = await zeile("lesen");
    expect(
      (
        await anfrage(
          "leitung",
          "POST",
          `${L(lagerId)}/erwaehnungen/${team.id}/als-aufgabe`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          "lesen",
          "POST",
          `${L(lagerId)}/erwaehnungen/${lesen.id}/als-aufgabe`,
        )
      ).status,
    ).toBe(403);
    expect(
      await db
        .select()
        .from(schema.aufgabe)
        .where(eq(schema.aufgabe.lagerId, lagerId)),
    ).toEqual([]);
    // Die Aufgabe einer Erwähnung im abgeschlossenen Lager gibt es nicht
    await db
      .update(schema.lager)
      .set({ status: "abgeschlossen" })
      .where(eq(schema.lager.id, lagerId));
    expect(
      (
        await anfrage(
          "team",
          "POST",
          `${L(lagerId)}/erwaehnungen/${team.id}/als-aufgabe`,
        )
      ).status,
    ).toBe(409);
  });

  test("ein entferntes Mitglied nimmt seine Erwähnungen mit, ein gelöschtes Lager alle", async () => {
    const lagerId = await neuesLager();
    const id = await beitrag(lagerId, `${marke("team")} ${marke("lesen")}`);
    await abgleichen("leitung", lagerId, "pinnwand", id);
    expect(await zeilen(lagerId)).toHaveLength(2);
    await db
      .delete(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, konten.team.id!),
        ),
      );
    expect((await zeilen(lagerId)).map((z) => z.personId)).toEqual([
      konten.lesen.id,
    ]);
    await db.delete(schema.lager).where(eq(schema.lager.id, lagerId));
    expect(await zeilen(lagerId)).toEqual([]);
  });
});
