import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
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
import type { Db } from "../../src/db/client.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { ladeSeiten } from "../../src/seiten.js";
import {
  AUFBEWAHRUNG_TAGE,
  loescheAlteAnmeldungen,
  schluesselMitAntworten,
  zaehleAnmeldungen,
} from "../../src/termine/anlass-anmeldungen.js";
import { ANFRAGEN_PRO_MINUTE } from "../../src/routes/termine/anlaesse.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { legeProgrammAn } from "../hilfen/programme.js";
import { KONTO_FUER, type TerminePersona } from "./matrix.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = {
  appMinVersion: "1.2.0",
  sql,
  auth,
  seiten: ladeSeiten(),
};
// Neue App je Test: Die Ratenbegrenzung zählt je Instanz
let app = erstelleApp({ ...optionen, db });
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      PERSONAS.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Persona, PersonaKonto>;
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  app = erstelleApp({ ...optionen, db });
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Antworten der Routen sind in den Tests untypisiert
type Json = any;

const id = (persona: TerminePersona) => konten[KONTO_FUER[persona]].id!;
async function anfrage(
  persona: TerminePersona,
  methode: "GET" | "PUT" | "DELETE",
  pfad: string,
  body?: unknown,
) {
  const konto = konten[KONTO_FUER[persona]];
  return app.request(pfad, {
    method: methode,
    headers:
      body === undefined
        ? konto.headers
        : { ...konto.headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const lies = (persona: TerminePersona, anlassId: string) =>
  anfrage(persona, "GET", `/api/v1/anlaesse/${anlassId}`);
const melde = (
  persona: TerminePersona,
  anlassId: string,
  body: { kindId?: string; antworten: Record<string, unknown> },
) => anfrage(persona, "PUT", `/api/v1/anlaesse/${anlassId}/anmeldung`, body);
const abmelden = (persona: TerminePersona, anlassId: string, kindId?: string) =>
  anfrage(
    persona,
    "DELETE",
    `/api/v1/anlaesse/${anlassId}/anmeldung${kindId ? `?kindId=${kindId}` : ""}`,
  );

type FeldSpez = {
  schluessel: string;
  beschriftung?: string;
  typ?: "text" | "ja_nein" | "auswahl";
  optionen?: string[];
  pflicht?: boolean;
};
const STANDARD_FELDER: FeldSpez[] = [{ schluessel: "bemerkung" }];

interface AnlassSpez {
  fuer?: "kind" | "person";
  offen?: boolean;
  frist?: Date | null;
  sichtbarkeit?: "oeffentlich" | "angemeldet" | "tags";
  tags?: string[];
  felder?: FeldSpez[];
  abteilungId?: string;
  beginn?: Date;
  ende?: Date;
  status?: "aktiv" | "abgesagt" | "pruefen";
  art?: "anlass" | "lager";
  // Termintags für «Mein Kalender»
  terminTags?: string[];
}
async function neuerAnlass(spez: AnlassSpez = {}) {
  const abteilungId = spez.abteilungId ?? welt.testabteilungId;
  const termin = await legeProgrammAn(db, {
    abteilungId,
    sichtbarkeit: "eltern",
    titel: `Anlass ${randomUUID().slice(0, 6)}`,
    beginn: spez.beginn,
    ende: spez.ende,
  });
  if (spez.status) {
    await db
      .update(schema.programm)
      .set({ status: spez.status })
      .where(eq(schema.programm.id, termin.id));
  }
  if (spez.terminTags?.length) {
    await db
      .insert(schema.programmTag)
      .values(
        spez.terminTags.map((tagId) => ({ programmId: termin.id, tagId })),
      );
  }
  const [zeile] = await db
    .insert(schema.anlass)
    .values({
      abteilungId,
      programmId: termin.id,
      art: spez.art ?? "anlass",
      anmeldungFuer: spez.fuer ?? "kind",
      anmeldungOffen: spez.offen ?? true,
      frist: spez.frist ?? null,
      sichtbarkeit: spez.sichtbarkeit ?? "angemeldet",
      sichtbarkeitTags: spez.tags ?? [],
    })
    .returning({ id: schema.anlass.id });
  const felder = spez.felder ?? STANDARD_FELDER;
  if (felder.length > 0) {
    await db.insert(schema.anlassFeld).values(
      felder.map((f, i) => ({
        anlassId: zeile.id,
        schluessel: f.schluessel,
        beschriftung: f.beschriftung ?? f.schluessel,
        typ: f.typ ?? "text",
        optionen: f.optionen ?? [],
        pflicht: f.pflicht ?? false,
        reihenfolge: i,
      })),
    );
  }
  return { id: zeile.id, programmId: termin.id };
}
const anmeldungen = (anlassId: string) =>
  db
    .select()
    .from(schema.anlassAnmeldung)
    .where(eq(schema.anlassAnmeldung.anlassId, anlassId));
const audit = (aktion: string, zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.aktion, aktion),
        eq(schema.auditLog.zielId, zielId),
      ),
    );

describe("Anlass lesen (Vorlage)", () => {
  test("Eltern sehen ihre aktiven Kinder mit den Angaben aus dem Konto", async () => {
    const a = await neuerAnlass();
    const antwort = await lies("elternA", a.id);
    expect(antwort.status).toBe(200);
    const b: Json = await antwort.json();
    expect(b).toMatchObject({
      id: a.id,
      terminId: a.programmId,
      anmeldungOffen: true,
      frist: null,
      anmeldungFuer: "kind",
      felder: [
        {
          schluessel: "bemerkung",
          typ: "text",
          optionen: [],
          pflicht: false,
        },
      ],
    });
    expect(b.teilnehmende).toHaveLength(1);
    expect(b.teilnehmende[0]).toMatchObject({
      kindId: welt.kindAId,
      anmeldung: null,
    });
    const konto = Object.fromEntries(
      b.teilnehmende[0].konto.map((k: Json) => [k.schluessel, k.wert]),
    );
    expect(konto).toMatchObject({ stufe: "Stufe A" });
    expect(Object.keys(konto)).toEqual(
      expect.arrayContaining(["vorname", "nachname", "stufe"]),
    );
    // Keine Gesundheitsdaten, kein Telefon, keine E-Mail
    expect(JSON.stringify(b)).not.toMatch(/@|telefon|email|gesundheit/i);
  });

  test("jede Familie sieht nur die eigenen Kinder; ohne Kind ist die Liste leer", async () => {
    const a = await neuerAnlass();
    const ids = async (p: TerminePersona) =>
      ((await (await lies(p, a.id)).json()) as Json).teilnehmende.map(
        (t: Json) => t.kindId,
      );
    expect(await ids("elternA")).toEqual([welt.kindAId]);
    expect(await ids("elternB")).toEqual([welt.kindBId]);
    expect(await ids("leitungAElternB")).toEqual([welt.kindBId]);
    expect(await ids("leitungA")).toEqual([]);
    expect(await ids("abteilungsleitung")).toEqual([]);
  });

  test("ein inaktives Kind erscheint nicht", async () => {
    const [k] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Ehemalig",
        nachname: "Kind",
        stufeId: welt.stufeAId,
        inaktivSeit: new Date(),
      })
      .returning({ id: schema.kind.id });
    await db
      .insert(schema.kindEltern)
      .values({ kindId: k.id, userId: id("elternA") });
    const a = await neuerAnlass();
    const b: Json = await (await lies("elternA", a.id)).json();
    expect(b.teilnehmende.map((t: Json) => t.kindId)).toEqual([welt.kindAId]);
  });

  test("bei «person» ist die Person selbst die Teilnehmende, mit Name und Cevi-Name aus dem Konto", async () => {
    await db
      .update(schema.user)
      .set({ ceviName: "Blitz" })
      .where(eq(schema.user.id, id("leitungA")));
    const a = await neuerAnlass({ fuer: "person" });
    const b: Json = await (await lies("leitungA", a.id)).json();
    expect(b.anmeldungFuer).toBe("person");
    expect(b.teilnehmende).toEqual([
      {
        kindId: null,
        name: "Blitz",
        konto: [
          { schluessel: "name", beschriftung: "Name", wert: "Leitende A" },
          { schluessel: "cevi_name", beschriftung: "Cevi-Name", wert: "Blitz" },
        ],
        anmeldung: null,
      },
    ]);
    await db
      .update(schema.user)
      .set({ ceviName: null })
      .where(eq(schema.user.id, id("leitungA")));
  });

  test("Felder kommen in der Reihenfolge der Verwaltung", async () => {
    const a = await neuerAnlass({
      felder: [
        { schluessel: "zweites" },
        { schluessel: "erstes", typ: "ja_nein", pflicht: true },
        { schluessel: "drittes", typ: "auswahl", optionen: ["x", "y"] },
      ],
    });
    const b: Json = await (await lies("elternA", a.id)).json();
    expect(b.felder.map((f: Json) => f.schluessel)).toEqual([
      "zweites",
      "erstes",
      "drittes",
    ]);
    expect(b.felder[2]).toMatchObject({ typ: "auswahl", optionen: ["x", "y"] });
  });

  test("Frist, Absage und vergangener Termin schliessen die Anmeldung (anmeldungOffen)", async () => {
    const offen = async (spez: AnlassSpez) =>
      (
        (await (
          await lies("elternA", (await neuerAnlass(spez)).id)
        ).json()) as Json
      ).anmeldungOffen;
    expect(await offen({})).toBe(true);
    expect(await offen({ offen: false })).toBe(false);
    expect(await offen({ frist: new Date(Date.now() + 3_600_000) })).toBe(true);
    expect(await offen({ frist: new Date(Date.now() - 3_600_000) })).toBe(
      false,
    );
    expect(await offen({ status: "abgesagt" })).toBe(false);
    expect(await offen({ status: "pruefen" })).toBe(true);
    expect(
      await offen({
        beginn: new Date("2026-01-10T10:00:00Z"),
        ende: new Date("2026-01-10T12:00:00Z"),
      }),
    ).toBe(false);
  });

  test("ein unbekannter oder fremder Anlass ist 404, eine ungültige ID 400", async () => {
    expect((await lies("elternA", randomUUID())).status).toBe(404);
    expect((await lies("elternA", "kein-uuid")).status).toBe(400);
    const fremd = await neuerAnlass({ abteilungId: welt.demoAbteilungId });
    for (const p of ["elternA", "abteilungsleitung"] as const) {
      expect((await lies(p, fremd.id)).status).toBe(404);
    }
    const eigen = await neuerAnlass();
    for (const p of ["fremdeEltern", "fremdeAbteilungsleitung"] as const) {
      expect((await lies(p, eigen.id)).status).toBe(404);
    }
  });
});

