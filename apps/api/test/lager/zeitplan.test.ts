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
  ERINNERUNG_AB_STUNDE,
  sendeFristErinnerungen,
} from "../../src/lager/fristen.js";
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

// Jede Anweisung an die Datenbank zählt mit und bleibt im Protokoll: Die Tests der Datenbanklast zählen sie
const protokoll: string[] = [];
const sql = postgres(API_URL, {
  debug: (_verbindung, abfrage) => {
    protokoll.push(String(abfrage));
  },
});
const db = erstelleDb(sql);
// Schreibende Anweisungen auf die Tabellen des Zeitplans und der Aufgaben (Anmeldung und Sitzung schreiben nebenbei und zählen nicht)
const SCHREIBT_ZEITPLAN =
  /^\s*(insert into|update|delete from)\s+"(aufgabe|meilenstein|lagertag|tagesabschnitt|lager|lager_aenderung|lager_benachrichtigung)"/i;
const LAGER_TABELLEN =
  /"(aufgabe|meilenstein|lagertag|tagesabschnitt|lager|lager_aenderung|lager_benachrichtigung|aufgabe_unterstuetzung)"/;
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

beforeEach(() => {
  gesendet = [];
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
    abteilungId?: string;
    status?: "entwurf" | "aktiv" | "abgeschlossen";
    von?: string;
    bis?: string;
    uebung?: boolean;
  } = {},
) {
  const abteilungId = p.abteilungId ?? welt.testabteilungId;
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Zeitplanlager",
      von: p.von ?? "2027-07-10",
      bis: p.bis ?? "2027-07-24",
      status: p.status ?? "aktiv",
      uebung: p.uebung ?? false,
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
  const gebraucht: Record<LagerPersona, Persona> = KONTO_FUER;
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, gebraucht[p])] as const,
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

const L = (id = lagerId) => `/api/v1/lager/${id}`;
const Z = (id = lagerId) => `${L(id)}/zeitplan`;
const leiter = () => konten.lagerleitung;
const lagerStand = async (id = lagerId) =>
  (await db.select().from(schema.lager).where(eq(schema.lager.id, id)))[0]!;

async function neuerMeilenstein(
  werte: Record<string, unknown> = {},
  id = lagerId,
) {
  const a = await anfrage(leiter(), "POST", `${Z(id)}/meilensteine`, {
    titel: "Anmeldeschluss",
    datum: "2027-05-01",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as { id: string; version: number; datum: string };
}
async function neueAufgabe(werte: Record<string, unknown>, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/aufgaben`, {
    titel: "Aufgabe",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    frist: string | null;
    fristMeilensteinId: string | null;
    fristVersatzTage: number | null;
  };
}
async function mitglied(lager = lagerId, rolle: "team" | "leitung" = "team") {
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
    .values({ lagerId: lager, personId: p!.id, rolle });
  return p!.id;
}
// Eine Aufgabe direkt in der Datenbank (für den Erinnerungslauf: feste Daten, ohne die Routen)
async function aufgabeDirekt(
  werte: Partial<typeof schema.aufgabe.$inferInsert>,
  id = lagerId,
) {
  const [a] = await db
    .insert(schema.aufgabe)
    .values({ lagerId: id, titel: "Direkt", lagerSeq: 0, ...werte })
    .returning({ id: schema.aufgabe.id });
  return a!.id;
}
const benachrichtigungen = (id: string, personId: string, art = "frist") =>
  db
    .select()
    .from(schema.lagerBenachrichtigung)
    .where(
      and(
        eq(schema.lagerBenachrichtigung.lagerId, id),
        eq(schema.lagerBenachrichtigung.personId, personId),
        eq(schema.lagerBenachrichtigung.art, art),
      ),
    );
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

describe("Rechte je Lager-Persona", () => {
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
  const bearbeiten = (erfolg: number): Record<LagerPersona, number> => ({
    abteilungsleitung: erfolg,
    lagerleitung: erfolg,
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  });

  test.each(LAGER_PERSONAS)("%s: Zeitplan lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", Z())).status).toBe(lesen[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Vorschlag lesen", async (p) => {
    expect((await anfrage(konten[p], "GET", `${Z()}/vorschlag`)).status).toBe(
      bearbeiten(200)[p],
    );
  });
  test.each(LAGER_PERSONAS)("%s: Meilenstein anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${Z()}/meilensteine`, {
      titel: "Test",
      datum: "2027-05-01",
    });
    expect(a.status).toBe(bearbeiten(201)[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Lagertag anlegen", async (p) => {
    const a = await anfrage(konten[p], "POST", `${Z()}/lagertage`, {
      datum: "2027-07-11",
    });
    // Der zweite Aufruf mit demselben Datum ist ein Konflikt: Wer schreiben darf, bekommt 201 oder 409
    expect([bearbeiten(201)[p], 409]).toContain(a.status);
    if (bearbeiten(201)[p] !== 201) expect(a.status).toBe(bearbeiten(201)[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Tagesabschnitt anlegen", async (p) => {
    const l = await neuesLager();
    const a = await anfrage(konten[p], "POST", `${Z(l)}/tagesabschnitte`, {
      name: "Morgen",
    });
    expect(a.status).toBe(bearbeiten(201)[p]);
  });
  test.each(LAGER_PERSONAS)("%s: Meilenstein verschieben", async (p) => {
    const m = await neuerMeilenstein();
    const a = await anfrage(
      konten[p],
      "POST",
      `${Z()}/meilensteine/${m.id}/verschieben`,
      { trocken: true, datum: "2027-05-08", version: m.version },
    );
    expect(a.status).toBe(bearbeiten(200)[p]);
  });
  test.each(LAGER_PERSONAS)(
    "%s: Meilenstein im geschlossenen Lager",
    async (p) => {
      const a = await anfrage(
        konten[p],
        "POST",
        `${Z(geschlossenId)}/meilensteine`,
        {
          titel: "Zu",
          datum: "2027-05-01",
        },
      );
      const erwartet = bearbeiten(409)[p];
      expect(a.status).toBe(erwartet);
    },
  );
  test("Lesen im geschlossenen Lager geht", async () => {
    expect((await anfrage(leiter(), "GET", Z(geschlossenId))).status).toBe(200);
  });

  test("die Rechte stehen je Lager in den Einstellungen: Leitung mit zeitplan.bearbeiten darf, Lesen ohne aufgaben.bearbeiten nicht verschieben", async () => {
    const l = await neuesLager();
    const einstellen = await anfrage(leiter(), "PUT", `${L(l)}/rechte`, {
      rechte: [
        { rolle: "leitung", recht: "zeitplan.bearbeiten", erlaubt: true },
        { rolle: "lesen", recht: "zeitplan.bearbeiten", erlaubt: true },
      ],
    });
    expect(einstellen.status).toBe(204);
    const m = await neuerMeilenstein({}, l);
    // Leitung hat aufgaben.bearbeiten (Standard): Anlegen und Verschieben gehen
    const angelegt = await anfrage(
      konten.leitung,
      "POST",
      `${Z(l)}/meilensteine`,
      { titel: "Von der Leitung", datum: "2027-05-02" },
    );
    expect(angelegt.status).toBe(201);
    expect(
      (
        await anfrage(
          konten.leitung,
          "POST",
          `${Z(l)}/meilensteine/${m.id}/verschieben`,
          { trocken: true, datum: "2027-05-09", version: m.version },
        )
      ).status,
    ).toBe(200);
    // Lesen darf den Zeitplan ändern, aber keine Fristen von Aufgaben verschieben
    expect(
      (
        await anfrage(konten.lesen, "POST", `${Z(l)}/meilensteine`, {
          titel: "Lesen",
          datum: "2027-05-03",
        })
      ).status,
    ).toBe(201);
    const verboten = await anfrage(
      konten.lesen,
      "POST",
      `${Z(l)}/meilensteine/${m.id}/verschieben`,
      { trocken: true, datum: "2027-05-09", version: m.version },
    );
    expect(verboten.status).toBe(403);
    expect(verboten.body.code).toBe("RECHT_FEHLT");
  });
});

describe("Meilensteine", () => {
  test("anlegen, lesen, ändern ohne Datum, Version und Konflikt", async () => {
    const l = await neuesLager();
    const m = await neuerMeilenstein({ art: "Frist" }, l);
    expect(m).toMatchObject({
      titel: "Anmeldeschluss",
      datum: "2027-05-01",
      art: "Frist",
      version: 1,
    });
    const geaendert = await anfrage(
      leiter(),
      "PATCH",
      `${Z(l)}/meilensteine/${m.id}`,
      { version: 1, titel: "Neu", art: null },
    );
    expect(geaendert.status).toBe(200);
    expect(geaendert.body).toMatchObject({
      titel: "Neu",
      art: null,
      version: 2,
    });
    // Das Datum ändert nur die Verschiebung
    expect(
      (
        await anfrage(leiter(), "PATCH", `${Z(l)}/meilensteine/${m.id}`, {
          version: 2,
          datum: "2027-06-01",
        })
      ).status,
    ).toBe(400);
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${Z(l)}/meilensteine/${m.id}`,
      { version: 1, titel: "Alt" },
    );
    expect(konflikt.status).toBe(409);
    expect(konflikt.body.code).toBe("VERSION_KONFLIKT");
    expect(konflikt.body.aktuell).toMatchObject({ titel: "Neu", version: 2 });
    expect(konflikt.body.abweichend).toEqual(["titel"]);
    // Ein leeres oder unbekanntes Feld
    for (const body of [
      { version: 2 },
      { version: 2, titel: "" },
      { version: 2, unbekannt: 1 },
      { titel: "ohne Version" },
    ]) {
      expect(
        (await anfrage(leiter(), "PATCH", `${Z(l)}/meilensteine/${m.id}`, body))
          .status,
      ).toBe(400);
    }
    // Die Eingabe: Datum und Art
    for (const body of [
      { titel: "x", datum: "2027-02-30" },
      { titel: "x", datum: "1999-12-31" },
      { titel: "x", datum: "2027-05-01", art: "a".repeat(51) },
      { titel: "x", datum: "2027-05-01", extra: true },
      { datum: "2027-05-01" },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${Z(l)}/meilensteine`, body)).status,
      ).toBe(400);
    }
  });

  test("Meilenstein eines anderen Lagers: 404, auch mit der ID aus dem eigenen Lager", async () => {
    const m = await neuerMeilenstein();
    const andere = await neuesLager();
    // Im Lager der fremden Abteilung ist die Lagerleitung dieser Abteilung ein Fremder: nichts anlegen
    expect(
      (
        await anfrage(leiter(), "POST", `${Z(fremdLagerId)}/meilensteine`, {
          titel: "X",
          datum: "2027-05-01",
        })
      ).status,
    ).toBe(404);
    for (const [methode, pfad, body] of [
      [
        "PATCH",
        `${Z(andere)}/meilensteine/${m.id}`,
        { version: 1, titel: "X" },
      ],
      ["DELETE", `${Z(andere)}/meilensteine/${m.id}?version=1`, undefined],
      [
        "POST",
        `${Z(andere)}/meilensteine/${m.id}/verschieben`,
        { trocken: true, datum: "2027-05-08", version: 1 },
      ],
      [
        "POST",
        `${Z(andere)}/meilensteine/${m.id}/verschieben`,
        { trocken: false, datum: "2027-05-08", version: 1, aufgaben: [] },
      ],
    ] as const) {
      expect((await anfrage(leiter(), methode, pfad, body)).status).toBe(404);
    }
    // Unverändert
    const z = await anfrage(leiter(), "GET", Z());
    expect(
      z.body.meilensteine.find((x: { id: string }) => x.id === m.id).version,
    ).toBe(1);
  });

  test("löschen: Aufgaben behalten ihre Frist als festes Datum, der Feed meldet alles", async () => {
    const l = await neuesLager();
    const m = await neuerMeilenstein({ datum: "2027-06-01" }, l);
    const a = await neueAufgabe(
      { fristMeilensteinId: m.id, fristVersatzTage: -7 },
      l,
    );
    expect(a).toMatchObject({
      frist: "2027-05-25",
      fristMeilensteinId: m.id,
      fristVersatzTage: -7,
    });
    const vorher = await lagerStand(l);
    const weg = await anfrage(
      leiter(),
      "DELETE",
      `${Z(l)}/meilensteine/${m.id}?version=1`,
    );
    expect(weg.status).toBe(204);
    const danach = await anfrage(leiter(), "GET", `${L(l)}/aufgaben/${a.id}`);
    expect(danach.body).toMatchObject({
      frist: "2027-05-25",
      fristMeilensteinId: null,
      fristVersatzTage: null,
      version: 2,
    });
    expect((await anfrage(leiter(), "GET", Z(l))).body.meilensteine).toEqual(
      [],
    );
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L(l)}/aenderungen?seit=${vorher.seq}`,
    );
    expect(
      feed.body.eintraege.map((e: { objekttyp: string; art: string }) => [
        e.objekttyp,
        e.art,
      ]),
    ).toEqual([
      ["aufgabe", "geaendert"],
      ["meilenstein", "geloescht"],
    ]);
    // Noch einmal: weg
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${Z(l)}/meilensteine/${m.id}?version=2`,
        )
      ).status,
    ).toBe(404);
  });

  test("höchstens 200 je Lager", async () => {
    const l = await neuesLager();
    await db.insert(schema.meilenstein).values(
      Array.from({ length: 200 }, (_, i) => ({
        lagerId: l,
        titel: `M${i}`,
        datum: "2027-05-01",
        lagerSeq: 0,
      })),
    );
    const a = await anfrage(leiter(), "POST", `${Z(l)}/meilensteine`, {
      titel: "Einer zu viel",
      datum: "2027-05-01",
    });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("LIMIT_ERREICHT");
  });
});

