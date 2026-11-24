import { eq } from "drizzle-orm";
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

// Profilbild in den Antworten der Lager-Routen (#697): bildUrl bei Konten, die Mitglied des Lagers sind und ein Bild haben; sonst null (kein Bild, Teilnehmende, Nicht-Mitglieder)
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
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

let welt: Welt;
let konten: Record<LagerPersona, PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(
    LAGER_PERSONAS.map(
      async (p) => [p, await legePersonaAn(welt, KONTO_FUER[p])] as const,
    ),
  );
  konten = Object.fromEntries(liste) as Record<LagerPersona, PersonaKonto>;
});

// Antworten prüft der Test Feld für Feld
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
const L = (id: string) => `/api/v1/lager/${id}`;

// Ein frisches Lager mit den vier Lager-Rollen; Leitung hat ein Bild, Team und Lagerleitung nicht
async function neuesLager() {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId: welt.testabteilungId,
      titel: "Bildlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status: "aktiv",
    })
    .returning({ id: schema.lager.id });
  const id = zeile!.id;
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
async function setzeBild(personId: string) {
  await db
    .insert(schema.profilbild)
    .values({ userId: personId, inhalt: new Uint8Array([1, 2, 3]) })
    .onConflictDoNothing();
}
const url = (id: string) =>
  new RegExp(`^/api/v1/personen/${id}/bild\\?v=\\d+$`);
const bildDe = (id?: string | null) => expect.stringMatching(url(id!));

beforeAll(async () => {
  await setzeBild(konten.leitung.id!);
  // Die Abteilungsleitung hat ein Bild, ist aber in keinem Lager Mitglied
  await setzeBild(konten.abteilungsleitung.id!);
});

describe("Mitglieder, Aufgaben, Ressorts", () => {
  test("Mitglieder: Pfad mit Bild, null ohne", async () => {
    const id = await neuesLager();
    const a = await anfrage(konten.lesen, "GET", `${L(id)}/mitglieder`);
    expect(a.status).toBe(200);
    const je = new Map(
      a.body.mitglieder.map((m: { personId: string; bildUrl: unknown }) => [
        m.personId,
        m.bildUrl,
      ]),
    );
    expect(je.get(konten.leitung.id!)).toEqual(bildDe(konten.leitung.id));
    expect(je.get(konten.team.id!)).toBeNull();
    expect(je.get(konten.lagerleitung.id!)).toBeNull();
  });

  test("Aufgaben: Verantwortliche und Unterstützung", async () => {
    const id = await neuesLager();
    const neu = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(id)}/aufgaben`,
      {
        titel: "Zelte",
        verantwortlichPersonId: konten.leitung.id,
        unterstuetzungPersonIds: [konten.team.id],
      },
    );
    expect(neu.status).toBe(201);
    const a = await anfrage(konten.lagerleitung, "GET", `${L(id)}/aufgaben`);
    const z = a.body.aufgaben[0];
    expect(z.verantwortlich.bildUrl).toEqual(bildDe(konten.leitung.id));
    expect(z.unterstuetzung).toHaveLength(1);
    expect(z.unterstuetzung[0].bildUrl).toBeNull();
  });

  test("Ressort: Leitung mit Bild, Stellvertretung ohne", async () => {
    const id = await neuesLager();
    const neu = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(id)}/ressorts`,
      {
        kuerzel: "KÜ",
        name: "Küche",
        leitungPersonId: konten.leitung.id,
        stvPersonId: konten.team.id,
      },
    );
    expect(neu.status).toBe(201);
    const a = await anfrage(konten.lesen, "GET", `${L(id)}/ressorts`);
    const r = a.body.ressorts[0];
    expect(r.leitung.bildUrl).toEqual(bildDe(konten.leitung.id));
    expect(r.stv.bildUrl).toBeNull();
  });
});