describe("Sichtbarkeit: wer den Anlass sehen darf, darf sich anmelden", () => {
  test("«tags»: nur Personen mit einem der Tags, Eltern über die Stufe ihres Kindes, die Abteilungsleitung immer", async () => {
    const a = await neuerAnlass({
      sichtbarkeit: "tags",
      tags: [welt.stufeAId],
      fuer: "person",
    });
    const status = async (p: TerminePersona) => (await lies(p, a.id)).status;
    // Stufe A: Stufenleitung und Leitung der Stufe A, Eltern eines Kindes der Stufe A
    expect(await status("stufenleitungA")).toBe(200);
    expect(await status("leitungA")).toBe(200);
    expect(await status("elternA")).toBe(200);
    expect(await status("abteilungsleitung")).toBe(200);
    // Stufe B und alle ohne den Tag
    expect(await status("stufenleitungB")).toBe(404);
    expect(await status("leitungB")).toBe(404);
    expect(await status("elternB")).toBe(404);
    expect(await status("fremdeEltern")).toBe(404);
    // Anmelden ist 404 wie das Lesen
    expect((await melde("elternB", a.id, { antworten: {} })).status).toBe(404);
    expect((await abmelden("elternB", a.id)).status).toBe(404);
    expect((await melde("leitungA", a.id, { antworten: {} })).status).toBe(200);
  });

  test("ein Anlass mit Tags ohne Menge sieht nur die Abteilungsleitung", async () => {
    const a = await neuerAnlass({ sichtbarkeit: "tags", tags: [] });
    expect((await lies("elternA", a.id)).status).toBe(404);
    expect((await lies("leitungA", a.id)).status).toBe(404);
    expect((await lies("abteilungsleitung", a.id)).status).toBe(200);
  });

  test("«oeffentlich» und «angemeldet» sehen alle der Abteilung", async () => {
    for (const sichtbarkeit of ["oeffentlich", "angemeldet"] as const) {
      const a = await neuerAnlass({ sichtbarkeit });
      for (const p of ["elternB", "leitungB", "stufenleitungA"] as const) {
        expect((await lies(p, a.id)).status).toBe(200);
      }
      expect((await lies("fremdeEltern", a.id)).status).toBe(404);
    }
  });
});