describe("Lagertage und Tagesabschnitte", () => {
  test("Lagertag: im Lager, je Datum einmal, ändern und löschen", async () => {
    const l = await neuesLager({ von: "2027-07-10", bis: "2027-07-12" });
    const t = await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
      datum: "2027-07-10",
      label: "Anreise",
    });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ datum: "2027-07-10", label: "Anreise" });
    const doppelt = await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
      datum: "2027-07-10",
    });
    expect([doppelt.status, doppelt.body.code]).toEqual([409, "TAG_VORHANDEN"]);
    for (const datum of ["2027-07-09", "2027-07-13"]) {
      const aus = await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
        datum,
      });
      expect([aus.status, aus.body.code]).toEqual([400, "AUSSERHALB_LAGER"]);
    }
    const zweiter = await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
      datum: "2027-07-11",
    });
    // Ändern auf ein vorhandenes Datum: Konflikt; auf ein freies Datum im Lager: geht
    const auf = await anfrage(
      leiter(),
      "PATCH",
      `${Z(l)}/lagertage/${zweiter.body.id}`,
      { version: 1, datum: "2027-07-10" },
    );
    expect([auf.status, auf.body.code]).toEqual([409, "TAG_VORHANDEN"]);
    const frei = await anfrage(
      leiter(),
      "PATCH",
      `${Z(l)}/lagertage/${zweiter.body.id}`,
      { version: 1, datum: "2027-07-12", label: null },
    );
    expect(frei.body).toMatchObject({ datum: "2027-07-12", version: 2 });
    const weg = await anfrage(
      leiter(),
      "DELETE",
      `${Z(l)}/lagertage/${t.body.id}?version=1`,
    );
    expect(weg.status).toBe(204);
    // Das Datum ist wieder frei
    expect(
      (
        await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
          datum: "2027-07-10",
        })
      ).status,
    ).toBe(201);
  });

  test("Tagesabschnitt: Name je Lager einmal, Reihenfolge ans Ende, Zeit als HH:MM, Grenze 12", async () => {
    const l = await neuesLager();
    const a1 = await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
      name: "Vormittag",
      zeit: "08:30",
    });
    const a2 = await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
      name: "Nachmittag",
    });
    expect(a1.body).toMatchObject({ zeit: "08:30", reihenfolge: 0 });
    expect(a2.body).toMatchObject({ zeit: null, reihenfolge: 1 });
    const doppelt = await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
      name: "vormittag",
    });
    expect([doppelt.status, doppelt.body.code]).toEqual([
      409,
      "ABSCHNITT_VORHANDEN",
    ]);
    for (const zeit of ["8:30", "24:00", "12:60", "mittags"]) {
      expect(
        (
          await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
            name: `Z${zeit}`,
            zeit,
          })
        ).status,
      ).toBe(400);
    }
    const umbenannt = await anfrage(
      leiter(),
      "PATCH",
      `${Z(l)}/tagesabschnitte/${a2.body.id}`,
      { version: 1, name: "Vormittag" },
    );
    expect([umbenannt.status, umbenannt.body.code]).toEqual([
      409,
      "ABSCHNITT_VORHANDEN",
    ]);
    const ok = await anfrage(
      leiter(),
      "PATCH",
      `${Z(l)}/tagesabschnitte/${a2.body.id}`,
      { version: 1, name: "Abend", reihenfolge: 5, zeit: "18:00" },
    );
    expect(ok.body).toMatchObject({
      name: "Abend",
      reihenfolge: 5,
      version: 2,
    });
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
            name: `Extra ${i}`,
          })
        ).status,
      ).toBe(201);
    }
    const zuviel = await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
      name: "Der dreizehnte",
    });
    expect([zuviel.status, zuviel.body.code]).toEqual([409, "LIMIT_ERREICHT"]);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${Z(l)}/tagesabschnitte/${a1.body.id}?version=1`,
        )
      ).status,
    ).toBe(204);
  });

  test("Vorschlag und Übernehmen: ändert erst mit der Bestätigung, überspringt Vorhandenes", async () => {
    const l = await neuesLager({ von: "2027-07-10", bis: "2027-07-14" });
    const stand = await lagerStand(l);
    const v = await anfrage(leiter(), "GET", `${Z(l)}/vorschlag`);
    expect(v.status).toBe(200);
    expect(v.body.lagertage.map((t: { datum: string }) => t.datum)).toEqual([
      "2027-07-10",
      "2027-07-11",
      "2027-07-12",
      "2027-07-13",
      "2027-07-14",
    ]);
    expect(v.body.tagesabschnitte.map((a: { name: string }) => a.name)).toEqual(
      ["Vormittag", "Nachmittag", "Abend", "Nacht"],
    );
    // Der Vorschlag ändert nichts
    expect((await lagerStand(l)).seq).toBe(stand.seq);
    expect((await anfrage(leiter(), "GET", Z(l))).body).toEqual({
      meilensteine: [],
      lagertage: [],
      tagesabschnitte: [],
    });
    // Bestätigt mit zwei Tagen (einer mit Bezeichnung) und den Abschnitten
    const u = await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, {
      lagertage: [
        { datum: "2027-07-10", label: "Anreise" },
        { datum: "2027-07-11" },
      ],
      tagesabschnitte: v.body.tagesabschnitte,
    });
    expect(u.status).toBe(201);
    expect(u.body.lagertage).toHaveLength(2);
    expect(u.body.tagesabschnitte).toHaveLength(4);
    const z = (await anfrage(leiter(), "GET", Z(l))).body;
    expect(z.lagertage.map((t: { label: string | null }) => t.label)).toEqual([
      "Anreise",
      null,
    ]);
    expect(
      z.tagesabschnitte.map((a: { reihenfolge: number }) => a.reihenfolge),
    ).toEqual([0, 1, 2, 3]);
    // Jede Zeile hat ihre Folgenummer und ihren Feed-Eintrag (6 Zeilen)
    expect((await lagerStand(l)).seq).toBe(stand.seq + 6);
    // Der nächste Vorschlag nennt nur noch die fehlenden Tage und keine Abschnitte
    const v2 = await anfrage(leiter(), "GET", `${Z(l)}/vorschlag`);
    expect(v2.body.lagertage.map((t: { datum: string }) => t.datum)).toEqual([
      "2027-07-12",
      "2027-07-13",
      "2027-07-14",
    ]);
    expect(v2.body.tagesabschnitte).toEqual([]);
    // Dasselbe noch einmal: schon da, nichts passiert
    const wieder = await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, {
      lagertage: [{ datum: "2027-07-10" }],
      tagesabschnitte: [{ name: "VORMITTAG" }],
    });
    expect(wieder.body).toEqual({ lagertage: [], tagesabschnitte: [] });
    expect((await lagerStand(l)).seq).toBe(stand.seq + 6);
    // Fehler: ausserhalb, leer, doppelt, unbekanntes Feld
    const aus = await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, {
      lagertage: [{ datum: "2027-07-15" }],
    });
    expect([aus.status, aus.body.code]).toEqual([400, "AUSSERHALB_LAGER"]);
    for (const body of [
      {},
      { lagertage: [] },
      { lagertage: [{ datum: "2027-07-12" }, { datum: "2027-07-12" }] },
      { tagesabschnitte: [{ name: "A" }, { name: "a" }] },
      { lagertage: [{ datum: "2027-07-12", x: 1 }] },
      { x: 1 },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, body)).status,
      ).toBe(400);
    }
  });

  test("Sommerzeit-Wechsel verschiebt keinen Tag: 5 Tage über den 29. März und 5 über den 25. Oktober", async () => {
    for (const [von, bis, erwartet] of [
      [
        "2031-03-28",
        "2031-04-01",
        ["2031-03-28", "2031-03-29", "2031-03-30", "2031-03-31", "2031-04-01"],
      ],
      [
        "2031-10-24",
        "2031-10-28",
        ["2031-10-24", "2031-10-25", "2031-10-26", "2031-10-27", "2031-10-28"],
      ],
    ] as const) {
      const l = await neuesLager({ von, bis });
      const v = await anfrage(leiter(), "GET", `${Z(l)}/vorschlag`);
      expect(v.body.lagertage.map((t: { datum: string }) => t.datum)).toEqual(
        erwartet,
      );
      const u = await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, {
        lagertage: v.body.lagertage,
      });
      expect(u.body.lagertage).toHaveLength(5);
    }
  });

  test("ein Lager mit der Obergrenze von Tagen: mehr als 100 sind 409", async () => {
    const l = await neuesLager({ von: "2027-01-01", bis: "2027-12-31" });
    const tage = Array.from({ length: 100 }, (_, i) => ({
      datum: new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10),
    }));
    expect(
      (
        await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, {
          lagertage: tage,
        })
      ).status,
    ).toBe(201);
    const einer = await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
      datum: "2027-06-01",
    });
    expect([einer.status, einer.body.code]).toEqual([409, "LIMIT_ERREICHT"]);
    expect(
      (
        await anfrage(leiter(), "POST", `${Z(l)}/uebernehmen`, {
          lagertage: [{ datum: "2027-06-01" }],
        })
      ).status,
    ).toBe(409);
  });

  test("der Zeitplan liest alle Listen in einer Anweisung, unabhängig von der Zahl der Zeilen", async () => {
    const l = await neuesLager();
    const zaehle = async () => {
      const vorher = protokoll.length;
      const a = await anfrage(leiter(), "GET", Z(l));
      expect(a.status).toBe(200);
      return {
        n: protokoll.length - vorher,
        zeilen: a.body.meilensteine.length + a.body.lagertage.length,
        sql: protokoll.slice(vorher).filter((q) => q.includes("json_agg")),
      };
    };
    await neuerMeilenstein({}, l);
    const wenige = await zaehle();
    await db.insert(schema.meilenstein).values(
      Array.from({ length: 40 }, (_, i) => ({
        lagerId: l,
        titel: `M${i}`,
        datum: "2027-05-01",
        lagerSeq: 0,
      })),
    );
    await db.insert(schema.lagertag).values(
      Array.from({ length: 14 }, (_, i) => ({
        lagerId: l,
        datum: `2027-07-${String(10 + i).padStart(2, "0")}`,
        lagerSeq: 0,
      })),
    );
    const viele = await zaehle();
    expect(viele.zeilen).toBe(55);
    expect(viele.n).toBe(wenige.n);
    expect(viele.sql).toHaveLength(1);
  });

  test("Meilensteine, Tage und Abschnitte stehen im Feed, auch für Team und Lesen", async () => {
    const l = await neuesLager();
    const vorher = await lagerStand(l);
    const m = await neuerMeilenstein({}, l);
    const t = await anfrage(leiter(), "POST", `${Z(l)}/lagertage`, {
      datum: "2027-07-11",
    });
    const a = await anfrage(leiter(), "POST", `${Z(l)}/tagesabschnitte`, {
      name: "Nacht",
    });
    for (const p of ["team", "lesen", "leitung"] as const) {
      const feed = await anfrage(
        konten[p],
        "GET",
        `${L(l)}/aenderungen?seit=${vorher.seq}`,
      );
      expect(
        feed.body.eintraege.map((e: { objekttyp: string; id: string }) => [
          e.objekttyp,
          e.id,
        ]),
      ).toEqual([
        ["meilenstein", m.id],
        ["lagertag", t.body.id],
        ["tagesabschnitt", a.body.id],
      ]);
    }
  });
});

describe("relative Frist an Aufgaben", () => {
  test("Meilenstein plus Versatz, Lagerbeginn plus Versatz, feste Frist", async () => {
    const l = await neuesLager({ von: "2027-07-10", bis: "2027-07-24" });
    const m = await neuerMeilenstein({ datum: "2027-06-01" }, l);
    const am = await neueAufgabe(
      { fristMeilensteinId: m.id, fristVersatzTage: 3 },
      l,
    );
    expect(am).toMatchObject({
      frist: "2027-06-04",
      fristMeilensteinId: m.id,
      fristVersatzTage: 3,
    });
    // Ohne Meilenstein zählt der Beginn des Lagers
    const lb = await neueAufgabe({ fristVersatzTage: -14 }, l);
    expect(lb).toMatchObject({
      frist: "2027-06-26",
      fristMeilensteinId: null,
      fristVersatzTage: -14,
    });
    // Über die Sommerzeit hinweg: Tage ohne Uhrzeit
    const sommer = await neuesLager({ von: "2031-03-30", bis: "2031-04-05" });
    expect((await neueAufgabe({ fristVersatzTage: 1 }, sommer)).frist).toBe(
      "2031-03-31",
    );
    expect((await neueAufgabe({ fristVersatzTage: -1 }, sommer)).frist).toBe(
      "2031-03-29",
    );
    // Eine feste Frist hat keinen Bezug
    const fest = await neueAufgabe({ frist: "2027-06-15" }, l);
    expect(fest).toMatchObject({
      frist: "2027-06-15",
      fristMeilensteinId: null,
      fristVersatzTage: null,
    });
  });

  test("Eingabe: Frist und Versatz zusammen, Meilenstein ohne Versatz, fremder oder gelöschter Meilenstein, Grenzen", async () => {
    const l = await neuesLager();
    const m = await neuerMeilenstein({}, l);
    const fremder = await neuerMeilenstein({}, await neuesLager());
    for (const werte of [
      { frist: "2027-06-01", fristVersatzTage: 1 },
      { fristMeilensteinId: m.id },
      { fristMeilensteinId: m.id, fristVersatzTage: null },
      { fristVersatzTage: 3651 },
      { fristVersatzTage: 1.5 },
      { fristMeilensteinId: "kein-uuid", fristVersatzTage: 1 },
    ]) {
      const a = await anfrage(leiter(), "POST", `${L(l)}/aufgaben`, {
        titel: "X",
        ...werte,
      });
      expect(a.status, JSON.stringify(werte)).toBe(400);
    }
    // Unbekannter Meilenstein, Meilenstein eines anderen Lagers
    for (const id of [randomUUID(), fremder.id]) {
      const a = await anfrage(leiter(), "POST", `${L(l)}/aufgaben`, {
        titel: "X",
        fristMeilensteinId: id,
        fristVersatzTage: 1,
      });
      expect([a.status, a.body.code]).toEqual([400, "MEILENSTEIN_UNBEKANNT"]);
    }
    // Ein gelöschter Meilenstein
    const weg = await neuerMeilenstein({}, l);
    await anfrage(
      leiter(),
      "DELETE",
      `${Z(l)}/meilensteine/${weg.id}?version=1`,
    );
    const a = await anfrage(leiter(), "POST", `${L(l)}/aufgaben`, {
      titel: "X",
      fristMeilensteinId: weg.id,
      fristVersatzTage: 1,
    });
    expect([a.status, a.body.code]).toEqual([400, "MEILENSTEIN_UNBEKANNT"]);
    // Ändern: dieselben Regeln
    const aufgabe = await neueAufgabe({}, l);
    const f = await anfrage(
      leiter(),
      "PATCH",
      `${L(l)}/aufgaben/${aufgabe.id}`,
      {
        version: 1,
        frist: "2027-06-01",
        fristVersatzTage: 1,
      },
    );
    expect(f.status).toBe(400);
    const aus = await anfrage(
      leiter(),
      "PATCH",
      `${L(l)}/aufgaben/${aufgabe.id}`,
      {
        version: 1,
        fristMeilensteinId: fremder.id,
        fristVersatzTage: 1,
      },
    );
    expect([aus.status, aus.body.code]).toEqual([400, "MEILENSTEIN_UNBEKANNT"]);
  });

  test("ändern: eine feste Frist löst den Bezug, Versatz null löst ihn und behält die Frist, ein neuer Versatz rechnet neu", async () => {
    const l = await neuesLager();
    const m = await neuerMeilenstein({ datum: "2027-06-01" }, l);
    const a = await neueAufgabe(
      { fristMeilensteinId: m.id, fristVersatzTage: 2 },
      l,
    );
    const neuerVersatz = await anfrage(
      leiter(),
      "PATCH",
      `${L(l)}/aufgaben/${a.id}`,
      { version: 1, fristMeilensteinId: m.id, fristVersatzTage: 5 },
    );
    expect(neuerVersatz.body).toMatchObject({
      frist: "2027-06-06",
      fristVersatzTage: 5,
      version: 2,
    });
    // Anderes Feld ändern: Der Bezug bleibt
    const titel = await anfrage(leiter(), "PATCH", `${L(l)}/aufgaben/${a.id}`, {
      version: 2,
      titel: "Anderer Titel",
    });
    expect(titel.body).toMatchObject({
      frist: "2027-06-06",
      fristMeilensteinId: m.id,
      fristVersatzTage: 5,
    });
    const gelost = await anfrage(
      leiter(),
      "PATCH",
      `${L(l)}/aufgaben/${a.id}`,
      {
        version: 3,
        fristMeilensteinId: null,
        fristVersatzTage: null,
      },
    );
    expect(gelost.body).toMatchObject({
      frist: "2027-06-06",
      fristMeilensteinId: null,
      fristVersatzTage: null,
    });
    const b = await neueAufgabe(
      { fristMeilensteinId: m.id, fristVersatzTage: 2 },
      l,
    );
    const fest = await anfrage(leiter(), "PATCH", `${L(l)}/aufgaben/${b.id}`, {
      version: 1,
      frist: "2027-09-09",
    });
    expect(fest.body).toMatchObject({
      frist: "2027-09-09",
      fristMeilensteinId: null,
      fristVersatzTage: null,
    });
    // Eine gelöschte Frist löst ebenfalls
    const c = await neueAufgabe({ fristVersatzTage: 2 }, l);
    const leer = await anfrage(leiter(), "PATCH", `${L(l)}/aufgaben/${c.id}`, {
      version: 1,
      frist: null,
    });
    expect(leer.body).toMatchObject({
      frist: null,
      fristVersatzTage: null,
    });
  });
});

describe("Fristverschiebung", () => {
  async function vorbereiten() {
    const l = await neuesLager({ von: "2031-03-20", bis: "2031-04-05" });
    const person = await mitglied(l);
    const m = await neuerMeilenstein({ datum: "2031-03-25" }, l);
    const a1 = await neueAufgabe(
      {
        titel: "Vor dem Meilenstein",
        fristMeilensteinId: m.id,
        fristVersatzTage: -2,
        verantwortlichPersonId: person,
      },
      l,
    );
    const a2 = await neueAufgabe(
      {
        titel: "Nach dem Meilenstein",
        fristMeilensteinId: m.id,
        fristVersatzTage: 6,
        verantwortlichPersonId: person,
      },
      l,
    );
    const fest = await neueAufgabe({ frist: "2031-03-30" }, l);
    return { l, person, m, a1, a2, fest };
  }
  const verschiebe = (
    l: string,
    m: { id: string },
    body: Record<string, unknown>,
    konto = leiter(),
  ) => anfrage(konto, "POST", `${Z(l)}/meilensteine/${m.id}/verschieben`, body);

  test("Trockenlauf zeigt die betroffenen Aufgaben und ändert nichts", async () => {
    const { l, m, a1, a2 } = await vorbereiten();
    const vorher = await lagerStand(l);
    const geschrieben = protokoll.length;
    const v = await verschiebe(l, m, {
      trocken: true,
      datum: "2031-03-31",
      version: 1,
    });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({
      trocken: true,
      meilenstein: {
        id: m.id,
        version: 1,
        datumAlt: "2031-03-25",
        datumNeu: "2031-03-31",
      },
    });
    // Über den 30. März 2031 (Sommerzeit ab 02:00): Tage bleiben Tage
    expect(v.body.aufgaben).toEqual([
      expect.objectContaining({
        id: a1.id,
        version: 1,
        titel: "Vor dem Meilenstein",
        status: "offen",
        fristAlt: "2031-03-23",
        fristNeu: "2031-03-29",
      }),
      expect.objectContaining({
        id: a2.id,
        version: 1,
        fristAlt: "2031-03-31",
        fristNeu: "2031-04-06",
      }),
    ]);
    // Nichts geändert, nichts geschrieben: weder Folgenummer noch Version noch Anweisung ausser Lesen
    expect((await lagerStand(l)).seq).toBe(vorher.seq);
    expect(
      (await anfrage(leiter(), "GET", Z(l))).body.meilensteine[0].datum,
    ).toBe("2031-03-25");
    const aufgaben = await db
      .select()
      .from(schema.aufgabe)
      .where(inArray(schema.aufgabe.id, [a1.id, a2.id]));
    expect(aufgaben.map((a) => [a.version, a.frist]).sort()).toEqual([
      [1, "2031-03-23"],
      [1, "2031-03-31"],
    ]);
    const schreibend = protokoll
      .slice(geschrieben)
      .filter((q) => SCHREIBT_ZEITPLAN.test(q));
    expect(schreibend).toEqual([]);
  });

  test("Bestätigung schreibt Datum und alle Fristen, jede Aufgabe mit Version und Feed-Eintrag", async () => {
    const { l, m, a1, a2, fest } = await vorbereiten();
    const vorher = await lagerStand(l);
    const v = await verschiebe(l, m, {
      trocken: true,
      datum: "2031-03-31",
      version: 1,
    });
    const b = await verschiebe(l, m, {
      trocken: false,
      datum: "2031-03-31",
      version: 1,
      aufgaben: v.body.aufgaben.map((a: { id: string; version: number }) => ({
        id: a.id,
        version: a.version,
      })),
    });
    expect(b.status).toBe(200);
    expect(b.body.trocken).toBe(false);
    expect(b.body.meilenstein).toMatchObject({
      version: 2,
      datumNeu: "2031-03-31",
    });
    expect(b.body.aufgaben).toEqual([
      expect.objectContaining({
        id: a1.id,
        version: 2,
        fristNeu: "2031-03-29",
      }),
      expect.objectContaining({
        id: a2.id,
        version: 2,
        fristNeu: "2031-04-06",
      }),
    ]);
    const z = await anfrage(leiter(), "GET", Z(l));
    expect(z.body.meilensteine[0]).toMatchObject({
      datum: "2031-03-31",
      version: 2,
    });
    const danach = await db
      .select()
      .from(schema.aufgabe)
      .where(inArray(schema.aufgabe.id, [a1.id, a2.id, fest.id]));
    const nachId = new Map(danach.map((a) => [a.id, a]));
    expect(nachId.get(a1.id)).toMatchObject({
      frist: "2031-03-29",
      version: 2,
    });
    expect(nachId.get(a2.id)).toMatchObject({
      frist: "2031-04-06",
      version: 2,
    });
    // Die feste Frist bleibt
    expect(nachId.get(fest.id)).toMatchObject({
      frist: "2031-03-30",
      version: 1,
    });
    // Eine Folgenummer je Zeile: Meilenstein plus zwei Aufgaben
    expect((await lagerStand(l)).seq).toBe(vorher.seq + 3);
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L(l)}/aenderungen?seit=${vorher.seq}`,
    );
    expect(
      feed.body.eintraege.map((e: { objekttyp: string; art: string }) => [
        e.objekttyp,
        e.art,
      ]),
    ).toEqual([
      ["meilenstein", "geaendert"],
      ["aufgabe", "geaendert"],
      ["aufgabe", "geaendert"],
    ]);
    // Zurück auf das alte Datum: die Fristen folgen
    const zurueck = await verschiebe(l, m, {
      trocken: false,
      datum: "2031-03-25",
      version: 2,
      aufgaben: [
        { id: a1.id, version: 2 },
        { id: a2.id, version: 2 },
      ],
    });
    expect(zurueck.status).toBe(200);
    expect(
      (await anfrage(leiter(), "GET", `${L(l)}/aufgaben/${a1.id}`)).body.frist,
    ).toBe("2031-03-23");
  });

  test("Bestätigung mit veralteter Aufgabe, neuer Aufgabe oder gelöschter Aufgabe schreibt nichts", async () => {
    const { l, m, a1, a2 } = await vorbereiten();
    const bestaetigung = (aufgaben: { id: string; version: number }[]) => ({
      trocken: false,
      datum: "2031-04-02",
      version: 1,
      aufgaben,
    });
    const alle = [
      { id: a1.id, version: 1 },
      { id: a2.id, version: 1 },
    ];
    const vorher = await lagerStand(l);
    const unveraendert = async () => {
      expect((await lagerStand(l)).seq).toBe(vorher.seq);
      expect(
        (await anfrage(leiter(), "GET", Z(l))).body.meilensteine[0].datum,
      ).toBe("2031-03-25");
    };
    // Eine Aufgabe wurde nach der Vorschau geändert
    const geaendert = await anfrage(
      leiter(),
      "PATCH",
      `${L(l)}/aufgaben/${a1.id}`,
      {
        version: 1,
        titel: "Nachträglich geändert",
      },
    );
    expect(geaendert.status).toBe(200);
    const nachher = await lagerStand(l);
    const veraltet = await verschiebe(l, m, bestaetigung(alle));
    expect([veraltet.status, veraltet.body.code]).toEqual([
      409,
      "VORSCHAU_VERALTET",
    ]);
    // Die Antwort nennt die neue Vorschau mit den aktuellen Versionen
    expect(veraltet.body.vorschau.aufgaben).toEqual([
      expect.objectContaining({
        id: a1.id,
        version: 2,
        fristNeu: "2031-03-31",
      }),
      expect.objectContaining({
        id: a2.id,
        version: 1,
        fristNeu: "2031-04-08",
      }),
    ]);
    expect((await lagerStand(l)).seq).toBe(nachher.seq);
    // Mit der neuen Vorschau geht es
    // Eine Aufgabe fehlt in der Bestätigung
    const fehlt = await verschiebe(
      l,
      m,
      bestaetigung([{ id: a1.id, version: 2 }]),
    );
    expect([fehlt.status, fehlt.body.code]).toEqual([409, "VORSCHAU_VERALTET"]);
    // Eine Aufgabe ist dazugekommen
    const neu = await neueAufgabe(
      { fristMeilensteinId: m.id, fristVersatzTage: 0 },
      l,
    );
    const dazu = await verschiebe(
      l,
      m,
      bestaetigung([
        { id: a1.id, version: 2 },
        { id: a2.id, version: 1 },
      ]),
    );
    expect([dazu.status, dazu.body.code]).toEqual([409, "VORSCHAU_VERALTET"]);
    // Eine bestätigte Aufgabe wurde gelöscht
    await anfrage(leiter(), "DELETE", `${L(l)}/aufgaben/${neu.id}?version=1`);
    const geloescht = await verschiebe(
      l,
      m,
      bestaetigung([
        { id: a1.id, version: 2 },
        { id: a2.id, version: 1 },
        { id: neu.id, version: 1 },
      ]),
    );
    expect([geloescht.status, geloescht.body.code]).toEqual([
      409,
      "VORSCHAU_VERALTET",
    ]);
    // Ein Wert, der der Vorschau nie entsprach
    const falsch = await verschiebe(
      l,
      m,
      bestaetigung([
        { id: a1.id, version: 2 },
        { id: randomUUID(), version: 1 },
      ]),
    );
    expect(falsch.status).toBe(409);
    expect((await lagerStand(l)).seq).toBeGreaterThanOrEqual(nachher.seq);
    // Der Meilenstein und die Fristen blieben, wie sie waren
    expect(
      (await anfrage(leiter(), "GET", Z(l))).body.meilensteine[0],
    ).toMatchObject({ datum: "2031-03-25", version: 1 });
    expect(
      (await anfrage(leiter(), "GET", `${L(l)}/aufgaben/${a2.id}`)).body.frist,
    ).toBe("2031-03-31");
    void unveraendert;
  });

  test("veraltete Version des Meilensteins: 409 VERSION_KONFLIKT, nichts geschrieben", async () => {
    const { l, m, a1, a2 } = await vorbereiten();
    const t = await anfrage(leiter(), "PATCH", `${Z(l)}/meilensteine/${m.id}`, {
      version: 1,
      titel: "Umbenannt",
    });
    expect(t.status).toBe(200);
    const nachher = await lagerStand(l);
    const k = await verschiebe(l, m, {
      trocken: false,
      datum: "2031-04-02",
      version: 1,
      aufgaben: [
        { id: a1.id, version: 1 },
        { id: a2.id, version: 1 },
      ],
    });
    expect([k.status, k.body.code]).toEqual([409, "VERSION_KONFLIKT"]);
    expect(k.body.aktuell).toMatchObject({ titel: "Umbenannt", version: 2 });
    // Die Transaktion rollte zurück: weder Folgenummern noch Fristen
    expect((await lagerStand(l)).seq).toBe(nachher.seq);
    const aufgaben = await db
      .select({ frist: schema.aufgabe.frist, version: schema.aufgabe.version })
      .from(schema.aufgabe)
      .where(inArray(schema.aufgabe.id, [a1.id, a2.id]));
    expect(aufgaben.map((a) => a.version)).toEqual([1, 1]);
  });

  test("zwei gleichzeitige Bestätigungen: genau eine gewinnt", async () => {
    const { l, m, a1, a2 } = await vorbereiten();
    const body = {
      trocken: false,
      datum: "2031-04-02",
      version: 1,
      aufgaben: [
        { id: a1.id, version: 1 },
        { id: a2.id, version: 1 },
      ],
    };
    const antworten = await Promise.all([
      verschiebe(l, m, body),
      verschiebe(l, m, body),
      verschiebe(l, m, body),
    ]);
    expect(antworten.map((a) => a.status).sort()).toEqual([200, 409, 409]);
    const z = await anfrage(leiter(), "GET", Z(l));
    expect(z.body.meilensteine[0]).toMatchObject({
      datum: "2031-04-02",
      version: 2,
    });
  });

  test("ohne Aufgaben, gleiches Datum, zu viele Angaben, Eingabe", async () => {
    const l = await neuesLager();
    const m = await neuerMeilenstein({ datum: "2027-05-01" }, l);
    const leer = await verschiebe(l, m, {
      trocken: false,
      datum: "2027-05-05",
      version: 1,
      aufgaben: [],
    });
    expect(leer.status).toBe(200);
    expect(leer.body).toMatchObject({
      trocken: false,
      meilenstein: {
        version: 2,
        datumAlt: "2027-05-01",
        datumNeu: "2027-05-05",
      },
      aufgaben: [],
    });
    for (const trocken of [true, false]) {
      const gleich = await verschiebe(l, m, {
        trocken,
        datum: "2027-05-05",
        version: 2,
        aufgaben: [],
      });
      expect([gleich.status, gleich.body.code]).toEqual([
        400,
        "KEINE_AENDERUNG",
      ]);
    }
    for (const body of [
      { datum: "2027-05-06", version: 2 },
      { trocken: false, datum: "2027-05-06", version: 2 },
      { trocken: "ja", datum: "2027-05-06", version: 2 },
      { trocken: true, datum: "2027-05-06" },
      { trocken: true, datum: "morgen", version: 2 },
      { trocken: true, datum: "2027-05-06", version: 2, extra: 1 },
      {
        trocken: false,
        datum: "2027-05-06",
        version: 2,
        aufgaben: [
          { id: randomUUID(), version: 1 },
          { id: randomUUID(), version: 1, x: 1 },
        ],
      },
    ]) {
      expect((await verschiebe(l, m, body)).status).toBe(400);
    }
  });

  test("Datenbanklast: Verschieben ist eine Update-Anweisung für alle Aufgaben, unabhängig von der Zahl", async () => {
    const zaehle = async (anzahl: number) => {
      const l = await neuesLager({ von: "2031-03-20", bis: "2031-04-05" });
      const person = await mitglied(l);
      const m = await neuerMeilenstein({ datum: "2031-03-25" }, l);
      const ids: { id: string; version: number }[] = [];
      for (let i = 0; i < anzahl; i++) {
        const a = await neueAufgabe(
          {
            fristMeilensteinId: m.id,
            fristVersatzTage: i,
            verantwortlichPersonId: person,
          },
          l,
        );
        ids.push({ id: a.id, version: a.version });
      }
      const vorher = protokoll.length;
      const b = await verschiebe(l, m, {
        trocken: false,
        datum: "2031-04-01",
        version: 1,
        aufgaben: ids,
      });
      expect(b.status).toBe(200);
      const abfragen = protokoll.slice(vorher);
      return {
        // Die Anweisungen an die Tabellen des Lagers; Anmeldung und Sitzung zählen nicht mit
        gesamt: abfragen.filter((q) => LAGER_TABELLEN.test(q)).length,
        // Eine Anweisung ändert die Fristen aller Aufgaben
        fristUpdates: abfragen.filter(
          (q) => /update\s+"aufgabe"/i.test(q) && q.includes('"frist"'),
        ).length,
      };
    };
    const drei = await zaehle(3);
    const dreissig = await zaehle(30);
    expect(drei.fristUpdates).toBe(1);
    expect(dreissig.fristUpdates).toBe(1);
    expect(dreissig.gesamt).toBe(drei.gesamt);
  });

  test("Benachrichtigung: eine je Person, nie der Auslöser, nicht für Erledigtes, Push ohne Aufgabentext", async () => {
    const { l, m, a1, a2 } = await vorbereiten();
    const zweite = await mitglied(l);
    const nur = await mitglied(l);
    const token = await pushToken(
      (
        await db
          .select({ id: schema.lagerMitglied.personId })
          .from(schema.lagerMitglied)
          .where(
            and(
              eq(schema.lagerMitglied.lagerId, l),
              eq(schema.lagerMitglied.rolle, "team"),
            ),
          )
      )[0]!.id,
    );
    expect(token).toBeTruthy();
    const verantwortliche = (
      await db.select().from(schema.aufgabe).where(eq(schema.aufgabe.id, a1.id))
    )[0]!.verantwortlichPersonId!;
    // Zweite Person unterstützt a2; die dritte hängt nur an einer erledigten Aufgabe
    await anfrage(leiter(), "PATCH", `${L(l)}/aufgaben/${a2.id}`, {
      version: 1,
      unterstuetzungPersonIds: [zweite],
    });
    const erledigt = await neueAufgabe(
      {
        titel: "Schon erledigt",
        fristMeilensteinId: m.id,
        fristVersatzTage: 1,
        verantwortlichPersonId: nur,
        status: "erledigt",
      },
      l,
    );
    // Der Auslöser (Lagerleitung) ist Verantwortliche einer weiteren Aufgabe: bekommt nichts
    await neueAufgabe(
      {
        fristMeilensteinId: m.id,
        fristVersatzTage: 2,
        verantwortlichPersonId: konten.lagerleitung.id,
      },
      l,
    );
    const v = await verschiebe(l, m, {
      trocken: true,
      datum: "2031-04-01",
      version: 1,
    });
    gesendet = [];
    const b = await verschiebe(l, m, {
      trocken: false,
      datum: "2031-04-01",
      version: 1,
      aufgaben: v.body.aufgaben.map((a: { id: string; version: number }) => ({
        id: a.id,
        version: a.version,
      })),
    });
    expect(b.status).toBe(200);
    expect(b.body.aufgaben).toHaveLength(4);
    // Verantwortliche von a1 und a2: eine Zeile, auch wenn sie an zwei Aufgaben hängt
    const z1 = await benachrichtigungen(
      l,
      verantwortliche,
      "aufgabe_geaendert",
    );
    expect(z1).toHaveLength(1);
    expect(z1[0]!.objektTyp).toBe("aufgabe");
    // Sie öffnet die Aufgabe mit der nächsten Frist
    expect(z1[0]!.objektId).toBe(a1.id);
    expect(
      await benachrichtigungen(l, zweite, "aufgabe_geaendert"),
    ).toHaveLength(1);
    expect(await benachrichtigungen(l, nur, "aufgabe_geaendert")).toHaveLength(
      0,
    );
    expect(
      await benachrichtigungen(l, konten.lagerleitung.id!, "aufgabe_geaendert"),
    ).toHaveLength(0);
    void erledigt;
    // Kein Push enthält einen Aufgabentitel
    for (const n of gesendet) {
      expect(JSON.stringify(n)).not.toMatch(/Meilenstein|erledigt/i);
    }
  });
});

