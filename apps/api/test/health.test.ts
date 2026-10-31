import { testClient } from "hono/testing";
import postgres, { type ReservedSql } from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import { ladeSeiten } from "../src/seiten.js";
import { erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
afterAll(() => sql.end());

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

function logEintraege() {
  return ausgabe.mock.calls.map(([zeile]) => JSON.parse(zeile as string));
}

// Zurückgerollt statt committet: Eine committete Abteilung mit altem Sync machte die /health-Tests anderer Dateien rot
async function inTransaktion(lauf: (verbindung: ReservedSql) => Promise<void>) {
  // sql.begin liefert TransactionSql, das nicht auf den Parameter sql: Sql passt, darum reserve() mit eigenem begin
  const verbindung = await sql.reserve();
  try {
    await verbindung`begin`;
    await lauf(verbindung);
  } finally {
    await verbindung`rollback`;
    verbindung.release();
  }
}

// now() ist in der Transaktion fixiert, die Minutenabstände sind darum exakt
async function erstelleAbteilung(
  verbindung: ReservedSql,
  kalenderId: string | null,
  syncVorMinuten: number | null,
) {
  const [reihe] = await verbindung<{ id: string }[]>`
    insert into abteilung (name, google_kalender_id, sync_ok_am)
    values ('Sync-Test', ${kalenderId}, ${
      syncVorMinuten === null
        ? verbindung`null`
        : verbindung`now() - ${syncVorMinuten} * interval '1 minute'`
    })
    returning id`;
  return reihe.id;
}

function health(verbindung: ReservedSql) {
  return testClient(
    erstelleApp({
      appMinVersion: "1.2.0",
      sql: verbindung,
      db,
      auth,
      seiten: ladeSeiten(),
    }),
  ).health.$get();
}

describe("/health überwacht den Kalender-Sync", () => {
  test("meldet «fehler» bei einem 31 Minuten alten Sync, der Grund steht nur im Log", async () => {
    await inTransaktion(async (verbindung) => {
      const id = await erstelleAbteilung(
        verbindung,
        "sync-test@example.org",
        31,
      );
      const res = await health(verbindung);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("fehler");
      const [grund, anfrage] = logEintraege();
      expect(grund).toEqual({
        zeit: expect.any(String),
        requestId: anfrage.requestId,
        ereignis: "health",
        code: "SYNC_VERALTET",
        abteilungIds: [id],
      });
      expect(anfrage).toEqual({
        zeit: expect.any(String),
        requestId: expect.any(String),
        methode: "GET",
        route: "/health",
        status: 503,
        dauerMs: expect.any(Number),
      });
    });
  });

  test.each([
    {
      fall: "Sync vor 29 Minuten",
      kalenderId: "sync-test@example.org",
      syncVorMinuten: 29,
    },
    {
      fall: "Sync vor genau 30 Minuten, «älter als» ist strikt",
      kalenderId: "sync-test@example.org",
      syncVorMinuten: 30,
    },
    {
      fall: "noch nie erfolgreich synchronisiert",
      kalenderId: "sync-test@example.org",
      syncVorMinuten: null,
    },
    {
      fall: "ohne Kalender wird nichts synchronisiert",
      kalenderId: null,
      syncVorMinuten: 31,
    },
  ])("meldet «ok», $fall", async ({ kalenderId, syncVorMinuten }) => {
    await inTransaktion(async (verbindung) => {
      await erstelleAbteilung(verbindung, kalenderId, syncVorMinuten);
      const res = await health(verbindung);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(logEintraege()).toEqual([]);
    });
  });
});