describe("Pinnwand, Fahrten, Gruppen, Schichtplan", () => {
  test("Pinnwand: Autor mit Bild; die Abteilungsleitung ohne Mitgliedschaft nie", async () => {
    const id = await neuesLager();
    // Die Leitung darf schreiben und hat ein Bild
    const von = await anfrage(konten.leitung, "POST", `${L(id)}/pinnwand`, {
      titel: "Von der Leitung",
    });
    expect(von.status).toBe(201);
    const al = await anfrage(
      konten.abteilungsleitung,
      "POST",
      `${L(id)}/pinnwand`,
      {
        titel: "Von der Abteilungsleitung",
      },
    );
    expect(al.status).toBe(201);
    const a = await anfrage(konten.team, "GET", `${L(id)}/pinnwand`);
    const je = Object.fromEntries(
      a.body.beitraege.map(
        (b: { titel: string; von: { bildUrl: string | null } }) => [
          b.titel,
          b.von.bildUrl,
        ],
      ),
    );
    expect(je["Von der Leitung"]).toEqual(bildDe(konten.leitung.id));
    // Kein Mitglied: das Bild ginge die Route der Person nicht heraus
    expect(je["Von der Abteilungsleitung"]).toBeNull();
  });

  test("Fahrten: Fahrer und Mitfahrer mit Bild, Teilnehmende null; Personen ohne Fahrt", async () => {
    const id = await neuesLager();
    const fahrt = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(id)}/fahrten`,
      {
        richtung: "hin",
        art: "auto",
        name: "Auto",
        plaetze: 4,
        fahrerPersonId: konten.leitung.id,
      },
    );
    expect(fahrt.status).toBe(201);
    const [kind] = await db
      .insert(schema.teilnehmer)
      .values({
        lagerId: id,
        vorname: "Kind",
        nachname: "Muster",
        stufe: "Wolf",
        lagerSeq: 0,
      })
      .returning({ id: schema.teilnehmer.id });
    for (const wer of [
      { teilnehmerId: kind!.id },
      { personId: konten.team.id },
    ]) {
      const m = await anfrage(
        konten.lagerleitung,
        "POST",
        `${L(id)}/fahrten/${fahrt.body.id}/mitfahrer`,
        wer,
      );
      expect(m.status).toBe(201);
    }
    const a = await anfrage(konten.lesen, "GET", `${L(id)}/fahrten`);
    const f = a.body.fahrten[0];
    expect(f.fahrer.bildUrl).toEqual(bildDe(konten.leitung.id));
    expect(f.mitfahrer).toHaveLength(2);
    for (const m of f.mitfahrer) expect(m.bildUrl).toBeNull();

    // Ohne Fahrt (Rückfahrt: niemand fährt): Personen mit Bild, Team ohne, Teilnehmende null
    const o = await anfrage(
      konten.lesen,
      "GET",
      `${L(id)}/fahrten/ohne?richtung=rueck`,
    );
    expect(o.status).toBe(200);
    const leitung = o.body.personen.find(
      (p: { personId: string | null }) => p.personId === konten.leitung.id,
    );
    expect(leitung.bildUrl).toEqual(bildDe(konten.leitung.id));
    for (const p of o.body.personen) {
      if (p.personId !== konten.leitung.id) expect(p.bildUrl).toBeNull();
    }
    expect(
      o.body.personen.some(
        (p: { teilnehmerId: string | null }) => p.teilnehmerId,
      ),
    ).toBe(true);
  });

  test("Gruppen: Personen mit Bild, Teilnehmende ohne Feld", async () => {
    const id = await neuesLager();
    const g = await anfrage(konten.lagerleitung, "POST", `${L(id)}/gruppen`, {
      name: "Rot",
    });
    expect(g.status).toBe(201);
    const [kind] = await db
      .insert(schema.teilnehmer)
      .values({
        lagerId: id,
        vorname: "Kind",
        nachname: "Muster",
        stufe: "Wolf",
        lagerSeq: 0,
      })
      .returning({ id: schema.teilnehmer.id });
    const z = await anfrage(
      konten.lagerleitung,
      "PUT",
      `${L(id)}/gruppen/zuordnung`,
      {
        gruppeId: g.body.id,
        teilnehmerIds: [kind!.id],
        personIds: [konten.leitung.id, konten.team.id],
        rolle: "leitung",
      },
    );
    expect(z.status).toBe(200);
    const a = await anfrage(konten.lesen, "GET", `${L(id)}/gruppen`);
    const gruppe = a.body.gruppen[0];
    const je = new Map(
      gruppe.personen.map((p: { personId: string; bildUrl: unknown }) => [
        p.personId,
        p.bildUrl,
      ]),
    );
    expect(je.get(konten.leitung.id!)).toEqual(bildDe(konten.leitung.id));
    expect(je.get(konten.team.id!)).toBeNull();
    expect(gruppe.teilnehmer).toHaveLength(1);
    expect(gruppe.teilnehmer[0]).not.toHaveProperty("bildUrl");
  });

  test("Schichtplan: Person mit Bild, Teilnehmende null", async () => {
    const id = await neuesLager();
    const [tag] = await db
      .insert(schema.lagertag)
      .values({ lagerId: id, datum: "2027-07-10", lagerSeq: 0 })
      .returning({ id: schema.lagertag.id });
    const [abschnitt] = await db
      .insert(schema.tagesabschnitt)
      .values({ lagerId: id, name: "morgen", reihenfolge: 0, lagerSeq: 0 })
      .returning({ id: schema.tagesabschnitt.id });
    const [dienst] = await db
      .insert(schema.dienst)
      .values({
        lagerId: id,
        name: "Küche",
        tagesabschnittId: abschnitt!.id,
        lagerSeq: 0,
      })
      .returning({ id: schema.dienst.id });
    const [kind] = await db
      .insert(schema.teilnehmer)
      .values({
        lagerId: id,
        vorname: "Kind",
        nachname: "Muster",
        stufe: "Wolf",
        lagerSeq: 0,
      })
      .returning({ id: schema.teilnehmer.id });
    const basis = {
      lagerId: id,
      lagertagId: tag!.id,
      tagesabschnittId: abschnitt!.id,
      dienstId: dienst!.id,
      lagerSeq: 0,
    };
    await db.insert(schema.schicht).values([
      { ...basis, personId: konten.leitung.id! },
      { ...basis, personId: konten.team.id! },
      { ...basis, teilnehmerId: kind!.id },
    ]);
    const a = await anfrage(konten.lesen, "GET", `${L(id)}/schichtplan`);
    expect(a.status).toBe(200);
    const mit = (personId: string) =>
      a.body.schichten.find(
        (s: { personId: string }) => s.personId === personId,
      );
    expect(mit(konten.leitung.id!).bildUrl).toEqual(bildDe(konten.leitung.id));
    expect(mit(konten.team.id!).bildUrl).toBeNull();
    const k = a.body.schichten.find(
      (s: { teilnehmerId: string | null }) => s.teilnehmerId,
    );
    expect(k.bildUrl).toBeNull();
    for (const s of a.body.statistik) {
      if (s.personId === konten.leitung.id) {
        expect(s.bildUrl).toEqual(bildDe(konten.leitung.id));
      } else expect(s.bildUrl).toBeNull();
    }
  });

  test("Anwesenheit: bilder nennt nur Personen mit Bild, nie Teilnehmende", async () => {
    const id = await neuesLager();
    const [tag] = await db
      .insert(schema.lagertag)
      .values({ lagerId: id, datum: "2027-07-10", lagerSeq: 0 })
      .returning({ id: schema.lagertag.id });
    const [abschnitt] = await db
      .insert(schema.tagesabschnitt)
      .values({ lagerId: id, name: "morgen", reihenfolge: 0, lagerSeq: 0 })
      .returning({ id: schema.tagesabschnitt.id });
    const [kind] = await db
      .insert(schema.teilnehmer)
      .values({
        lagerId: id,
        vorname: "Kind",
        nachname: "Muster",
        stufe: "Wolf",
        lagerSeq: 0,
      })
      .returning({ id: schema.teilnehmer.id });
    const feld = {
      lagertagId: tag!.id,
      tagesabschnittId: abschnitt!.id,
      wert: "A",
    };
    const setzen = await anfrage(
      konten.lagerleitung,
      "PUT",
      `${L(id)}/anwesenheit`,
      {
        eintraege: [
          { ...feld, personId: konten.leitung.id },
          { ...feld, personId: konten.team.id },
          { ...feld, teilnehmerId: kind!.id },
        ],
      },
    );
    expect(setzen.status, JSON.stringify(setzen.body)).toBe(200);
    const a = await anfrage(konten.lagerleitung, "GET", `${L(id)}/anwesenheit`);
    expect(a.status).toBe(200);
    expect(a.body.bilder).toEqual({
      [konten.leitung.id!]: bildDe(konten.leitung.id),
    });
    expect(a.body.namen[kind!.id]).toBeTruthy();
  });

  test("ein Konto, das nicht mehr Mitglied ist, liefert kein Bild mehr", async () => {
    const id = await neuesLager();
    const neu = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(id)}/pinnwand`,
      {
        titel: "Alt",
      },
    );
    expect(neu.status).toBe(201);
    // Autorenschaft des Beitrags auf die Leitung setzen, dann die Mitgliedschaft lösen
    await db
      .update(schema.pinnwandBeitrag)
      .set({ erstelltVon: konten.leitung.id! })
      .where(eq(schema.pinnwandBeitrag.id, neu.body.id));
    const vorher = await anfrage(konten.lesen, "GET", `${L(id)}/pinnwand`);
    expect(vorher.body.beitraege[0].von.bildUrl).toEqual(
      bildDe(konten.leitung.id),
    );
    await db
      .update(schema.user)
      .set({ deaktiviertAm: new Date() })
      .where(eq(schema.user.id, konten.leitung.id!));
    try {
      const nachher = await anfrage(konten.lesen, "GET", `${L(id)}/pinnwand`);
      expect(nachher.body.beitraege[0].von.bildUrl).toBeNull();
    } finally {
      await db
        .update(schema.user)
        .set({ deaktiviertAm: null })
        .where(eq(schema.user.id, konten.leitung.id!));
    }
  });
});