describe("Anmelden", () => {
  test("Eltern melden ihr Kind an, die Antwort ist die Bestätigung, die Vorlage zeigt sie", async () => {
    const a = await neuerAnlass({
      felder: [
        { schluessel: "bemerkung", pflicht: true },
        { schluessel: "mitfahrt", typ: "ja_nein" },
        { schluessel: "menue", typ: "auswahl", optionen: ["alles", "vegi"] },
      ],
    });
    const antwort = await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten: {
        bemerkung: "  Freue mich  ",
        mitfahrt: false,
        menue: "vegi",
      },
    });
    expect(antwort.status).toBe(200);
    const b: Json = await antwort.json();
    expect(b).toMatchObject({
      status: "angemeldet",
      antworten: { bemerkung: "Freue mich", mitfahrt: false, menue: "vegi" },
    });
    expect(Object.keys(b).sort()).toEqual([
      "antworten",
      "geaendertAm",
      "id",
      "status",
    ]);
    const zeilen = await anmeldungen(a.id);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      id: b.id,
      userId: id("elternA"),
      kindId: welt.kindAId,
    });
    const vorlage: Json = await (await lies("elternA", a.id)).json();
    expect(vorlage.teilnehmende[0].anmeldung).toMatchObject({
      id: b.id,
      status: "angemeldet",
      antworten: { bemerkung: "Freue mich" },
    });
    // Die andere Familie sieht die Anmeldung nicht
    const fremd: Json = await (await lies("elternB", a.id)).json();
    expect(fremd.teilnehmende[0].anmeldung).toBeNull();
  });

  test("zweimal dasselbe PUT ergibt eine Zeile und dieselbe ID, die Antworten ändern sich", async () => {
    const a = await neuerAnlass();
    const erste: Json = await (
      await melde("elternA", a.id, {
        kindId: welt.kindAId,
        antworten: { bemerkung: "eins" },
      })
    ).json();
    const zweite: Json = await (
      await melde("elternA", a.id, {
        kindId: welt.kindAId,
        antworten: { bemerkung: "zwei" },
      })
    ).json();
    expect(zweite.id).toBe(erste.id);
    expect(zweite.antworten).toEqual({ bemerkung: "zwei" });
    const zeilen = await anmeldungen(a.id);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].geaendertAm.getTime()).toBeGreaterThanOrEqual(
      zeilen[0].erstelltAm.getTime(),
    );
  });

  test("gleichzeitige Aufrufe ergeben eine Zeile (Kind und Person)", async () => {
    const kind = await neuerAnlass();
    const person = await neuerAnlass({ fuer: "person" });
    const ergebnisse = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        melde("elternA", kind.id, {
          kindId: welt.kindAId,
          antworten: { bemerkung: "x" },
        }),
      ),
      ...Array.from({ length: 6 }, () =>
        melde("leitungA", person.id, { antworten: { bemerkung: "x" } }),
      ),
    ]);
    expect(ergebnisse.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(await anmeldungen(kind.id)).toHaveLength(1);
    expect(await anmeldungen(person.id)).toHaveLength(1);
  });

  test("beide Elternteile eines Kindes teilen sich eine Anmeldung", async () => {
    // Die Leitung B ist hier zugleich zweites Elternteil von Kind A
    await db
      .insert(schema.kindEltern)
      .values({ kindId: welt.kindAId, userId: id("leitungB") });
    const a = await neuerAnlass();
    const erste: Json = await (
      await melde("elternA", a.id, {
        kindId: welt.kindAId,
        antworten: { bemerkung: "von A" },
      })
    ).json();
    const zweite = await melde("leitungB", a.id, {
      kindId: welt.kindAId,
      antworten: { bemerkung: "von B" },
    });
    expect(zweite.status).toBe(200);
    expect(((await zweite.json()) as Json).id).toBe(erste.id);
    expect(await anmeldungen(a.id)).toHaveLength(1);
    // Die andere Person sieht die Anmeldung des Kindes
    const vorlage: Json = await (await lies("elternA", a.id)).json();
    expect(vorlage.teilnehmende[0].anmeldung.antworten).toEqual({
      bemerkung: "von B",
    });
    // Abmelden durch das andere Elternteil gilt für das Kind
    expect((await abmelden("elternA", a.id, welt.kindAId)).status).toBe(204);
    const nachher = await anmeldungen(a.id);
    expect(nachher).toHaveLength(1);
    expect(nachher[0].status).toBe("abgemeldet");
    await db
      .delete(schema.kindEltern)
      .where(
        and(
          eq(schema.kindEltern.kindId, welt.kindAId),
          eq(schema.kindEltern.userId, id("leitungB")),
        ),
      );
  });

  test("fremde Kinder sind 404, auch Kinder anderer Eltern, inaktive und solche einer anderen Abteilung", async () => {
    const a = await neuerAnlass();
    const mit = (p: TerminePersona, kindId: string) =>
      melde(p, a.id, { kindId, antworten: {} });
    expect((await mit("elternA", welt.kindBId)).status).toBe(404);
    expect((await mit("elternB", welt.kindAId)).status).toBe(404);
    expect((await mit("leitungA", welt.kindAId)).status).toBe(404);
    expect((await mit("abteilungsleitung", welt.kindAId)).status).toBe(404);
    expect((await mit("elternA", welt.demoKindId)).status).toBe(404);
    expect((await mit("fremdeEltern", welt.demoKindId)).status).toBe(404);
    expect((await abmelden("elternA", a.id, welt.kindBId)).status).toBe(404);
    expect((await mit("elternA", randomUUID())).status).toBe(404);
    const [inaktiv] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Weg",
        nachname: "Gezogen",
        stufeId: welt.stufeAId,
        inaktivSeit: new Date(),
      })
      .returning({ id: schema.kind.id });
    await db
      .insert(schema.kindEltern)
      .values({ kindId: inaktiv.id, userId: id("elternA") });
    expect((await mit("elternA", inaktiv.id)).status).toBe(404);
    expect(await anmeldungen(a.id)).toHaveLength(0);
  });

  test("kindId ist bei «kind» Pflicht und bei «person» verboten (400)", async () => {
    const kind = await neuerAnlass();
    const person = await neuerAnlass({ fuer: "person" });
    const ohne = await melde("elternA", kind.id, { antworten: {} });
    expect(ohne.status).toBe(400);
    expect(((await ohne.json()) as Json).code).toBe("KIND_ID_PFLICHT");
    const mit = await melde("elternA", person.id, {
      kindId: welt.kindAId,
      antworten: {},
    });
    expect(mit.status).toBe(400);
    expect(((await mit.json()) as Json).code).toBe("KIND_ID_VERBOTEN");
    expect((await abmelden("elternA", kind.id)).status).toBe(400);
    expect((await abmelden("elternA", person.id, welt.kindAId)).status).toBe(
      400,
    );
  });

  test("Personen melden sich selbst an: Leitende, Eltern und die Abteilungsleitung", async () => {
    const a = await neuerAnlass({ fuer: "person" });
    for (const p of [
      "leitungA",
      "elternA",
      "abteilungsleitung",
      "stufenleitungB",
    ] as const) {
      const antwort = await melde(p, a.id, { antworten: { bemerkung: p } });
      expect(antwort.status).toBe(200);
    }
    const zeilen = await anmeldungen(a.id);
    expect(zeilen).toHaveLength(4);
    expect(zeilen.every((z) => z.kindId === null)).toBe(true);
    const vorlage: Json = await (await lies("leitungA", a.id)).json();
    expect(vorlage.teilnehmende[0].anmeldung).toMatchObject({
      status: "angemeldet",
      antworten: { bemerkung: "leitungA" },
    });
    // Eine andere Person sieht diese Anmeldung nicht
    const andere: Json = await (await lies("leitungB", a.id)).json();
    expect(andere.teilnehmende[0].anmeldung).toBeNull();
  });

  test("gesperrte Konten und fremde Abteilungen kommen nicht durch", async () => {
    const a = await neuerAnlass();
    const roh = (p: TerminePersona) =>
      melde(p, a.id, { kindId: welt.kindAId, antworten: {} });
    expect((await roh("passwortPflicht")).status).toBe(403);
    expect((await roh("deaktiviert")).status).toBe(401);
    expect((await roh("ohneLogin")).status).toBe(401);
    expect((await roh("fremdeEltern")).status).toBe(404);
    expect(await anmeldungen(a.id)).toHaveLength(0);
  });
});

