import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { pgSchema, text } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
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
import { z } from "zod";
import { erstelleApp } from "../../src/app.js";
import { erstelleDb } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { lagerSpalten } from "../../src/db/schema-lager.js";
import { ereignisverteiler } from "../../src/lager/ereignisse.js";
import { registriereOperation } from "../../src/lager/operationen.js";
import { raeumeAenderungenAuf } from "../../src/lager/aufraeumen.js";
import { aendereZeile, legeZeileAn } from "../../src/lager/sync.js";
import { registriereLagerTabelle } from "../../src/lager/tabellen.js";
import {
  ANFRAGEN_PRO_MINUTE,
  MAX_OPERATIONEN,
} from "../../src/routes/lager/warteschlange.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL, BESITZER_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "../hilfen/personas.js";
import { leseStrom } from "./sse.js";

bereiteAuthTestsVor();

// Die Warteschlange (#367) gegen die ganze App. Eine Tabelle nur dieses Tests (Schema lager_warteschlange_test) und fünf Operationen, wie ein Modul sie anmeldet
const sql_ = postgres(API_URL);
const besitzer = postgres(BESITZER_URL, { max: 1, onnotice: () => {} });
const db = erstelleDb(sql_);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql: sql_,
  db,
  auth,
  seiten: ladeSeiten(),
});
const SCHEMA = "lager_warteschlange_test";
afterAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.end();
  await sql_.end();
});

const testSchema = pgSchema(SCHEMA);
const objekt = testSchema.table("objekt", {
  ...lagerSpalten(),
  titel: text("titel").notNull(),
  // Nur die Lagerleitung sieht dieses Feld
  geheim: text("geheim"),
});

let welt: Welt;
let lagerleitung: PersonaKonto;
let leitung: PersonaKonto;
let team: PersonaKonto;
let lesen: PersonaKonto;
let ohneMitgliedschaft: PersonaKonto;
let fremd: PersonaKonto;
let ohneLogin: PersonaKonto;
let lagerId: string;
let geschlossenId: string;

const ansicht = (rolle: string) => (z: typeof objekt.$inferSelect) => ({
  id: z.id,
  titel: z.titel,
  version: z.version,
  ...(rolle === "lagerleitung" ? { geheim: z.geheim } : {}),
});