describe("GET /api/v1/personen/{id}/bild: der Weg «gemeinsames Lager»", () => {
  const bild = (konto: PersonaKonto, personId: string) =>
    app.request(`/api/v1/personen/${personId}/bild`, {
      headers: konto.headers,
    });

  test("Mitglieder desselben Lagers sehen das Bild, andere nicht", async () => {
    await neuesLager();
    for (const p of ["lagerleitung", "team", "lesen"] as const) {
      expect([p, (await bild(konten[p], konten.leitung.id!)).status]).toEqual([
        p,
        200,
      ]);
    }
    // Ein Konto der Abteilung ohne Mitgliedschaft, ohne Chat, ohne Stufe: kein Weg, 404 wie bei einem fehlenden Bild
    expect(
      (await bild(konten.ohneMitgliedschaft, konten.leitung.id!)).status,
    ).toBe(404);
    expect(
      (await bild(konten.fremdeAbteilung, konten.leitung.id!)).status,
    ).toBe(404);
    expect((await bild(konten.ohneLogin, konten.leitung.id!)).status).toBe(401);
  });

  test("ein Konto im Lager, das kein Mitglied dieses Lagers ist, kommt nicht über ein fremdes Lager", async () => {
    // Das zweite Lager hat nur die Lagerleitung; die Leitung ist dort nicht Mitglied
    const [zeile] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Anderes Lager",
        von: "2027-07-10",
        bis: "2027-07-24",
        status: "aktiv",
      })
      .returning({ id: schema.lager.id });
    await db.insert(schema.lagerMitglied).values({
      lagerId: zeile!.id,
      personId: konten.ohneMitgliedschaft.id!,
      rolle: "team",
    });
    // Nur das zweite Lager gemeinsam: die Leitung ist dort kein Mitglied
    expect(
      (await bild(konten.ohneMitgliedschaft, konten.leitung.id!)).status,
    ).toBe(404);
  });
});