describe("Anmeldeschluss", () => {
  const anmelden = (anlassId: string) =>
    melde("elternA", anlassId, {
      kindId: welt.kindAId,
      antworten: {},
    });

  test("ohne Frist ist die Anmeldung offen, mit Frist in der Zukunft auch", async () => {
    expect((await anmelden((await neuerAnlass()).id)).status).toBe(200);
    expect(
      (
        await anmelden(
          (await neuerAnlass({ frist: new Date(Date.now() + 60_000) })).id,
        )
      ).status,
    ).toBe(200);
  });

  test("nach der Frist 409 ANMELDUNG_GESCHLOSSEN, ändern und abmelden auch", async () => {
    const a = await neuerAnlass({ frist: new Date(Date.now() + 60_000) });
    expect((await anmelden(a.id)).status).toBe(200);
    // Die Frist läuft ab
    await db
      .update(schema.anlass)
      .set({ frist: new Date(Date.now() - 1000) })
      .where(eq(schema.anlass.id, a.id));
    const zu = await anmelden(a.id);
    expect(zu.status).toBe(409);
    expect(await zu.json()).toMatchObject({ code: "ANMELDUNG_GESCHLOSSEN" });
    const ab = await abmelden("elternA", a.id, welt.kindAId);
    expect(ab.status).toBe(409);
    // Die bestehende Anmeldung bleibt, wie sie war
    expect((await anmeldungen(a.id))[0].status).toBe("angemeldet");
  });

  test("nicht offen, abgesagt oder vorbei: 409", async () => {
    for (const spez of [
      { offen: false },
      { status: "abgesagt" as const },
      {
        beginn: new Date("2026-01-10T10:00:00Z"),
        ende: new Date("2026-01-10T12:00:00Z"),
      },
    ]) {
      const a = await neuerAnlass(spez);
      const antwort = await anmelden(a.id);
      expect(antwort.status).toBe(409);
      expect(await antwort.json()).toMatchObject({
        code: "ANMELDUNG_GESCHLOSSEN",
      });
      expect(await anmeldungen(a.id)).toHaveLength(0);
    }
  });

  test("ein Termin, der schon läuft, gilt erst am Ende als vorbei; ganztägig bis Ende des letzten Tages", async () => {
    const laeuft = await neuerAnlass({
      beginn: new Date(Date.now() - 3_600_000),
      ende: new Date(Date.now() + 3_600_000),
    });
    expect((await anmelden(laeuft.id)).status).toBe(200);
  });

  test("der Anmeldeschluss gilt vor der Prüfung der Antworten", async () => {
    const a = await neuerAnlass({
      offen: false,
      felder: [{ schluessel: "pflichtfeld", pflicht: true }],
    });
    const antwort = await anmelden(a.id);
    expect(antwort.status).toBe(409);
  });
});