beforeAll(async () => {
  await besitzer.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await besitzer.unsafe(`create schema ${SCHEMA}`);
  await besitzer.unsafe(`
    create table ${SCHEMA}.objekt (
      id uuid primary key default uuidv7(),
      lager_id uuid not null references public.lager(id) on delete cascade,
      version integer not null default 1,
      erstellt_am timestamptz not null default now(),
      erstellt_von uuid,
      geaendert_am timestamptz not null default now(),
      geaendert_von uuid,
      geloescht_am timestamptz,
      geloescht_von uuid,
      lager_seq bigint not null,
      titel text not null,
      geheim text
    )`);
  await besitzer.unsafe(
    `grant usage on schema ${SCHEMA} to cevi_os_api; grant select, insert, update, delete on all tables in schema ${SCHEMA} to cevi_os_api`,
  );
  registriereLagerTabelle({ tabelle: objekt, recht: "aufgaben.lesen_alle" });

  registriereOperation({
    typ: "test.anlegen",
    recht: "aufgaben.bearbeiten",
    schema: z.strictObject({
      titel: z.string().min(1).max(50),
      geheim: z.string().optional(),
    }),
    fuehreAus: async ({ tx, zugriff, person }, n) => {
      const zeile = await legeZeileAn(
        tx,
        objekt,
        { lagerId: zugriff.lager.id, personId: person.id },
        n,
      );
      return { id: zeile.id, version: zeile.version };
    },
  });
  registriereOperation({
    typ: "test.aendern",
    recht: "aufgaben.bearbeiten",
    schema: z.strictObject({
      id: z.uuid(),
      version: z.number().int(),
      titel: z.string().min(1).max(50),
    }),
    fuehreAus: async ({ tx, zugriff, person }, n) => {
      const zeile = await aendereZeile(
        tx,
        objekt,
        { lagerId: zugriff.lager.id, personId: person.id },
        {
          id: n.id,
          version: n.version,
          werte: { titel: n.titel },
          ansicht: ansicht(zugriff.rolle),
        },
      );
      return { id: zeile.id, version: zeile.version };
    },
  });
  // Schreibt und scheitert dann: Die Zeile darf nicht bleiben
  registriereOperation({
    typ: "test.schreibt_und_scheitert",
    recht: "aufgaben.bearbeiten",
    schema: z.strictObject({}),
    fuehreAus: async ({ tx, zugriff, person }) => {
      await legeZeileAn(
        tx,
        objekt,
        { lagerId: zugriff.lager.id, personId: person.id },
        { titel: "bleibt nicht" },
      );
      throw new HTTPException(404);
    },
  });
  registriereOperation({
    typ: "test.stuerzt_ab",
    recht: "aufgaben.bearbeiten",
    schema: z.strictObject({}),
    fuehreAus: async () => {
      throw new Error("Absturz");
    },
  });

  welt = await erstelleWelt(db, auth);
  [lagerleitung, team, lesen, ohneMitgliedschaft, fremd] = await Promise.all(
    (["slA", "leitendeA", "leitendeB", "elternA", "demoEltern"] as const).map(
      (p) => legePersonaAn(welt, p),
    ),
  );
  ohneLogin = await legePersonaAn(welt, "ohneLogin");
  const legeLager = async (status: "aktiv" | "abgeschlossen") => {
    const [zeile] = await db
      .insert(schema.lager)
      .values({
        abteilungId: welt.testabteilungId,
        titel: "Warteschlangenlager",
        von: "2027-07-10",
        bis: "2027-07-24",
        status,
      })
      .returning({ id: schema.lager.id });
    for (const [konto, rolle] of [
      [lagerleitung, "lagerleitung"],
      [team, "team"],
      [lesen, "lesen"],
    ] as const) {
      await db
        .insert(schema.lagerMitglied)
        .values({ lagerId: zeile.id, personId: konto.id!, rolle });
    }
    return zeile.id;
  };
  lagerId = await legeLager("aktiv");
  geschlossenId = await legeLager("abgeschlossen");
});

async function neueLeitung() {
  const person = await legePersonaAn(welt, "slB");
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId, personId: person.id!, rolle: "leitung" });
  return person;
}

let ausgabe: MockInstance<typeof console.log>;
beforeEach(async () => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
  // Je Test eine frische Leitung: Die Route begrenzt die Anfragen je Konto, und diese Datei schickt mehr, als ein Konto in einer Minute darf
  leitung = await neueLeitung();
});
afterEach(() => {
  ereignisverteiler.schliesseAlle();
  ausgabe.mockRestore();
});