describe("Frist-Erinnerung", () => {
  // Zürcher Zeit: Die Sommerzeit beginnt 2032 am 28. März um 02:00 und endet am 31. Oktober um 03:00. Alle Läufe mit eingespritzter Zeit. Der Lauf geht über alle Lager der Datenbank, darum hat jeder Test einen eigenen Monat (Daten in den Jahren 2031 und 2032, weit weg von den Daten der anderen Tests)
  const um = (iso: string) => new Date(iso);

  async function fall(
    p: {
      status?: "entwurf" | "aktiv" | "abgeschlossen";
      uebung?: boolean;
    } = {},
  ) {
    const l = await neuesLager({ von: "2031-01-01", bis: "2032-12-31", ...p });
    const person = await mitglied(l);
    return { l, person };
  }
  const lauf = (jetzt: string) =>
    sendeFristErinnerungen(db, { fcm, jetzt: um(jetzt) });
  const erinnert = async (id: string) =>
    (
      await db
        .select({ am: schema.aufgabe.fristErinnertAm })
        .from(schema.aufgabe)
        .where(eq(schema.aufgabe.id, id))
    )[0]!.am;

  test("Fenster: heute bis in 3 Tage; ausserhalb, erledigt, gelöscht und «später» bleiben still", async () => {
    const { l, person } = await fall();
    const ids: string[] = [];
    for (const frist of ["2031-05-10", "2031-05-11", "2031-05-13"]) {
      ids.push(
        await aufgabeDirekt({ frist, verantwortlichPersonId: person }, l),
      );
    }
    const still = [
      // In vier Tagen, gestern, erledigt, gelöscht, «später ab» morgen, ohne Frist
      await aufgabeDirekt(
        { frist: "2031-05-14", verantwortlichPersonId: person },
        l,
      ),
      await aufgabeDirekt(
        { frist: "2031-05-09", verantwortlichPersonId: person },
        l,
      ),
      await aufgabeDirekt(
        {
          frist: "2031-05-10",
          status: "erledigt",
          erledigtAm: new Date(),
          verantwortlichPersonId: person,
        },
        l,
      ),
      await aufgabeDirekt(
        {
          frist: "2031-05-10",
          geloeschtAm: new Date(),
          verantwortlichPersonId: person,
        },
        l,
      ),
      await aufgabeDirekt(
        {
          frist: "2031-05-10",
          spaeterAb: "2031-05-11",
          verantwortlichPersonId: person,
        },
        l,
      ),
      await aufgabeDirekt({ verantwortlichPersonId: person }, l),
    ];
    expect(await lauf("2031-05-10T06:00:00Z")).toBe(3);
    for (const id of ids) expect(await erinnert(id)).not.toBeNull();
    for (const id of still) expect(await erinnert(id)).toBeNull();
    // Eine Benachrichtigung für die Person, die die Aufgabe mit der nächsten Frist öffnet
    const z = await benachrichtigungen(l, person);
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ objektTyp: "aufgabe", objektId: ids[0] });
  });

  test("kein Doppel am selben Zürcher Tag, ein neuer Tag erinnert wieder", async () => {
    const { l, person } = await fall();
    const id = await aufgabeDirekt(
      { frist: "2031-06-12", verantwortlichPersonId: person },
      l,
    );
    expect(await lauf("2031-06-10T05:30:00Z")).toBe(1);
    expect((await erinnert(id))!.toISOString()).toBe(
      "2031-06-10T05:30:00.000Z",
    );
    // Stündlicher Lauf: derselbe Tag, nichts mehr
    for (const zeit of ["06:30", "12:00", "21:59"]) {
      expect(await lauf(`2031-06-10T${zeit}:00Z`)).toBe(0);
    }
    expect(await benachrichtigungen(l, person)).toHaveLength(1);
    // Der nächste Zürcher Tag
    expect(await lauf("2031-06-11T05:30:00Z")).toBe(1);
    expect(await benachrichtigungen(l, person)).toHaveLength(2);
    // Am Tag der Frist noch einmal, am Tag danach nicht mehr (die Frist ist vorbei)
    expect(await lauf("2031-06-12T05:30:00Z")).toBe(1);
    expect(await lauf("2031-06-13T05:30:00Z")).toBe(0);
  });

  test("vor 07:00 Zürcher Zeit tut der Lauf nichts", async () => {
    const { l, person } = await fall();
    const id = await aufgabeDirekt(
      { frist: "2031-07-10", verantwortlichPersonId: person },
      l,
    );
    expect(ERINNERUNG_AB_STUNDE).toBe(7);
    // 04:59 UTC = 06:59 MESZ
    expect(await lauf("2031-07-10T04:59:00Z")).toBe(0);
    expect(await erinnert(id)).toBeNull();
    expect(await lauf("2031-07-10T05:00:00Z")).toBe(1);
  });

  test("Sommerzeit: Tag und Stunde zählen in Zürcher Zeit, am 28. März und am 31. Oktober 2032", async () => {
    const { l, person } = await fall();
    const maerz = await aufgabeDirekt(
      { frist: "2032-03-29", verantwortlichPersonId: person },
      l,
    );
    // 27. März 23:30 MEZ = 22:30 UTC: noch vor 07:00, nichts
    expect(await lauf("2032-03-27T22:30:00Z")).toBe(0);
    // 28. März, nach der Umstellung (02:00 MEZ wird 03:00 MESZ): 06:30 UTC = 08:30 MESZ
    expect(await lauf("2032-03-28T06:30:00Z")).toBe(1);
    // Später am selben Tag und in der Nacht danach: kein Doppel
    expect(await lauf("2032-03-28T20:00:00Z")).toBe(0);
    expect(await lauf("2032-03-28T22:30:00Z")).toBe(0);
    // 29. März ab 07:00 MESZ (05:00 UTC): neuer Tag, die Frist ist heute
    expect(await lauf("2032-03-29T05:00:00Z")).toBe(1);
    expect(await lauf("2032-03-30T05:00:00Z")).toBe(0);
    expect(await erinnert(maerz)).not.toBeNull();

    const oktober = await aufgabeDirekt(
      { frist: "2032-11-01", verantwortlichPersonId: person },
      l,
    );
    // 30. Oktober 07:30 MESZ = 05:30 UTC
    expect(await lauf("2032-10-30T05:30:00Z")).toBe(1);
    // 31. Oktober: Die Stunde 02:00 bis 03:00 gibt es zweimal (MESZ, dann MEZ); der Lauf tut vor 07:00 MEZ (06:00 UTC) nichts
    expect(await lauf("2032-10-31T00:30:00Z")).toBe(0);
    expect(await lauf("2032-10-31T01:30:00Z")).toBe(0);
    expect(await lauf("2032-10-31T05:59:00Z")).toBe(0);
    expect(await lauf("2032-10-31T06:00:00Z")).toBe(1);
    expect(await lauf("2032-10-31T18:00:00Z")).toBe(0);
    expect(await lauf("2032-11-01T06:00:00Z")).toBe(1);
    expect(await erinnert(oktober)).not.toBeNull();
  });

  test("Empfänger: Verantwortliche, Unterstützung und Leitung des Ressorts; je Person eine Benachrichtigung; Push nur mit Lagertitel", async () => {
    const { l, person } = await fall();
    const stuetze = await mitglied(l);
    const ressortLeitung = await mitglied(l);
    const unbeteiligt = await mitglied(l);
    const [r] = await db
      .insert(schema.ressort)
      .values({
        lagerId: l,
        kuerzel: "K",
        name: "Küche",
        leitungPersonId: ressortLeitung,
        lagerSeq: 0,
      })
      .returning({ id: schema.ressort.id });
    const a1 = await aufgabeDirekt(
      {
        titel: "Geheimer Titel eins",
        frist: "2031-08-11",
        verantwortlichPersonId: person,
      },
      l,
    );
    const a2 = await aufgabeDirekt(
      { titel: "Geheimer Titel zwei", frist: "2031-08-10", ressortId: r!.id },
      l,
    );
    const a3 = await aufgabeDirekt(
      {
        titel: "Geheimer Titel drei",
        frist: "2031-08-12",
        verantwortlichPersonId: person,
      },
      l,
    );
    await db.insert(schema.aufgabeUnterstuetzung).values([
      { lagerId: l, aufgabeId: a1, personId: stuetze },
      { lagerId: l, aufgabeId: a3, personId: stuetze },
    ]);
    await pushToken(person);
    await pushToken(stuetze);
    await pushToken(ressortLeitung);
    gesendet = [];
    expect(await lauf("2031-08-10T05:30:00Z")).toBe(3);
    // Person und Unterstützung hängen an a1 und a3: eine Zeile auf a1 (die nächste Frist der beiden); die Leitung des Ressorts bekommt a2
    expect(await benachrichtigungen(l, person)).toEqual([
      expect.objectContaining({ objektId: a1 }),
    ]);
    expect(await benachrichtigungen(l, stuetze)).toEqual([
      expect.objectContaining({ objektId: a1 }),
    ]);
    expect(await benachrichtigungen(l, ressortLeitung)).toEqual([
      expect.objectContaining({ objektId: a2 }),
    ]);
    expect(await benachrichtigungen(l, unbeteiligt)).toHaveLength(0);
    // Drei Pushes mit dem festen Titel und dem Lagertitel, nie ein Aufgabentitel
    expect(gesendet).toHaveLength(3);
    for (const n of gesendet) {
      expect(n.notification).toMatchObject({
        title: "Eine Frist rückt näher",
        body: "Zeitplanlager",
      });
      expect(n.data).toMatchObject({ typ: "lager_aufgabe" });
      expect(JSON.stringify(n)).not.toContain("Geheimer Titel");
    }
  });

  test("abgeschaltete Art: keine Zeile; Entwurf und aktiv ja, abgeschlossen, archiviert und Übung nein", async () => {
    const entwurf = await fall({ status: "entwurf" });
    const aktiv = await fall({ status: "aktiv" });
    const zu = await fall({ status: "abgeschlossen" });
    const archiv = await fall({ status: "abgeschlossen" });
    await db
      .update(schema.lager)
      .set({ status: "archiviert" })
      .where(eq(schema.lager.id, archiv.l));
    const uebung = await fall({ uebung: true });
    const aus = await mitglied(aktiv.l);
    await db.insert(schema.lagerBenachrichtigungEinstellung).values({
      personId: aus,
      art: "frist",
      aktiv: false,
    });
    const ids = new Map<string, string>();
    for (const [name, f] of Object.entries({
      entwurf,
      aktiv,
      zu,
      archiv,
      uebung,
    })) {
      ids.set(
        name,
        await aufgabeDirekt(
          { frist: "2031-09-10", verantwortlichPersonId: f.person },
          f.l,
        ),
      );
    }
    const abgeschaltet = await aufgabeDirekt(
      { frist: "2031-09-10", verantwortlichPersonId: aus },
      aktiv.l,
    );
    await lauf("2031-09-10T05:30:00Z");
    expect(await erinnert(ids.get("entwurf")!)).not.toBeNull();
    expect(await erinnert(ids.get("aktiv")!)).not.toBeNull();
    for (const n of ["zu", "archiv", "uebung"]) {
      expect(await erinnert(ids.get(n)!), n).toBeNull();
    }
    expect(await benachrichtigungen(entwurf.l, entwurf.person)).toHaveLength(1);
    expect(await benachrichtigungen(zu.l, zu.person)).toHaveLength(0);
    // Wer die Art abgeschaltet hat, bekommt keine Zeile (die Aufgabe gilt trotzdem als erinnert)
    expect(await benachrichtigungen(aktiv.l, aus)).toHaveLength(0);
    expect(await erinnert(abgeschaltet)).not.toBeNull();
  });

  test("ein Lauf ist eine Anweisung für alle Aufgaben und Lager; ein leerer Lauf kostet nur diese", async () => {
    const lager = await Promise.all([fall(), fall(), fall()]);
    for (const { l, person } of lager) {
      for (let i = 0; i < 5; i++) {
        await aufgabeDirekt(
          { frist: "2031-10-11", verantwortlichPersonId: person },
          l,
        );
      }
    }
    const vorher = protokoll.length;
    expect(await lauf("2031-10-10T05:30:00Z")).toBe(15);
    const abfragen = protokoll.slice(vorher);
    // Genau eine Anweisung wählt und vermerkt alle fälligen Aufgaben
    expect(
      abfragen.filter((q) => q.includes("frist_erinnert_am")),
    ).toHaveLength(1);
    // Eine Benachrichtigung je Person (drei Lager mit je einer Person), nicht je Aufgabe
    for (const { l, person } of lager) {
      expect(await benachrichtigungen(l, person)).toHaveLength(1);
    }
    // Ein Lauf ohne Fälliges: dieselbe eine Anweisung, sonst nichts an Aufgaben oder Benachrichtigungen
    const leer = protokoll.length;
    expect(await lauf("2031-10-10T06:30:00Z")).toBe(0);
    const leerAbfragen = protokoll
      .slice(leer)
      .filter((q) => /aufgabe|lager_benachrichtigung/.test(q));
    expect(leerAbfragen).toHaveLength(1);
    expect(leerAbfragen[0]).toContain("frist_erinnert_am");
  });

  test("ein Fehler im Lauf rollt alles zurück: nichts vermerkt, keine Benachrichtigung", async () => {
    const { l, person } = await fall();
    const id = await aufgabeDirekt(
      { frist: "2031-12-10", verantwortlichPersonId: person },
      l,
    );
    // Alles ist geschrieben, dann bricht die Transaktion ab: Der Vermerk und die Benachrichtigung gehen zurück
    const kaputt = Object.create(db) as typeof db;
    kaputt.transaction = (async (fn: (tx: never) => Promise<unknown>) =>
      db.transaction(async (tx) => {
        await fn(tx as never);
        throw new Error("Absicht");
      })) as typeof db.transaction;
    await expect(
      sendeFristErinnerungen(kaputt, { jetzt: um("2031-12-10T05:30:00Z") }),
    ).rejects.toThrow("Absicht");
    expect(await erinnert(id)).toBeNull();
    expect(await benachrichtigungen(l, person)).toHaveLength(0);
    // Der nächste Lauf holt es nach
    expect(await lauf("2031-12-10T05:35:00Z")).toBe(1);
  });
});