describe("Antworten werden gegen die Felder geprüft", () => {
  const FELDER: FeldSpez[] = [
    { schluessel: "bemerkung", pflicht: true },
    { schluessel: "mitfahrt", typ: "ja_nein" },
    { schluessel: "menue", typ: "auswahl", optionen: ["alles", "vegi"] },
  ];
  const GeheimWert = "GEHEIMER-WERT-12345";

  const versuche = async (antworten: Record<string, unknown>) => {
    const a = await neuerAnlass({ felder: FELDER });
    const antwort = await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten,
    });
    const text = await antwort.text();
    return { status: antwort.status, body: JSON.parse(text) as Json, text, a };
  };
  const codes = (b: Json) =>
    (b.fehler as Json[]).map((f) => `${f.schluessel}:${f.code}`).sort();

  test("unbekannter Schlüssel", async () => {
    const r = await versuche({ bemerkung: "x", gibtsnicht: GeheimWert });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ANTWORTEN_UNGUELTIG");
    expect(codes(r.body)).toEqual(["gibtsnicht:UNBEKANNT"]);
    // Nie der Wert
    expect(r.text).not.toContain(GeheimWert);
    expect(await anmeldungen(r.a.id)).toHaveLength(0);
  });

  test("fehlende Pflichtfelder (auch leer, nur Leerzeichen, null)", async () => {
    for (const antworten of [
      {},
      { bemerkung: "" },
      { bemerkung: "   " },
      { bemerkung: null },
    ]) {
      const r = await versuche(antworten);
      expect(r.status).toBe(400);
      expect(codes(r.body)).toEqual(["bemerkung:PFLICHT"]);
    }
  });

  test("falscher Typ", async () => {
    const r = await versuche({
      bemerkung: 42,
      mitfahrt: GeheimWert,
      menue: true,
    });
    expect(r.status).toBe(400);
    expect(codes(r.body)).toEqual([
      "bemerkung:TYP",
      "menue:TYP",
      "mitfahrt:TYP",
    ]);
    expect(r.text).not.toContain(GeheimWert);
    expect((await versuche({ bemerkung: ["a"] })).status).toBe(400);
    expect((await versuche({ bemerkung: { a: 1 } })).status).toBe(400);
    expect((await versuche({ bemerkung: "x", mitfahrt: "true" })).status).toBe(
      400,
    );
  });

  test("Auswahl ausserhalb der Optionen", async () => {
    const r = await versuche({ bemerkung: "x", menue: GeheimWert });
    expect(r.status).toBe(400);
    expect(codes(r.body)).toEqual(["menue:OPTION"]);
    expect(r.text).not.toContain(GeheimWert);
    expect((await versuche({ bemerkung: "x", menue: "ALLES" })).status).toBe(
      400,
    );
  });

  test("Text über 500 Zeichen und mit Steuerzeichen", async () => {
    const lang = await versuche({ bemerkung: "x".repeat(501) });
    expect(lang.status).toBe(400);
    expect(codes(lang.body)).toEqual(["bemerkung:ZU_LANG"]);
    expect(lang.text).not.toContain("xxxxx");
    expect((await versuche({ bemerkung: "x".repeat(500) })).status).toBe(200);
    for (const wert of [
      "zwei\nZeilen",
      "tab\tulator",
      "nul\u0000byte",
      "esc\u001b[0m",
      "del\u007f",
      "getrennt zeile",
      "bidi‮umkehr",
    ]) {
      const r = await versuche({ bemerkung: wert });
      expect(r.status).toBe(400);
      expect(codes(r.body)).toEqual(["bemerkung:STEUERZEICHEN"]);
    }
  });

  test("Umlaute, Emoji und Auswahl werden gespeichert, optionale leere Antworten fehlen", async () => {
    const r = await versuche({
      bemerkung: "Grüezi, ä ö ü – ok 🙂",
      mitfahrt: true,
      menue: "",
    });
    expect(r.status).toBe(200);
    expect(r.body.antworten).toEqual({
      bemerkung: "Grüezi, ä ö ü – ok 🙂",
      mitfahrt: true,
    });
  });

  test("schon mit mehreren Fehlern zugleich: alle Schlüssel, nie Werte", async () => {
    const r = await versuche({ mitfahrt: "ja", gibtsnicht: 1 });
    expect(codes(r.body)).toEqual([
      "bemerkung:PFLICHT",
      "gibtsnicht:UNBEKANNT",
      "mitfahrt:TYP",
    ]);
  });

  test("Schlüssel wie constructor und __proto__ sind gewöhnliche Felder", async () => {
    const a = await neuerAnlass({
      felder: [{ schluessel: "constructor" }, { schluessel: "__proto__" }],
    });
    const leer = await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten: {},
    });
    expect(leer.status).toBe(200);
    const antwort = await app.request(`/api/v1/anlaesse/${a.id}/anmeldung`, {
      method: "PUT",
      headers: {
        ...konten[KONTO_FUER.elternA].headers,
        "content-type": "application/json",
      },
      body: `{"kindId":"${welt.kindAId}","antworten":{"constructor":"a","__proto__":"b"}}`,
    });
    expect(antwort.status).toBe(200);
    const zeilen = await anmeldungen(a.id);
    expect(Object.entries(zeilen[0].antworten).sort()).toEqual([
      ["__proto__", "b"],
      ["constructor", "a"],
    ]);
  });

  test("falsche Form der Anfrage ist 400: keine antworten, kein Objekt, zu viele Schlüssel, fremde Felder", async () => {
    const a = await neuerAnlass();
    const roh = (body: unknown) =>
      anfrage("elternA", "PUT", `/api/v1/anlaesse/${a.id}/anmeldung`, body);
    expect((await roh({ kindId: welt.kindAId })).status).toBe(400);
    expect((await roh({ kindId: welt.kindAId, antworten: [] })).status).toBe(
      400,
    );
    expect((await roh({ kindId: welt.kindAId, antworten: "x" })).status).toBe(
      400,
    );
    expect(
      (
        await roh({
          kindId: welt.kindAId,
          antworten: Object.fromEntries(
            Array.from({ length: 21 }, (_, i) => [`k${i}`, "x"]),
          ),
        })
      ).status,
    ).toBe(400);
    expect(
      (await roh({ kindId: welt.kindAId, antworten: {}, status: "x" })).status,
    ).toBe(400);
    expect((await roh({ kindId: "x", antworten: {} })).status).toBe(400);
    expect(await anmeldungen(a.id)).toHaveLength(0);
  });
});