type Op = {
  clientOpId: string;
  typ: string;
  nutzlast: Record<string, unknown>;
};
const op = (typ: string, nutzlast: Record<string, unknown> = {}): Op => ({
  clientOpId: randomUUID(),
  typ,
  nutzlast,
});
const anlegen = (titel = "Neu") => op("test.anlegen", { titel });
type Ergebnis = {
  clientOpId: string;
  status: string;
  code?: string;
  ergebnis?: { id: string; version: number };
  aktuell?: Record<string, unknown>;
  abweichend?: string[];
};
const sende = (
  konto: PersonaKonto,
  operationen: unknown,
  id = lagerId,
  body: unknown = { operationen },
) =>
  app.request(`/api/v1/lager/${id}/aenderungen`, {
    method: "POST",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function schicke(konto: PersonaKonto, operationen: Op[], id = lagerId) {
  const antwort = await sende(konto, operationen, id);
  expect(antwort.status).toBe(200);
  return ((await antwort.json()) as { ergebnisse: Ergebnis[] }).ergebnisse;
}
const zeilen = (id = lagerId) =>
  db.select().from(objekt).where(eq(objekt.lagerId, id));
const lagerSeq = async (id = lagerId) =>
  (
    await db
      .select({ seq: schema.lager.seq })
      .from(schema.lager)
      .where(eq(schema.lager.id, id))
  )[0]!.seq;
const gespeichert = async (id = lagerId) =>
  (
    await db
      .select({ n: count() })
      .from(schema.lagerClientOp)
      .where(eq(schema.lagerClientOp.lagerId, id))
  )[0]!.n;

describe("POST /api/v1/lager/{id}/aenderungen: Ausführung", () => {
  test("führt die Operationen der Reihe nach aus, ein Ergebnis je clientOpId", async () => {
    const vorher = await lagerSeq();
    const ops = [anlegen("Eins"), anlegen("Zwei"), anlegen("Drei")];
    const ergebnisse = await schicke(leitung, ops);
    expect(ergebnisse.map((e) => e.clientOpId)).toEqual(
      ops.map((o) => o.clientOpId),
    );
    expect(ergebnisse.map((e) => e.status)).toEqual(["ok", "ok", "ok"]);
    expect(ergebnisse.every((e) => e.ergebnis?.version === 1)).toBe(true);
    const titel = (await zeilen()).map((z) => z.titel);
    expect(titel).toEqual(expect.arrayContaining(["Eins", "Zwei", "Drei"]));
    // Jede Operation ist ein Schreibvorgang mit eigener Folgenummer
    expect(await lagerSeq()).toBe(vorher + 3);
    expect(await gespeichert()).toBeGreaterThanOrEqual(3);
  });

  test("das Ergebnis trägt IDs und Versionen, keine Inhalte", async () => {
    const [e] = await schicke(lagerleitung, [
      op("test.anlegen", { titel: "Geheimer Titel", geheim: "Geheimnis" }),
    ]);
    expect(Object.keys(e.ergebnis!).sort()).toEqual(["id", "version"]);
    const [roh] = await db
      .select()
      .from(schema.lagerClientOp)
      .where(eq(schema.lagerClientOp.clientOpId, e.clientOpId));
    expect(JSON.stringify(roh.ergebnis)).not.toMatch(/Geheim/);
  });

  test("ein Schreibvorgang der Warteschlange erreicht die offenen Ansichten", async () => {
    const strom = leseStrom(
      await app.request(`/api/v1/lager/${lagerId}/ereignisse`, {
        headers: lagerleitung.headers,
      }),
    );
    expect(await strom.naechster()).toMatchObject({ event: "bereit" });
    await schicke(leitung, [anlegen()]);
    expect(await strom.naechstesEreignis()).toMatchObject({
      event: "aenderung",
      data: { bis: await lagerSeq(), objekttypen: ["objekt"] },
    });
    await strom.schliesse();
  });
});

describe("Idempotenz", () => {
  test("dieselbe clientOpId liefert das gespeicherte Ergebnis und schreibt nichts noch einmal", async () => {
    const ops = [anlegen("Einmal"), anlegen("Auch einmal")];
    const erste = await schicke(leitung, ops);
    const seq = await lagerSeq();
    const anzahl = (await zeilen()).length;
    const zweite = await schicke(leitung, ops);
    expect(zweite).toEqual(erste);
    expect(await lagerSeq()).toBe(seq);
    expect((await zeilen()).length).toBe(anzahl);
    // Auch gemischt: eine bekannte und eine neue
    const gemischt = await schicke(leitung, [ops[0], anlegen("Neu dazu")]);
    expect(gemischt[0]).toEqual(erste[0]);
    expect(gemischt[1].status).toBe("ok");
    expect(await lagerSeq()).toBe(seq + 1);
  });

  test("dieselbe clientOpId zweimal in einer Anfrage schreibt einmal", async () => {
    const o = anlegen("Doppelt");
    const seq = await lagerSeq();
    const [a, b] = await schicke(leitung, [o, o]);
    expect(b).toEqual(a);
    expect(await lagerSeq()).toBe(seq + 1);
  });

  test("gleichzeitige Wiederholungen schreiben genau einmal", async () => {
    const o = anlegen("Gleichzeitig");
    const seq = await lagerSeq();
    const antworten = await Promise.all(
      Array.from({ length: 5 }, () => schicke(leitung, [o])),
    );
    expect(new Set(antworten.map((a) => a[0].ergebnis!.id)).size).toBe(1);
    expect(antworten.every((a) => a[0].status === "ok")).toBe(true);
    expect(await lagerSeq()).toBe(seq + 1);
    expect(
      (await zeilen()).filter((z) => z.titel === "Gleichzeitig"),
    ).toHaveLength(1);
  });

  test("die clientOpId gilt je Person: Eine andere Person mit derselben ID schreibt selbst", async () => {
    const o = anlegen("Je Person");
    const [a] = await schicke(leitung, [o]);
    const [b] = await schicke(lagerleitung, [o]);
    expect(b.ergebnis!.id).not.toBe(a.ergebnis!.id);
  });

  test("das gespeicherte Ergebnis gilt auch, wenn das Recht inzwischen fehlt", async () => {
    const o = anlegen("Vor dem Entzug");
    const [a] = await schicke(leitung, [o]);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId,
      rolle: "leitung",
      recht: "aufgaben.bearbeiten",
      erlaubt: false,
    });
    try {
      // Eine neue Operation wird abgelehnt, die alte liefert ihr Ergebnis
      const [alt, neu] = await schicke(leitung, [
        o,
        anlegen("Nach dem Entzug"),
      ]);
      expect(alt).toEqual(a);
      expect(neu).toMatchObject({
        status: "abgelehnt",
        code: "KEINE_BERECHTIGUNG",
      });
    } finally {
      await db
        .delete(schema.lagerRolleRecht)
        .where(eq(schema.lagerRolleRecht.lagerId, lagerId));
    }
  });

  test("Ergebnisse älter als 30 Tage räumt der tägliche Lauf auf", async () => {
    const [e] = await schicke(leitung, [anlegen("Alt")]);
    await db.execute(
      sql`update lager_client_op set erstellt_am = now() - interval '31 days' where client_op_id = ${e.clientOpId}`,
    );
    const [frisch] = await schicke(leitung, [anlegen("Frisch")]);
    await raeumeAenderungenAuf(db);
    const rest = await db
      .select({ id: schema.lagerClientOp.clientOpId })
      .from(schema.lagerClientOp)
      .where(eq(schema.lagerClientOp.lagerId, lagerId));
    expect(rest.map((r) => r.id)).toContain(frisch.clientOpId);
    expect(rest.map((r) => r.id)).not.toContain(e.clientOpId);
  });
});

