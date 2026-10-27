import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import { auditLog, programm, programmStufe } from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";

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

const ROLLEN = [
  "admin",
  "slA",
  "leitendeA",
  "elternA",
  "elternB",
  "demoAdmin",
] as const;

let welt: Welt;
let konten: Record<(typeof ROLLEN)[number], PersonaKonto>;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      ROLLEN.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<(typeof ROLLEN)[number], PersonaKonto>;
});

// Jede Anfrage schriebe sonst eine Log-Zeile in die Testausgabe
let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const put = (
  konto: PersonaKonto,
  programmId: string,
  body: Record<string, unknown>,
) =>
  app.request(`/api/v1/programme/${programmId}/zuordnung`, {
    method: "PUT",
    headers: { ...konto.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Jeder Fall bekommt sein frisches Programm der Testabteilung
const frisch = (
  sichtbarkeit: "intern" | "leitende" | "eltern",
  stufen: string[],
) =>
  legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit,
    stufen,
  });

const sortiert = (ids: string[]) => [...ids].sort();

// Sichtbarkeit, Stufen und Audit-Einträge eines Programms, wie sie in der Datenbank stehen
async function stand(programmId: string) {
  const [zeile] = await db
    .select({ sichtbarkeit: programm.sichtbarkeit })
    .from(programm)
    .where(eq(programm.id, programmId));
  const stufen = await db
    .select({ stufeId: programmStufe.stufeId })
    .from(programmStufe)
    .where(eq(programmStufe.programmId, programmId))
    .orderBy(programmStufe.stufeId);
  const log = await db
    .select({
      aktion: auditLog.aktion,
      zielTyp: auditLog.zielTyp,
      akteurId: auditLog.akteurId,
      abteilungId: auditLog.abteilungId,
      details: auditLog.details,
    })
    .from(auditLog)
    .where(eq(auditLog.zielId, programmId));
  return {
    sichtbarkeit: zeile.sichtbarkeit,
    stufen: stufen.map((s) => s.stufeId),
    log,
  };
}

describe("PUT /api/v1/programme/:id/zuordnung", () => {
  test("slA ordnet ein freies Programm der eigenen Stufe zu und öffnet es für Eltern", async () => {
    const p = await frisch("intern", []);
    const res = await put(konten.slA, p.id, {
      stufen: [welt.stufeAId],
      sichtbarkeit: "eltern",
    });
    expect(res.status).toBe(204);
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      log: [
        {
          aktion: "programm_zugeordnet",
          zielTyp: "programm",
          akteurId: konten.slA.id,
          abteilungId: welt.testabteilungId,
          details: { stufen: [welt.stufeAId], sichtbarkeit: "eltern" },
        },
      ],
    });
  });

  test("slA fügt die eigene Stufe einem Programm der Stufe B hinzu", async () => {
    const p = await frisch("leitende", [welt.stufeBId]);
    const res = await put(konten.slA, p.id, {
      stufen: [welt.stufeAId, welt.stufeBId],
      sichtbarkeit: "leitende",
    });
    expect(res.status).toBe(204);
    const nachher = await stand(p.id);
    expect(nachher.stufen).toEqual(sortiert([welt.stufeAId, welt.stufeBId]));
    // Nur der geänderte Schlüssel steht im Audit-Log
    expect(nachher.log).toEqual([
      expect.objectContaining({
        details: { stufen: sortiert([welt.stufeAId, welt.stufeBId]) },
      }),
    ]);
  });

  test("slA entfernt die eigene Stufe aus einem Abteilungsanlass", async () => {
    const p = await frisch("leitende", [welt.stufeAId, welt.stufeBId]);
    const res = await put(konten.slA, p.id, {
      stufen: [welt.stufeBId],
      sichtbarkeit: "leitende",
    });
    expect(res.status).toBe(204);
    expect((await stand(p.id)).stufen).toEqual([welt.stufeBId]);
  });

  test("slA darf die Stufe B nicht entfernen", async () => {
    const p = await frisch("leitende", [welt.stufeAId, welt.stufeBId]);
    const res = await put(konten.slA, p.id, {
      stufen: [welt.stufeAId],
      sichtbarkeit: "leitende",
    });
    expect(res.status).toBe(403);
    // Die Ablehnung ändert nichts
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "leitende",
      stufen: sortiert([welt.stufeAId, welt.stufeBId]),
      log: [],
    });
  });

  test("die Sichtbarkeit ändert nur ein Admin, sobald Stufe B beteiligt ist", async () => {
    const mitBeiden = await frisch("leitende", [welt.stufeAId, welt.stufeBId]);
    const beide = await put(konten.slA, mitBeiden.id, {
      stufen: sortiert([welt.stufeAId, welt.stufeBId]),
      sichtbarkeit: "eltern",
    });
    expect(beide.status).toBe(403);
    const nurB = await frisch("leitende", [welt.stufeBId]);
    const fremd = await put(konten.slA, nurB.id, {
      stufen: [welt.stufeBId],
      sichtbarkeit: "eltern",
    });
    expect(fremd.status).toBe(403);
    expect((await stand(nurB.id)).sichtbarkeit).toBe("leitende");
  });

  test("slA darf keine fremde Stufe zuordnen", async () => {
    const p = await frisch("intern", []);
    const res = await put(konten.slA, p.id, {
      stufen: [welt.stufeBId],
      sichtbarkeit: "intern",
    });
    expect(res.status).toBe(403);
    expect((await stand(p.id)).stufen).toEqual([]);
  });

  test("ein Admin ändert Stufen und Sichtbarkeit zugleich", async () => {
    const p = await frisch("leitende", [welt.stufeAId, welt.stufeBId]);
    const res = await put(konten.admin, p.id, {
      stufen: [welt.stufeBId],
      sichtbarkeit: "eltern",
    });
    expect(res.status).toBe(204);
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "eltern",
      stufen: [welt.stufeBId],
      log: [
        {
          aktion: "programm_zugeordnet",
          zielTyp: "programm",
          akteurId: konten.admin.id,
          abteilungId: welt.testabteilungId,
          details: { stufen: [welt.stufeBId], sichtbarkeit: "eltern" },
        },
      ],
    });
  });

  test("fremde oder unbekannte Stufen: 400 für den Admin, 403 für die SL", async () => {
    const p = await frisch("intern", []);
    const demoStufe = await put(konten.admin, p.id, {
      stufen: [welt.demoStufeId],
      sichtbarkeit: "intern",
    });
    expect(demoStufe.status).toBe(400);
    const unbekannt = await put(konten.admin, p.id, {
      stufen: [randomUUID()],
      sichtbarkeit: "intern",
    });
    expect(unbekannt.status).toBe(400);
    // Die SL scheitert schon am Recht: Die fremde Stufe ist für sie eine fremde Änderung
    const alsSl = await put(konten.slA, p.id, {
      stufen: [welt.demoStufeId],
      sichtbarkeit: "intern",
    });
    expect(alsSl.status).toBe(403);
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "intern",
      stufen: [],
      log: [],
    });
  });

  test("ohne Stufe bleibt nur «intern»", async () => {
    const p = await frisch("intern", []);
    const eltern = await put(konten.admin, p.id, {
      stufen: [],
      sichtbarkeit: "eltern",
    });
    expect(eltern.status).toBe(400);
    const intern = await put(konten.admin, p.id, {
      stufen: [],
      sichtbarkeit: "intern",
    });
    expect(intern.status).toBe(204);
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "intern",
      stufen: [],
      log: [],
    });
  });

  test("Leitende und Eltern: 403 auch ohne Änderung", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const noop = { stufen: [welt.stufeAId], sichtbarkeit: "eltern" };
    expect((await put(konten.leitendeA, p.id, noop)).status).toBe(403);
    expect((await put(konten.elternA, p.id, noop)).status).toBe(403);
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      log: [],
    });
  });

  test("unsichtbare Programme: 404", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const noop = { stufen: [welt.stufeAId], sichtbarkeit: "eltern" };
    expect((await put(konten.elternB, p.id, noop)).status).toBe(404);
    expect((await put(konten.demoAdmin, p.id, noop)).status).toBe(404);
  });

  test("ein No-op einer SL gibt 204 und keinen Audit-Eintrag", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const res = await put(konten.slA, p.id, {
      stufen: [welt.stufeAId],
      sichtbarkeit: "eltern",
    });
    expect(res.status).toBe(204);
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      log: [],
    });
  });

  test("unbekannte, doppelte oder fehlende Felder: 400", async () => {
    const p = await frisch("eltern", [welt.stufeAId]);
    const faelle: Record<string, unknown>[] = [
      // status, abteilung_id und google_* sind nie schreibbar
      { stufen: [welt.stufeAId], sichtbarkeit: "eltern", status: "abgesagt" },
      {
        stufen: [welt.stufeAId],
        sichtbarkeit: "eltern",
        abteilungId: randomUUID(),
      },
      {
        stufen: [welt.stufeAId],
        sichtbarkeit: "eltern",
        googleBeschreibung: "x",
      },
      { stufen: [welt.stufeAId] },
      { stufen: [welt.stufeAId, welt.stufeAId], sichtbarkeit: "eltern" },
      {
        stufen: Array.from({ length: 51 }, () => randomUUID()),
        sichtbarkeit: "eltern",
      },
      { stufen: [welt.stufeAId], sichtbarkeit: "alle" },
    ];
    for (const body of faelle) {
      const res = await put(konten.admin, p.id, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      log: [],
    });
  });

  test("die Zeilensperre lässt gleichzeitige Zuordnungen nacheinander laufen", async () => {
    const p = await frisch("intern", []);
    let gesperrt!: () => void;
    const sperreSteht = new Promise<void>((resolve) => (gesperrt = resolve));
    let freigeben!: () => void;
    const gehalten = new Promise<void>((resolve) => (freigeben = resolve));
    // Wie ein erster PUT: erst die Zeile sperren, dann Stufe A eintragen. Der Fremdschlüssel allein nähme nur «key share», das den zweiten PUT nie blockiert
    const erste = sql.begin(async (tx) => {
      await tx`select id from programm where id = ${p.id} for no key update`;
      await tx`insert into programm_stufe (programm_id, stufe_id) values (${p.id}, ${welt.stufeAId})`;
      gesperrt();
      await gehalten;
    });
    await sperreSteht;
    const zweite = put(konten.admin, p.id, {
      stufen: [welt.stufeBId],
      sichtbarkeit: "intern",
    });
    try {
      // Der zweite PUT muss an der Zeilensperre warten, bevor die erste Transaktion weitergeht
      await expect
        .poll(
          async () => {
            const wartende = await sql`
              select 1 from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and state = 'active'
                and wait_event_type = 'Lock'
                and query like '%"programm"%for no key update%'`;
            return wartende.length > 0;
          },
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      freigeben();
      await erste;
    }
    expect((await zweite).status).toBe(204);
    // Der zweite PUT las die Stufe A der ersten Transaktion und ersetzte sie; ohne Sperre stünde hier die Vereinigung
    expect(await stand(p.id)).toEqual({
      sichtbarkeit: "intern",
      stufen: [welt.stufeBId],
      log: [expect.objectContaining({ details: { stufen: [welt.stufeBId] } })],
    });
  });
});