describe("Abmelden", () => {
  test("Abmelden setzt den Status und löscht die Antworten, die Zeile bleibt", async () => {
    const a = await neuerAnlass();
    const angemeldet: Json = await (
      await melde("elternA", a.id, {
        kindId: welt.kindAId,
        antworten: { bemerkung: "persönlich" },
      })
    ).json();
    const antwort = await abmelden("elternA", a.id, welt.kindAId);
    expect(antwort.status).toBe(204);
    expect(await antwort.text()).toBe("");
    const zeilen = await anmeldungen(a.id);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      id: angemeldet.id,
      status: "abgemeldet",
      antworten: {},
    });
    const vorlage: Json = await (await lies("elternA", a.id)).json();
    expect(vorlage.teilnehmende[0].anmeldung).toMatchObject({
      status: "abgemeldet",
      antworten: {},
    });
  });

  test("zweites Abmelden und Abmelden ohne Anmeldung ergeben dasselbe 204 und nur einen Audit-Eintrag", async () => {
    const a = await neuerAnlass();
    expect((await abmelden("elternA", a.id, welt.kindAId)).status).toBe(204);
    expect(await anmeldungen(a.id)).toHaveLength(0);
    const angemeldet: Json = await (
      await melde("elternA", a.id, { kindId: welt.kindAId, antworten: {} })
    ).json();
    expect((await abmelden("elternA", a.id, welt.kindAId)).status).toBe(204);
    expect((await abmelden("elternA", a.id, welt.kindAId)).status).toBe(204);
    expect(await audit("anlass_abgemeldet", angemeldet.id)).toHaveLength(1);
  });

  test("wer sich abgemeldet hat, meldet sich mit demselben PUT wieder an (gleiche ID)", async () => {
    const a = await neuerAnlass({ fuer: "person" });
    const erste: Json = await (
      await melde("leitungA", a.id, { antworten: { bemerkung: "eins" } })
    ).json();
    expect((await abmelden("leitungA", a.id)).status).toBe(204);
    const zweite: Json = await (
      await melde("leitungA", a.id, { antworten: { bemerkung: "zwei" } })
    ).json();
    expect(zweite).toMatchObject({
      id: erste.id,
      status: "angemeldet",
      antworten: { bemerkung: "zwei" },
    });
    expect(await anmeldungen(a.id)).toHaveLength(1);
  });

  test("eine Person meldet nur sich selbst ab, nicht andere", async () => {
    const a = await neuerAnlass({ fuer: "person" });
    await melde("leitungA", a.id, { antworten: {} });
    await melde("leitungB", a.id, { antworten: {} });
    expect((await abmelden("leitungA", a.id)).status).toBe(204);
    const zeilen = await anmeldungen(a.id);
    const status = Object.fromEntries(zeilen.map((z) => [z.userId, z.status]));
    expect(status[id("leitungA")]).toBe("abgemeldet");
    expect(status[id("leitungB")]).toBe("angemeldet");
  });
});

describe("Audit und Datenschutz", () => {
  test("das Audit nennt die Anmeldung, nie Antworten, Namen oder Titel", async () => {
    const a = await neuerAnlass();
    const geheim = "GEHEIMTEXT-98765";
    const b: Json = await (
      await melde("elternA", a.id, {
        kindId: welt.kindAId,
        antworten: { bemerkung: geheim },
      })
    ).json();
    await abmelden("elternA", a.id, welt.kindAId);
    const [an] = await audit("anlass_angemeldet", b.id);
    const [ab] = await audit("anlass_abgemeldet", b.id);
    for (const e of [an, ab]) {
      expect(e).toMatchObject({
        abteilungId: welt.testabteilungId,
        akteurId: id("elternA"),
        zielTyp: "anlass_anmeldung",
        details: { anlassId: a.id, kind: true },
      });
      expect(JSON.stringify(e)).not.toContain(geheim);
    }
    // Auch im Log der Anfragen stehen keine Antworten
    expect(JSON.stringify(ausgabe.mock.calls)).not.toContain(geheim);
  });

  test("ein Konto löschen nimmt seine Anmeldungen mit (CASCADE), ein Kind löschen die seinen", async () => {
    const a = await neuerAnlass();
    const [k] = await db
      .insert(schema.kind)
      .values({
        abteilungId: welt.testabteilungId,
        vorname: "Löschkind",
        nachname: "Test",
        stufeId: welt.stufeAId,
      })
      .returning({ id: schema.kind.id });
    await db
      .insert(schema.kindEltern)
      .values({ kindId: k.id, userId: id("elternA") });
    await melde("elternA", a.id, { kindId: k.id, antworten: {} });
    await melde("elternA", a.id, { kindId: welt.kindAId, antworten: {} });
    expect(await anmeldungen(a.id)).toHaveLength(2);
    await db.delete(schema.kind).where(eq(schema.kind.id, k.id));
    expect(await anmeldungen(a.id)).toHaveLength(1);
  });

  test("Ratenbegrenzung je Person: nach 30 Anfragen in der Minute 429", async () => {
    // Eigene Person (eigene Zählung): die Leitung B
    const a = await neuerAnlass({ fuer: "person" });
    let letzter = 0;
    for (let i = 0; i < ANFRAGEN_PRO_MINUTE + 1; i++) {
      letzter = (await melde("leitungB", a.id, { antworten: {} })).status;
    }
    expect(letzter).toBe(429);
    // Lesen zählt nicht, andere Personen nicht betroffen
    expect((await lies("leitungB", a.id)).status).toBe(200);
    expect((await melde("leitungA", a.id, { antworten: {} })).status).toBe(200);
  });
});