describe("Anwesenheit: Lagertag und Abschnitt gehören zum Lager", () => {
  const A = (id = lagerId) => `${L(id)}/anwesenheit`;
  async function tagUndAbschnitt(id: string, datum = "2027-07-11") {
    const t = await anfrage(leiter(), "POST", `${Z(id)}/lagertage`, { datum });
    const a = await anfrage(leiter(), "POST", `${Z(id)}/tagesabschnitte`, {
      name: `Abschnitt ${randomUUID().slice(0, 6)}`,
    });
    expect([t.status, a.status]).toEqual([201, 201]);
    return {
      lagertagId: t.body.id,
      tagesabschnittId: a.body.id,
      tag: t.body,
      abschnitt: a.body,
    };
  }

  test("unbekannte, fremde und gelöschte IDs sind 400 FELD_UNBEKANNT auf allen drei Wegen", async () => {
    const l = await neuesLager();
    const eigenes = await tagUndAbschnitt(l);
    const anderes = await tagUndAbschnitt(await neuesLager());
    const geloescht = await tagUndAbschnitt(l, "2027-07-12");
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${Z(l)}/lagertage/${geloescht.tag.id}?version=1`,
        )
      ).status,
    ).toBe(204);
    const felder = [
      { lagertagId: randomUUID(), tagesabschnittId: randomUUID() },
      {
        lagertagId: anderes.lagertagId,
        tagesabschnittId: eigenes.tagesabschnittId,
      },
      {
        lagertagId: eigenes.lagertagId,
        tagesabschnittId: anderes.tagesabschnittId,
      },
      {
        lagertagId: geloescht.lagertagId,
        tagesabschnittId: eigenes.tagesabschnittId,
      },
      {
        lagertagId: eigenes.lagertagId,
        tagesabschnittId: geloescht.tagesabschnittId,
      },
    ];
    const vorher = await lagerStand(l);
    for (const f of felder) {
      const leitung = await anfrage(leiter(), "PUT", A(l), {
        eintraege: [{ personId: konten.team.id, ...f, wert: "A" }],
      });
      expect([leitung.status, leitung.body.code]).toEqual([
        400,
        "FELD_UNBEKANNT",
      ]);
      const eigene = await anfrage(konten.team, "PUT", `${A(l)}/eigene`, {
        eintraege: [{ ...f, wert: "A" }],
      });
      expect([eigene.status, eigene.body.code]).toEqual([
        400,
        "FELD_UNBEKANNT",
      ]);
      const anfrageAn = await anfrage(konten.team, "POST", `${A(l)}/anfragen`, {
        eintraege: [{ ...f, wert: "F" }],
      });
      expect([anfrageAn.status, anfrageAn.body.code]).toEqual([
        400,
        "FELD_UNBEKANNT",
      ]);
    }
    expect((await lagerStand(l)).seq).toBe(vorher.seq);
    // Das eigene Feld geht
    const ok = await anfrage(konten.team, "PUT", `${A(l)}/eigene`, {
      eintraege: [
        {
          lagertagId: eigenes.lagertagId,
          tagesabschnittId: eigenes.tagesabschnittId,
          wert: "A",
        },
      ],
    });
    expect(ok.status).toBe(200);
  });

  test("die Datenbank hält es auch ohne die Routen: Fremdschlüssel mit Lager", async () => {
    const l = await neuesLager();
    const anderes = await tagUndAbschnitt(await neuesLager());
    const eigenes = await tagUndAbschnitt(l);
    await expect(
      db.insert(schema.anwesenheit).values({
        lagerId: l,
        personId: konten.team.id!,
        lagertagId: anderes.lagertagId,
        tagesabschnittId: eigenes.tagesabschnittId,
        wert: "A",
        lagerSeq: 0,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.anwesenheitAnfrage).values({
        lagerId: l,
        personId: konten.team.id!,
        lagertagId: eigenes.lagertagId,
        tagesabschnittId: anderes.tagesabschnittId,
        wert: "A",
        lagerSeq: 0,
      }),
    ).rejects.toThrow();
  });

  test("endgültig gelöschter Tag oder Abschnitt nimmt die Einträge mit (ON DELETE CASCADE)", async () => {
    const l = await neuesLager();
    const f = await tagUndAbschnitt(l);
    await anfrage(konten.team, "PUT", `${A(l)}/eigene`, {
      eintraege: [
        {
          lagertagId: f.lagertagId,
          tagesabschnittId: f.tagesabschnittId,
          wert: "A",
        },
      ],
    });
    const da = () =>
      db
        .select({ id: schema.anwesenheit.id })
        .from(schema.anwesenheit)
        .where(eq(schema.anwesenheit.lagerId, l));
    expect(await da()).toHaveLength(1);
    await db
      .delete(schema.tagesabschnitt)
      .where(eq(schema.tagesabschnitt.id, f.tagesabschnittId));
    expect(await da()).toHaveLength(0);
  });
});