describe("Teilablehnung", () => {
  test("eine Ablehnung bricht die anderen nicht ab", async () => {
    const seq = await lagerSeq();
    const ergebnisse = await schicke(leitung, [
      anlegen("Vorher"),
      op("test.gibt_es_nicht"),
      op("test.anlegen", { titel: "" }),
      op("test.anlegen", { titel: "x", unbekannt: 1 }),
      op("test.schreibt_und_scheitert"),
      anlegen("Nachher"),
    ]);
    expect(ergebnisse.map((e) => [e.status, e.code])).toEqual([
      ["ok", undefined],
      ["abgelehnt", "OPERATION_UNBEKANNT"],
      ["abgelehnt", "UNGUELTIGE_EINGABE"],
      ["abgelehnt", "UNGUELTIGE_EINGABE"],
      ["abgelehnt", "NICHT_GEFUNDEN"],
      ["ok", undefined],
    ]);
    // Nur die zwei erfolgreichen haben geschrieben; die Operation, die erst schrieb und dann scheiterte, hat nichts hinterlassen
    expect(await lagerSeq()).toBe(seq + 2);
    expect((await zeilen()).map((z) => z.titel)).not.toContain("bleibt nicht");
  });

  test("das Recht der Operation gilt je Rolle, nicht eines der Route", async () => {
    for (const konto of [team, lesen]) {
      const [e] = await schicke(konto, [anlegen("Nicht erlaubt")]);
      expect(e).toMatchObject({
        status: "abgelehnt",
        code: "KEINE_BERECHTIGUNG",
      });
    }
    expect((await zeilen()).map((z) => z.titel)).not.toContain("Nicht erlaubt");
    const [ok] = await schicke(lagerleitung, [anlegen("Erlaubt")]);
    expect(ok.status).toBe("ok");
  });

  test("ein Absturz im Server lässt die Anfrage scheitern, erledigte Operationen bleiben gespeichert", async () => {
    const erste = anlegen("Erledigt");
    const antwort = await sende(leitung, [erste, op("test.stuerzt_ab")]);
    expect(antwort.status).toBe(500);
    // Die App schickt die Anfrage wieder: Die erste Operation kommt aus dem Speicher
    const [a, b] = await schicke(leitung, [erste, anlegen("Weiter")]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect((await zeilen()).filter((z) => z.titel === "Erledigt")).toHaveLength(
      1,
    );
  });
});

describe("Versionskonflikt in der Warteschlange", () => {
  test("meldet «konflikt» mit dem Stand in der Ansicht der Rolle, die anderen laufen weiter", async () => {
    const [angelegt] = await schicke(lagerleitung, [
      op("test.anlegen", { titel: "Alt", geheim: "nur Leitung" }),
    ]);
    const id = angelegt.ergebnis!.id;
    // Jemand anderes war schneller: Version 1 -> 2
    const [erster] = await schicke(lagerleitung, [
      op("test.aendern", { id, version: 1, titel: "Von der Lagerleitung" }),
    ]);
    expect(erster.ergebnis!.version).toBe(2);

    const seq = await lagerSeq();
    const veraltet = op("test.aendern", { id, version: 1, titel: "Offline" });
    const ergebnisse = await schicke(leitung, [veraltet, anlegen("Daneben")]);
    expect(ergebnisse[0]).toMatchObject({
      clientOpId: veraltet.clientOpId,
      status: "konflikt",
      code: "VERSION_KONFLIKT",
      aktuell: { id, titel: "Von der Lagerleitung", version: 2 },
      abweichend: ["titel"],
    });
    // Ansicht der Rolle: Die Leitung sieht «geheim» nicht
    expect(ergebnisse[0].aktuell).not.toHaveProperty("geheim");
    expect(ergebnisse[1].status).toBe("ok");
    // Der Konflikt hat nichts geschrieben; nur die zweite Operation
    expect(await lagerSeq()).toBe(seq + 1);
    // Ein Konflikt wird nicht gespeichert: Die Wiederholung bewertet ihn neu und kommt zum selben Ergebnis
    const [nochmal] = await schicke(leitung, [veraltet]);
    expect(nochmal).toEqual(ergebnisse[0]);
    expect(
      (await db.select().from(objekt).where(eq(objekt.id, id)))[0]!.titel,
    ).toBe("Von der Lagerleitung");
    // Mit der aktuellen Version gelingt es
    const [gelungen] = await schicke(leitung, [
      op("test.aendern", { id, version: 2, titel: "Nach dem Abgleich" }),
    ]);
    expect(gelungen).toMatchObject({ status: "ok", ergebnis: { version: 3 } });
  });

  test("eine unbekannte oder fremde Zeile ist abgelehnt (404), kein Konflikt", async () => {
    const [e] = await schicke(leitung, [
      op("test.aendern", { id: randomUUID(), version: 1, titel: "x" }),
    ]);
    expect(e).toMatchObject({ status: "abgelehnt", code: "NICHT_GEFUNDEN" });
  });
});

describe("Eingabe und Zugriff", () => {
  test.each([
    ["keine Operationen", { operationen: [] }],
    [
      "zu viele Operationen",
      {
        operationen: Array.from({ length: MAX_OPERATIONEN + 1 }, () =>
          anlegen(),
        ),
      },
    ],
    [
      "clientOpId keine UUID",
      {
        operationen: [{ clientOpId: "x", typ: "test.anlegen", nutzlast: {} }],
      },
    ],
    [
      "Nutzlast eine Liste",
      {
        operationen: [
          { clientOpId: randomUUID(), typ: "test.anlegen", nutzlast: [] },
        ],
      },
    ],
    [
      "unbekanntes Feld an der Operation",
      {
        operationen: [{ ...anlegen(), rolle: "lagerleitung" }],
      },
    ],
    ["unbekanntes Feld an der Anfrage", { operationen: [anlegen()], x: 1 }],
    ["ohne Operationen-Feld", {}],
  ])("%s: 400", async (_name, body) => {
    expect((await sende(leitung, undefined, lagerId, body)).status).toBe(400);
  });

  test("genau 100 Operationen gehen durch", async () => {
    const ergebnisse = await schicke(
      lagerleitung,
      Array.from({ length: MAX_OPERATIONEN }, () => anlegen()),
    );
    expect(ergebnisse).toHaveLength(MAX_OPERATIONEN);
    expect(ergebnisse.every((e) => e.status === "ok")).toBe(true);
  });

  test("eine Anfrage über 256 KB ist 413", async () => {
    const gross = op("test.anlegen", { titel: "x".repeat(300 * 1024) });
    expect((await sende(lagerleitung, [gross])).status).toBe(413);
  });

  test("Nicht-Mitglied und fremde Abteilung 404, ohne Anmeldung 401, ungültige ID 400", async () => {
    for (const [konto, status] of [
      [ohneMitgliedschaft, 404],
      [fremd, 404],
      [ohneLogin, 401],
    ] as const) {
      expect((await sende(konto, [anlegen()])).status).toBe(status);
    }
    expect((await sende(leitung, [anlegen()], "keine-id")).status).toBe(400);
    expect((await sende(leitung, [anlegen()], randomUUID())).status).toBe(404);
  });

  test("ein abgeschlossenes Lager nimmt nichts an (409) und schreibt nichts", async () => {
    const antwort = await sende(
      lagerleitung,
      [anlegen("Zu spät")],
      geschlossenId,
    );
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({ code: "LAGER_GESCHLOSSEN" });
    expect(await zeilen(geschlossenId)).toHaveLength(0);
    expect(await gespeichert(geschlossenId)).toBe(0);
  });

  test("je Konto höchstens 20 Anfragen je Minute (429)", async () => {
    const person = await neueLeitung();
    for (let i = 0; i < ANFRAGEN_PRO_MINUTE; i++) {
      expect((await sende(person, [anlegen()])).status).toBe(200);
    }
    expect((await sende(person, [anlegen()])).status).toBe(429);
    // Andere Konten sind nicht betroffen
    expect((await sende(leitung, [anlegen()])).status).toBe(200);
  });

  test("Person und Rolle kommen aus der Sitzung, nie aus der Nutzlast", async () => {
    const [e] = await schicke(leitung, [
      op("test.anlegen", { titel: "x", personId: lagerleitung.id }),
    ]);
    expect(e).toMatchObject({
      status: "abgelehnt",
      code: "UNGUELTIGE_EINGABE",
    });
    const [ok] = await schicke(leitung, [anlegen("Von der Sitzung")]);
    const [zeile] = await db
      .select({ von: objekt.erstelltVon })
      .from(objekt)
      .where(eq(objekt.id, ok.ergebnis!.id));
    expect(zeile.von).toBe(leitung.id);
  });
});