describe("Verwaltung der Anlässe kennt die Anmeldungen (Rümpfe aus #442)", () => {
  test("zaehleAnmeldungen zählt alle, auch abgemeldete; schluesselMitAntworten nur die Schlüssel mit Antworten", async () => {
    const a = await neuerAnlass({
      felder: [{ schluessel: "eins" }, { schluessel: "zwei" }],
    });
    const leer = await neuerAnlass();
    expect(await zaehleAnmeldungen(db, a.id)).toBe(0);
    expect(await schluesselMitAntworten(db, a.id)).toEqual(new Set());
    await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten: { eins: "x" },
    });
    expect(await zaehleAnmeldungen(db, a.id)).toBe(1);
    expect(await schluesselMitAntworten(db, a.id)).toEqual(new Set(["eins"]));
    await melde("elternB", a.id, {
      kindId: welt.kindBId,
      antworten: { eins: "y", zwei: "z" },
    });
    expect(await schluesselMitAntworten(db, a.id)).toEqual(
      new Set(["eins", "zwei"]),
    );
    // Abmelden löscht die Antworten, die Zeile zählt weiter
    await abmelden("elternB", a.id, welt.kindBId);
    expect(await zaehleAnmeldungen(db, a.id)).toBe(2);
    expect(await schluesselMitAntworten(db, a.id)).toEqual(new Set(["eins"]));
    expect(await zaehleAnmeldungen(db, leer.id)).toBe(0);
  });

  test("mit Anmeldungen: Löschen, «anmeldungFuer» ändern und Felder festhalten sind 409", async () => {
    const a = await neuerAnlass({
      felder: [{ schluessel: "eins" }, { schluessel: "zwei" }],
    });
    await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten: { eins: "x" },
    });
    const admin = (
      methode: "PATCH" | "PUT" | "DELETE",
      pfad: string,
      body?: unknown,
    ) =>
      app.request(`/api/v1/admin/anlaesse/${a.id}${pfad}`, {
        method: methode,
        headers:
          body === undefined
            ? konten.admin.headers
            : { ...konten.admin.headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const loeschen = await admin("DELETE", "");
    expect(loeschen.status).toBe(409);
    expect(await loeschen.json()).toMatchObject({
      code: "ANMELDUNGEN_VORHANDEN",
    });
    const aendern = await admin("PATCH", "", { anmeldungFuer: "person" });
    expect(aendern.status).toBe(409);
    expect(await aendern.json()).toMatchObject({
      code: "ANMELDUNGEN_VORHANDEN",
    });
    // Das Feld mit Antworten behält Schlüssel und Typ, das ohne Antworten darf sich ändern
    const typ = await admin("PUT", "/felder", {
      felder: [
        {
          schluessel: "eins",
          beschriftung: "eins",
          typ: "ja_nein",
          pflicht: false,
        },
        {
          schluessel: "zwei",
          beschriftung: "zwei",
          typ: "text",
          pflicht: false,
        },
      ],
    });
    expect(typ.status).toBe(409);
    expect(await typ.json()).toMatchObject({
      code: "FELD_IN_BENUTZUNG",
      schluessel: ["eins"],
    });
    const ok = await admin("PUT", "/felder", {
      felder: [
        {
          schluessel: "eins",
          beschriftung: "Eins neu",
          typ: "text",
          pflicht: true,
        },
      ],
    });
    expect(ok.status).toBe(200);
    // Ohne Anmeldungen geht alles
    const frei = await neuerAnlass();
    const weg = await app.request(`/api/v1/admin/anlaesse/${frei.id}`, {
      method: "DELETE",
      headers: konten.admin.headers,
    });
    expect(weg.status).toBe(204);
  });

  test("ändert die Leitung die Felder, gilt für die nächste Anmeldung die neue Definition", async () => {
    const a = await neuerAnlass({ felder: [{ schluessel: "alt" }] });
    await db.insert(schema.anlassFeld).values({
      anlassId: a.id,
      schluessel: "neu",
      beschriftung: "Neu",
      typ: "text",
      pflicht: true,
      reihenfolge: 1,
    });
    const ohne = await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten: { alt: "x" },
    });
    expect(ohne.status).toBe(400);
    const mit = await melde("elternA", a.id, {
      kindId: welt.kindAId,
      antworten: { alt: "x", neu: "y" },
    });
    expect(mit.status).toBe(200);
  });
});

describe("Löschlauf: 180 Tage nach dem Ende des Anlasses", () => {
  const JETZT = new Date("2027-06-01T12:00:00Z");
  const mitAnmeldung = async (spez: AnlassSpez) => {
    const a = await neuerAnlass(spez);
    await db.insert(schema.anlassAnmeldung).values([
      {
        anlassId: a.id,
        userId: id("elternA"),
        kindId: welt.kindAId,
        antworten: { bemerkung: "persönlich" },
        status: "angemeldet",
      },
      {
        anlassId: a.id,
        userId: id("elternB"),
        kindId: welt.kindBId,
        status: "abgemeldet",
      },
    ]);
    return a;
  };

  test("löscht nur Anmeldungen alter Anlässe, mit einem Audit-Eintrag je Anlass und nur der Anzahl", async () => {
    expect(AUFBEWAHRUNG_TAGE).toBe(180);
    // 30.11.2026 + 180 Tage = 29.5.2027: vor dem Stichtag
    const alt = await mitAnmeldung({
      beginn: new Date("2026-11-30T10:00:00Z"),
      ende: new Date("2026-11-30T12:00:00Z"),
    });
    // Ende 15.1.2027 + 180 Tage = 14.7.2027: noch in der Frist
    const jung = await mitAnmeldung({
      beginn: new Date("2027-01-15T10:00:00Z"),
      ende: new Date("2027-01-15T12:00:00Z"),
    });
    const lager = await mitAnmeldung({
      art: "lager",
      beginn: new Date("2026-01-15T10:00:00Z"),
      ende: new Date("2026-01-15T12:00:00Z"),
    });
    const ohneAnmeldung = await neuerAnlass({
      beginn: new Date("2026-01-15T10:00:00Z"),
      ende: new Date("2026-01-15T12:00:00Z"),
    });
    const n = await loescheAlteAnmeldungen(db, JETZT, [
      alt.id,
      jung.id,
      lager.id,
      ohneAnmeldung.id,
    ]);
    expect(n).toBe(2);
    expect(await anmeldungen(alt.id)).toHaveLength(0);
    expect(await anmeldungen(jung.id)).toHaveLength(2);
    // Anlässe der Art «lager» bleiben dem Lager-Modul
    expect(await anmeldungen(lager.id)).toHaveLength(2);
    // Der Anlass selbst bleibt
    const [anlassZeile] = await db
      .select({ id: schema.anlass.id })
      .from(schema.anlass)
      .where(eq(schema.anlass.id, alt.id));
    expect(anlassZeile).toBeDefined();
    const eintraege = await audit("anlass_anmeldungen_geloescht", alt.id);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]).toMatchObject({
      akteurId: "system",
      zielTyp: "anlass",
      details: { anzahl: 2 },
    });
    expect(await audit("anlass_anmeldungen_geloescht", jung.id)).toHaveLength(
      0,
    );
    // Wiederholung: nichts mehr zu löschen, kein zweiter Eintrag
    expect(await loescheAlteAnmeldungen(db, JETZT, [alt.id])).toBe(0);
    expect(await audit("anlass_anmeldungen_geloescht", alt.id)).toHaveLength(1);
  });

  test("ganztägige Anlässe enden mit dem letzten Tag; die Grenze liegt bei genau 180 Tagen", async () => {
    // tag_bis 2026-12-01: Ende ist 2. Dezember 00:00 Zürcher Zeit (1. Dezember 23:00 UTC); +180 Tage = 30.5.2027 23:00 UTC
    const davor = await mitAnmeldung({});
    await db
      .update(schema.programm)
      .set({
        ganztaegig: true,
        beginn: null,
        ende: null,
        tagVon: "2026-12-01",
        tagBis: "2026-12-01",
      })
      .where(eq(schema.programm.id, davor.programmId));
    const danach = await mitAnmeldung({});
    await db
      .update(schema.programm)
      .set({
        ganztaegig: true,
        beginn: null,
        ende: null,
        tagVon: "2026-12-05",
        tagBis: "2026-12-05",
      })
      .where(eq(schema.programm.id, danach.programmId));
    const n = await loescheAlteAnmeldungen(db, JETZT, [davor.id, danach.id]);
    expect(n).toBe(2);
    expect(await anmeldungen(davor.id)).toHaveLength(0);
    expect(await anmeldungen(danach.id)).toHaveLength(2);
  });

  test("der Lauf ohne Einschränkung funktioniert (eine Abfrage) und lässt junge Anmeldungen stehen", async () => {
    const jung = await mitAnmeldung({});
    await loescheAlteAnmeldungen(db, JETZT);
    expect(await anmeldungen(jung.id)).toHaveLength(2);
  });
});

describe("Mein Kalender nennt den Anlass", () => {
  const FENSTER = "von=2027-03-01&bis=2027-03-07";
  const liste = async (p: TerminePersona) =>
    (await (
      await anfrage(p, "GET", `/api/v1/termine/mein?${FENSTER}`)
    ).json()) as Json;
  const eintrag = (l: Json, programmId: string) =>
    l.termine.find((t: Json) => t.id === programmId);

  test("anlass hat id, anmeldeschluss, anmeldungOffen und angemeldet; ohne Anlass null", async () => {
    const frist = new Date(Date.now() + 86_400_000);
    const a = await neuerAnlass({
      frist,
      terminTags: [welt.stufeAId],
    });
    const ohne = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
    });
    await db
      .insert(schema.programmTag)
      .values({ programmId: ohne.id, tagId: welt.stufeAId });
    const vorher = await liste("elternA");
    expect(eintrag(vorher, a.programmId).anlass).toEqual({
      id: a.id,
      anmeldeschluss: frist.toISOString(),
      anmeldungOffen: true,
      angemeldet: false,
    });
    expect(eintrag(vorher, ohne.id).anlass).toBeNull();
    await melde("elternA", a.id, { kindId: welt.kindAId, antworten: {} });
    const nachher = await liste("elternA");
    expect(eintrag(nachher, a.programmId).anlass.angemeldet).toBe(true);
    // Eine andere Person derselben Stufe sieht den Termin, ist aber nicht angemeldet
    const leitung = await liste("leitungA");
    expect(eintrag(leitung, a.programmId).anlass.angemeldet).toBe(false);
    await abmelden("elternA", a.id, welt.kindAId);
    expect(
      eintrag(await liste("elternA"), a.programmId).anlass.angemeldet,
    ).toBe(false);
    // Auch das Detail trägt den Anlass
    const detail: Json = await (
      await anfrage("elternA", "GET", `/api/v1/termine/${a.programmId}`)
    ).json();
    expect(detail.anlass).toMatchObject({ id: a.id, angemeldet: false });
  });

  test("ein Anlass, den die Person nicht sehen darf, erscheint als null", async () => {
    const a = await neuerAnlass({
      sichtbarkeit: "tags",
      tags: [welt.stufeBId],
      terminTags: [welt.stufeAId],
    });
    const l = await liste("elternA");
    expect(eintrag(l, a.programmId)).toBeDefined();
    expect(eintrag(l, a.programmId).anlass).toBeNull();
  });

  test("der Anlass einer Person-Anmeldung zählt als angemeldet für die Person selbst", async () => {
    const a = await neuerAnlass({
      fuer: "person",
      terminTags: [welt.stufeAId],
    });
    await melde("leitungA", a.id, { antworten: {} });
    expect(
      eintrag(await liste("leitungA"), a.programmId).anlass.angemeldet,
    ).toBe(true);
    expect(
      eintrag(await liste("elternA"), a.programmId).anlass.angemeldet,
    ).toBe(false);
  });
});

describe("Abfragen je Aufruf", () => {
  test("GET zwei Abfragen, unabhängig von der Zahl der Kinder; PUT eine Transaktion ohne Schleife", async () => {
    const abfragen: string[] = [];
    const zaehlend = drizzle(sql, {
      schema,
      logger: { logQuery: (q) => abfragen.push(q) },
    }) as unknown as Db;
    const zaehlApp = erstelleApp({ ...optionen, db: zaehlend });
    const betrifft = (q: string) => /anlass|"kind"|"user"/.test(q);
    const a = await neuerAnlass();
    const mit = async (
      methode: "GET" | "PUT" | "DELETE",
      pfad: string,
      body?: unknown,
      persona: TerminePersona = "elternA",
    ) => {
      abfragen.length = 0;
      const konto = konten[KONTO_FUER[persona]];
      const antwort = await zaehlApp.request(pfad, {
        method: methode,
        headers:
          body === undefined
            ? konto.headers
            : { ...konto.headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { antwort, n: abfragen.filter(betrifft).length };
    };
    const get = `/api/v1/anlaesse/${a.id}`;
    const eins = await mit("GET", get);
    expect(eins.antwort.status).toBe(200);
    expect(eins.n).toBeLessThanOrEqual(4);
    // Zwei weitere Kinder derselben Eltern ändern die Zahl der Abfragen nicht
    for (const name of ["Zwei", "Drei"]) {
      const [k] = await db
        .insert(schema.kind)
        .values({
          abteilungId: welt.testabteilungId,
          vorname: name,
          nachname: "Mehr",
          stufeId: welt.stufeAId,
        })
        .returning({ id: schema.kind.id });
      await db
        .insert(schema.kindEltern)
        .values({ kindId: k.id, userId: id("elternA") });
    }
    const drei = await mit("GET", get);
    expect(((await drei.antwort.json()) as Json).teilnehmende).toHaveLength(3);
    expect(drei.n).toBe(eins.n);
    const put = await mit("PUT", `${get}/anmeldung`, {
      kindId: welt.kindAId,
      antworten: {},
    });
    expect(put.antwort.status).toBe(200);
    expect(put.n).toBeLessThanOrEqual(4);
    const del = await mit("DELETE", `${get}/anmeldung?kindId=${welt.kindAId}`);
    expect(del.antwort.status).toBe(204);
    expect(del.n).toBeLessThanOrEqual(4);
  });
});
