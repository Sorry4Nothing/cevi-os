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
import { beitragLesbar } from "../../src/lager/pinnwand.js";
import { ladeLagerZugriff } from "../../src/lager/policy.js";
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

// Zählt jede Abfrage der API (für den Test «Abfragen je Seite»)
let abfragen = 0;
const sql = postgres(API_URL, { debug: () => void abfragen++ });
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Eine Attrappe statt firebase-admin: Kein Netz, keine Schlüssel
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
let fremdLagerId: string;

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
  titel = "Pinnwandlager",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel,
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
}
// Ein frisches Lager mit den vier Lager-Rollen; die Mitgliedszeile der fremden Abteilung gibt nichts frei
async function neuesLager(
  status: "aktiv" | "abgeschlossen" = "aktiv",
  titel = "Pinnwandlager",
) {
  const id = await legeLager(welt.testabteilungId, status, titel);
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
  fremdLagerId = await legeLager(welt.demoAbteilungId);
});

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
async function neu(lagerId: string, felder: Record<string, unknown> = {}) {
  const a = await anfrage(
    konten.lagerleitung,
    "POST",
    `${L(lagerId)}/pinnwand`,
    {
      titel: "Beitrag",
      ...felder,
    },
  );
  expect(a.status).toBe(201);
  return a.body;
}
const titel = async (
  persona: LagerPersona,
  lagerId: string,
  abfrage = "",
): Promise<string[]> => {
  const a = await anfrage(
    konten[persona],
    "GET",
    `${L(lagerId)}/pinnwand${abfrage}`,
  );
  expect(a.status).toBe(200);
  return a.body.beitraege.map((b: { titel: string }) => b.titel);
};
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

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

describe("Rechte je Lager-Persona", () => {
  // Lesen: jede Rolle mit pinnwand.lesen. Schreiben: pinnwand.bearbeiten (Standard: Lagerleitung, Abteilungsleitung, Leitung)
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
  const schreiben: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 201,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test.each(LAGER_PERSONAS)("%s: lesen und anlegen", async (p) => {
    const liste = await anfrage(konten[p], "GET", `${L(lagerId)}/pinnwand`);
    const post = await anfrage(konten[p], "POST", `${L(lagerId)}/pinnwand`, {
      titel: "Mitteilung",
    });
    expect([liste.status, post.status]).toEqual([lesen[p], schreiben[p]]);
  });

  test.each(LAGER_PERSONAS)("%s: ändern und löschen", async (p) => {
    const b = await neu(lagerId);
    const erfolg = schreiben[p] === 201;
    const patch = await anfrage(
      konten[p],
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      { version: 1, titel: "Geändert" },
    );
    const del = await anfrage(
      konten[p],
      "DELETE",
      `${L(lagerId)}/pinnwand/${b.id}?version=${erfolg ? 2 : 1}`,
    );
    expect([patch.status, del.status]).toEqual(
      erfolg ? [200, 204] : [schreiben[p], schreiben[p]],
    );
  });

  test("abgeschlossenes Lager: schreiben 409, lesen 200", async () => {
    const zu = await neuesLager("abgeschlossen");
    const b = (
      await db
        .insert(schema.pinnwandBeitrag)
        .values({ lagerId: zu, titel: "Alt", lagerSeq: 0 })
        .returning({ id: schema.pinnwandBeitrag.id })
    )[0]!;
    const post = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(zu)}/pinnwand`,
      {
        titel: "X",
      },
    );
    expect(post.status).toBe(409);
    expect(post.body.code).toBe("LAGER_GESCHLOSSEN");
    const del = await anfrage(
      konten.abteilungsleitung,
      "DELETE",
      `${L(zu)}/pinnwand/${b.id}?version=1`,
    );
    expect(del.status).toBe(409);
    expect(
      (await anfrage(konten.team, "GET", `${L(zu)}/pinnwand`)).status,
    ).toBe(200);
  });

  test("Lager der fremden Abteilung: 404, auch für die Abteilungsleitung", async () => {
    for (const methode of ["GET", "POST"]) {
      const a = await anfrage(
        konten.abteilungsleitung,
        methode,
        `${L(fremdLagerId)}/pinnwand`,
        methode === "POST" ? { titel: "X" } : undefined,
      );
      expect(a.status).toBe(404);
    }
  });

  test("ein Beitrag eines anderen Lagers gibt es unter diesem Lager nicht (404)", async () => {
    const anderes = await neuesLager();
    const b = await neu(anderes);
    for (const [methode, pfad, body] of [
      ["GET", `${L(lagerId)}/pinnwand/${b.id}`, undefined],
      ["PATCH", `${L(lagerId)}/pinnwand/${b.id}`, { version: 1, titel: "X" }],
      ["DELETE", `${L(lagerId)}/pinnwand/${b.id}?version=1`, undefined],
    ] as const) {
      expect(
        (await anfrage(konten.lagerleitung, methode, pfad, body)).status,
      ).toBe(404);
    }
    // Unverändert
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "GET",
          `${L(anderes)}/pinnwand/${b.id}`,
        )
      ).body.version,
    ).toBe(1);
  });

  test("entzogenes Recht: die Leitung schreibt nicht mehr und sieht nur noch, was zu ihr passt", async () => {
    const id = await neuesLager();
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "leitung",
      recht: "pinnwand.bearbeiten",
      erlaubt: false,
    });
    await neu(id, { titel: "Für alle" });
    await neu(id, {
      titel: "Nur Team",
      empfaenger: { rollen: ["team"], personen: [] },
    });
    expect(
      (
        await anfrage(konten.leitung, "POST", `${L(id)}/pinnwand`, {
          titel: "X",
        })
      ).status,
    ).toBe(403);
    expect(await titel("leitung", id)).toEqual(["Für alle"]);
    expect(
      (await anfrage(konten.leitung, "GET", `${L(id)}/pinnwand?status=alle`))
        .status,
    ).toBe(403);
    expect((await titel("lagerleitung", id)).sort()).toEqual([
      "Für alle",
      "Nur Team",
    ]);
  });

  test("entzogenes Lese-Recht: 403 auf allen Leseroutern", async () => {
    const id = await neuesLager();
    const b = await neu(id);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "lesen",
      recht: "pinnwand.lesen",
      erlaubt: false,
    });
    expect(
      (await anfrage(konten.lesen, "GET", `${L(id)}/pinnwand`)).status,
    ).toBe(403);
    expect(
      (await anfrage(konten.lesen, "GET", `${L(id)}/pinnwand/${b.id}`)).status,
    ).toBe(403);
  });
});

describe("Empfängerfilter", () => {
  let lagerId: string;
  let fremdePerson: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
    fremdePerson = (
      await db
        .insert(schema.user)
        .values({
          name: "Wegwerf",
          email: `${randomUUID()}@example.org`,
          username: `w.${randomUUID().slice(0, 8)}`,
          abteilungId: welt.testabteilungId,
          mussPasswortAendern: false,
        })
        .returning({ id: schema.user.id })
    )[0]!.id;
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId, personId: fremdePerson, rolle: "team" });
    const e = (rollen: string[], personen: string[]) => ({ rollen, personen });
    await neu(lagerId, { titel: "alle" });
    await neu(lagerId, { titel: "nur Team", empfaenger: e(["team"], []) });
    await neu(lagerId, {
      titel: "nur Leitung",
      empfaenger: e(["leitung"], []),
    });
    await neu(lagerId, {
      titel: "Person Team",
      empfaenger: e([], [konten.team.id!]),
    });
    await neu(lagerId, {
      titel: "Person Lesen",
      empfaenger: e([], [konten.lesen.id!]),
    });
    await neu(lagerId, {
      titel: "Rolle und Person",
      empfaenger: e(["lesen"], [konten.team.id!]),
    });
    await neu(lagerId, {
      titel: "andere Person",
      empfaenger: e([], [fremdePerson]),
    });
  });

  test("Team sieht, was für alle, für das Team oder für es selbst ist", async () => {
    expect((await titel("team", lagerId)).sort()).toEqual([
      "Person Team",
      "Rolle und Person",
      "alle",
      "nur Team",
    ]);
  });

  test("Lesen sieht, was für alle, für die Rolle oder für es selbst ist", async () => {
    expect((await titel("lesen", lagerId)).sort()).toEqual([
      "Person Lesen",
      "Rolle und Person",
      "alle",
    ]);
  });

  test("wer bearbeiten darf, sieht jeden Beitrag", async () => {
    for (const p of ["lagerleitung", "abteilungsleitung", "leitung"] as const) {
      expect(await titel(p, lagerId)).toHaveLength(7);
    }
  });

  test("ein Beitrag, der nicht zur Person passt, gibt es für sie nicht (404)", async () => {
    const liste = (
      await anfrage(konten.lagerleitung, "GET", `${L(lagerId)}/pinnwand`)
    ).body.beitraege as { id: string; titel: string }[];
    const id = (t: string) => liste.find((b) => b.titel === t)!.id;
    const abruf = (p: LagerPersona, t: string) =>
      anfrage(konten[p], "GET", `${L(lagerId)}/pinnwand/${id(t)}`);
    expect((await abruf("team", "nur Leitung")).status).toBe(404);
    expect((await abruf("team", "Person Lesen")).status).toBe(404);
    expect((await abruf("team", "andere Person")).status).toBe(404);
    expect((await abruf("lesen", "nur Team")).status).toBe(404);
    expect((await abruf("team", "nur Team")).status).toBe(200);
    expect((await abruf("lesen", "Person Lesen")).status).toBe(200);
    expect((await abruf("leitung", "andere Person")).status).toBe(200);
  });

  test("Empfänger: die Rollen sieht jeder, die Personen nur, wer bearbeiten darf", async () => {
    const f = (p: LagerPersona) =>
      anfrage(konten[p], "GET", `${L(lagerId)}/pinnwand`).then(
        (a) =>
          (
            a.body.beitraege as {
              titel: string;
              empfaenger: {
                anAlle: boolean;
                rollen: string[];
                personen: string[];
              };
            }[]
          ).find((b) => b.titel === "Rolle und Person")!.empfaenger,
      );
    expect(await f("team")).toEqual({
      anAlle: false,
      rollen: ["lesen"],
      personen: [],
    });
    expect(await f("lagerleitung")).toEqual({
      anAlle: false,
      rollen: ["lesen"],
      personen: [konten.team.id],
    });
    const alle = (
      await anfrage(konten.team, "GET", `${L(lagerId)}/pinnwand`)
    ).body.beitraege.find((b: { titel: string }) => b.titel === "alle");
    expect(alle.empfaenger).toEqual({ anAlle: true, rollen: [], personen: [] });
  });

  test("Empfänger ändern über PATCH ersetzt die Menge und zählt die Version hoch", async () => {
    const id = await neuesLager();
    const b = await neu(id, {
      empfaenger: { rollen: ["team"], personen: [] },
    });
    expect(await titel("lesen", id)).toEqual([]);
    const a = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(id)}/pinnwand/${b.id}`,
      { version: 1, empfaenger: { rollen: [], personen: [] } },
    );
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    expect(a.body.empfaenger.anAlle).toBe(true);
    expect(await titel("lesen", id)).toEqual(["Beitrag"]);
  });

  test("Empfänger müssen Mitglieder dieses Lagers sein", async () => {
    const anderes = await neuesLager();
    for (const person of [konten.ohneMitgliedschaft.id!, randomUUID()]) {
      const a = await anfrage(
        konten.lagerleitung,
        "POST",
        `${L(anderes)}/pinnwand`,
        {
          titel: "X",
          empfaenger: { rollen: [], personen: [person] },
        },
      );
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("KEIN_MITGLIED");
    }
  });
});

describe("Zeitfenster", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test("ein künftiger Beitrag erscheint erst, wenn das Fenster beginnt; ein abgelaufener verschwindet", async () => {
    const kuenftig = await neu(lagerId, {
      titel: "kommt",
      sichtbarAb: inMs(3_600_000),
    });
    const abgelaufen = await neu(lagerId, {
      titel: "vorbei",
      sichtbarAb: inMs(-7_200_000),
      sichtbarBis: inMs(-3_600_000),
    });
    await neu(lagerId, { titel: "jetzt", sichtbarBis: inMs(3_600_000) });
    expect((await titel("team", lagerId)).sort()).toEqual(["jetzt"]);
    // Wer verwaltet, sieht die aktive Pinnwand wie die anderen, alles mit status=alle
    expect((await titel("leitung", lagerId)).sort()).toEqual(["jetzt"]);
    expect((await titel("leitung", lagerId, "?status=alle")).sort()).toEqual([
      "jetzt",
      "kommt",
      "vorbei",
    ]);
    // Direkter Abruf ausserhalb des Fensters: 404 für das Team, 200 für die Verwaltung
    for (const b of [kuenftig, abgelaufen]) {
      expect(
        (await anfrage(konten.team, "GET", `${L(lagerId)}/pinnwand/${b.id}`))
          .status,
      ).toBe(404);
      expect(
        (await anfrage(konten.leitung, "GET", `${L(lagerId)}/pinnwand/${b.id}`))
          .status,
      ).toBe(200);
    }
    // Die Abfrage wertet die Zeit aus, kein Job: Beginnt das Fenster, erscheint der Beitrag bei der nächsten Abfrage
    await db
      .update(schema.pinnwandBeitrag)
      .set({ sichtbarAb: new Date(Date.now() - 60_000) })
      .where(eq(schema.pinnwandBeitrag.id, kuenftig.id));
    expect((await titel("team", lagerId)).sort()).toEqual(["jetzt", "kommt"]);
    await db
      .update(schema.pinnwandBeitrag)
      .set({ sichtbarBis: new Date(Date.now() - 1_000) })
      .where(eq(schema.pinnwandBeitrag.id, kuenftig.id));
    expect((await titel("team", lagerId)).sort()).toEqual(["jetzt"]);
  });

  test("status=alle ist nur für die Verwaltung (403 für Team und Lesen)", async () => {
    for (const p of ["team", "lesen"] as const) {
      expect(
        (await anfrage(konten[p], "GET", `${L(lagerId)}/pinnwand?status=alle`))
          .status,
      ).toBe(403);
    }
  });

  test("ein Fenster, das nicht nach dem Beginn endet, ist ungültig (400)", async () => {
    const ab = inMs(3_600_000);
    for (const bis of [ab, inMs(1_000)]) {
      const a = await anfrage(
        konten.lagerleitung,
        "POST",
        `${L(lagerId)}/pinnwand`,
        {
          titel: "X",
          sichtbarAb: ab,
          sichtbarBis: bis,
        },
      );
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("ZEITFENSTER_UNGUELTIG");
    }
    const b = await neu(lagerId, { titel: "Y", sichtbarAb: ab });
    const p = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 1,
        sichtbarBis: inMs(1_000),
      },
    );
    expect(p.status).toBe(400);
    // null hebt die Grenze auf
    const q = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 1,
        sichtbarAb: null,
      },
    );
    expect(q.status).toBe(200);
    expect(q.body.sichtbarAb).toBeNull();
  });
});

describe("Reihenfolge und Seitenwechsel", () => {
  test("Angeheftete zuerst, dann neueste zuerst; die Seiten ergeben die ganze Liste ohne Doppelte", async () => {
    const id = await neuesLager();
    for (const [t, angeheftet] of [
      ["P1", false],
      ["P2", true],
      ["P3", false],
      ["P4", true],
      ["P5", false],
    ] as const) {
      await neu(id, { titel: t, angeheftet });
    }
    const ganz = await titel("team", id);
    expect(ganz).toEqual(["P4", "P2", "P5", "P3", "P1"]);

    const gesehen: string[] = [];
    let nach: string | null = null;
    for (let i = 0; i < 5; i++) {
      const a: Antwort = await anfrage(
        konten.team,
        "GET",
        `${L(id)}/pinnwand?limit=2${nach ? `&nach=${nach}` : ""}`,
      );
      expect(a.status).toBe(200);
      gesehen.push(...a.body.beitraege.map((b: { titel: string }) => b.titel));
      nach = a.body.naechster;
      if (!nach) break;
    }
    expect(gesehen).toEqual(ganz);
    // Eine unbekannte Cursor-ID ergibt eine leere Seite, keinen Fehler
    const leer = await anfrage(
      konten.team,
      "GET",
      `${L(id)}/pinnwand?nach=${randomUUID()}`,
    );
    expect(leer.body).toEqual({ beitraege: [], naechster: null });
  });

  test("die Zahl der Abfragen hängt nicht von der Zahl der Beiträge ab", async () => {
    const id = await neuesLager();
    await neu(id, {
      titel: "eins",
      empfaenger: { rollen: ["team"], personen: [] },
    });
    const zaehle = async () => {
      await anfrage(konten.team, "GET", `${L(id)}/pinnwand`);
      const vorher = abfragen;
      const a = await anfrage(konten.team, "GET", `${L(id)}/pinnwand`);
      expect(a.status).toBe(200);
      return { n: abfragen - vorher, beitraege: a.body.beitraege.length };
    };
    const klein = await zaehle();
    // Mit Dateien und Empfängern an jedem Beitrag
    const datei = (
      await anfrage(konten.lagerleitung, "POST", `${L(id)}/dateien`, {
        anzeigename: "Plan",
        link: "https://example.org/plan.pdf",
      })
    ).body;
    for (let i = 0; i < 11; i++) {
      await neu(id, {
        titel: `b${i}`,
        empfaenger: { rollen: ["team", "lesen"], personen: [konten.team.id] },
        dateiIds: i === 0 ? [datei.id] : [],
      });
    }
    const gross = await zaehle();
    expect(klein.beitraege).toBe(1);
    expect(gross.beitraege).toBe(12);
    expect(gross.n).toBe(klein.n);
    // Eine leere Seite spart die Abfrage der Dateien
    const vorher = abfragen;
    await anfrage(konten.team, "GET", `${L(id)}/pinnwand?nach=${randomUUID()}`);
    expect(abfragen - vorher).toBeLessThan(klein.n);
  });
});

describe("Dateien", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });
  const neueDatei = async (id = lagerId, name = "Lagerplan") => {
    const a = await anfrage(konten.lagerleitung, "POST", `${L(id)}/dateien`, {
      anzeigename: name,
      link: `https://example.org/${randomUUID()}.pdf`,
    });
    expect(a.status).toBe(201);
    return a.body as { id: string; link: string };
  };

  test("eine Datei ist nur abrufbar, wenn der Beitrag lesbar ist", async () => {
    const datei = await neueDatei();
    // Die Datei ist eben angelegt: Nur wer sie hinzugefügt hat, sieht sie
    expect(
      (await anfrage(konten.team, "GET", `${L(lagerId)}/dateien/${datei.id}`))
        .status,
    ).toBe(404);
    const b = await neu(lagerId, {
      titel: "Mit Datei",
      empfaenger: { rollen: ["team"], personen: [] },
      dateiIds: [datei.id],
    });
    expect(b.dateien).toHaveLength(1);
    expect(b.dateien[0]).toMatchObject({ id: datei.id, link: datei.link });
    const abruf = (p: LagerPersona) =>
      anfrage(konten[p], "GET", `${L(lagerId)}/dateien/${datei.id}`);
    // Das Team ist Empfänger, Lesen nicht, die Verwaltung sieht alles
    expect((await abruf("team")).status).toBe(200);
    expect((await abruf("lesen")).status).toBe(404);
    expect((await abruf("leitung")).status).toBe(200);
    // Auch die Liste zeigt die Datei nur dem Team
    expect(
      (await anfrage(konten.team, "GET", `${L(lagerId)}/pinnwand/${b.id}`)).body
        .dateien,
    ).toHaveLength(1);
    expect(await titel("lesen", lagerId)).not.toContain("Mit Datei");
    // Ausserhalb des Zeitfensters ist auch die Datei nicht abrufbar
    await db
      .update(schema.pinnwandBeitrag)
      .set({
        sichtbarBis: new Date(Date.now() - 1_000),
        sichtbarAb: new Date(Date.now() - 60_000),
      })
      .where(eq(schema.pinnwandBeitrag.id, b.id));
    expect((await abruf("team")).status).toBe(404);
    expect((await abruf("leitung")).status).toBe(200);
    // Der gelöschte Beitrag gibt die Datei nicht mehr frei
    const del = await anfrage(
      konten.lagerleitung,
      "DELETE",
      `${L(lagerId)}/pinnwand/${b.id}?version=1`,
    );
    expect(del.status).toBe(204);
    expect((await abruf("leitung")).status).toBe(404);
  });

  test("Dateien ändern: Reihenfolge, entfernen, wieder einbinden", async () => {
    const [d1, d2, d3] = [
      await neueDatei(),
      await neueDatei(),
      await neueDatei(),
    ];
    const b = await neu(lagerId, {
      titel: "Dateien",
      dateiIds: [d1.id, d2.id],
    });
    expect(b.dateien.map((d: { id: string }) => d.id)).toEqual([d1.id, d2.id]);
    const p = (version: number, dateiIds: string[]) =>
      anfrage(konten.lagerleitung, "PATCH", `${L(lagerId)}/pinnwand/${b.id}`, {
        version,
        dateiIds,
      });
    const a = await p(1, [d2.id, d3.id, d1.id]);
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    expect(a.body.dateien.map((d: { id: string }) => d.id)).toEqual([
      d2.id,
      d3.id,
      d1.id,
    ]);
    const c = await p(2, [d3.id]);
    expect(c.body.dateien.map((d: { id: string }) => d.id)).toEqual([d3.id]);
    // Wieder einbinden: der frühere Verweis ist gelöscht, der neue legt sich an
    const e = await p(3, [d3.id, d1.id]);
    expect(e.body.dateien.map((d: { id: string }) => d.id)).toEqual([
      d3.id,
      d1.id,
    ]);
    // Die Datei selbst bleibt (nur der Verweis ging)
    const zeilen = await db
      .select()
      .from(schema.pinnwandDatei)
      .where(eq(schema.pinnwandDatei.beitragId, b.id));
    expect(zeilen.filter((z) => z.geloeschtAm === null)).toHaveLength(2);
    expect(zeilen.filter((z) => z.geloeschtAm !== null)).toHaveLength(2);
    // Ohne dateiIds bleibt alles
    const f = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 4,
        titel: "Neu",
      },
    );
    expect(f.body.dateien).toHaveLength(2);
  });

  test("unbekannte, fremde und nicht sichtbare Dateien lassen sich nicht einbinden (400)", async () => {
    const anderes = await neuesLager();
    const fremd = await neueDatei(anderes);
    for (const id of [fremd.id, randomUUID()]) {
      const a = await anfrage(
        konten.lagerleitung,
        "POST",
        `${L(lagerId)}/pinnwand`,
        {
          titel: "X",
          dateiIds: [id],
        },
      );
      expect(a.status).toBe(400);
      expect(a.body.code).toBe("DATEI_UNBEKANNT");
    }
    // Die Datei einer anderen Person, die älter als 24 Stunden ist und nirgends eingebunden: für die Leitung unsichtbar
    const alt = await neueDatei();
    await db
      .update(schema.lagerDatei)
      .set({ erstelltAm: new Date(Date.now() - 48 * 3_600_000) })
      .where(eq(schema.lagerDatei.id, alt.id));
    const b = await anfrage(konten.leitung, "POST", `${L(lagerId)}/pinnwand`, {
      titel: "X",
      dateiIds: [alt.id],
    });
    expect(b.status).toBe(400);
    // Höchstens 10, jede einmal
    const doppelt = await anfrage(
      konten.lagerleitung,
      "POST",
      `${L(lagerId)}/pinnwand`,
      {
        titel: "X",
        dateiIds: [alt.id, alt.id],
      },
    );
    expect(doppelt.status).toBe(400);
  });

  test("eine eingebundene Datei räumt der Aufräumlauf nicht weg, eine freie nach 24 Stunden", async () => {
    const { raeumeDateienOhneVerweisAuf } =
      await import("../../src/lager/datei-verweise.js");
    const eingebunden = await neueDatei();
    const frei = await neueDatei();
    await neu(lagerId, { titel: "Hält", dateiIds: [eingebunden.id] });
    await db
      .update(schema.lagerDatei)
      .set({ erstelltAm: new Date(Date.now() - 48 * 3_600_000) })
      .where(and(eq(schema.lagerDatei.lagerId, lagerId)));
    await raeumeDateienOhneVerweisAuf(db);
    const rest = await db
      .select({ id: schema.lagerDatei.id })
      .from(schema.lagerDatei)
      .where(eq(schema.lagerDatei.lagerId, lagerId));
    expect(rest.map((z) => z.id)).toContain(eingebunden.id);
    expect(rest.map((z) => z.id)).not.toContain(frei.id);
  });
});

describe("Schreiben und Sync", () => {
  let lagerId: string;
  beforeAll(async () => {
    lagerId = await neuesLager();
  });

  test("anlegen, ändern, löschen: Version, Antwort ohne fremde Spalten, Feed", async () => {
    const feld = async () =>
      (await anfrage(konten.team, "GET", `${L(lagerId)}/aenderungen`)).body
        .seq as number;
    const seit = await feld();
    const b = await neu(lagerId, {
      titel: "Zuerst",
      text: "Hallo",
      wichtig: false,
      angeheftet: true,
    });
    expect(b).toMatchObject({
      version: 1,
      titel: "Zuerst",
      text: "Hallo",
      wichtig: false,
      angeheftet: true,
      sichtbarAb: null,
      sichtbarBis: null,
      vonPersonId: konten.lagerleitung.id,
      empfaenger: { anAlle: true, rollen: [], personen: [] },
      dateien: [],
    });
    expect(b.von.id).toBe(konten.lagerleitung.id);
    // Keine Systemspalten
    expect(Object.keys(b)).not.toContain("lagerSeq");
    expect(Object.keys(b)).not.toContain("geloeschtAm");

    const p = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 1,
        titel: "Danach",
        text: "",
      },
    );
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ version: 2, titel: "Danach", text: "" });

    // Veraltete Version: 409 mit dem Stand
    const k = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 1,
        titel: "Spät",
      },
    );
    expect(k.status).toBe(409);
    expect(k.body.code).toBe("VERSION_KONFLIKT");
    expect(k.body.aktuell).toMatchObject({ version: 2, titel: "Danach" });
    expect(k.body.abweichend).toEqual(["titel"]);
    const kd = await anfrage(
      konten.lagerleitung,
      "DELETE",
      `${L(lagerId)}/pinnwand/${b.id}?version=1`,
    );
    expect(kd.status).toBe(409);

    const del = await anfrage(
      konten.lagerleitung,
      "DELETE",
      `${L(lagerId)}/pinnwand/${b.id}?version=2`,
    );
    expect(del.status).toBe(204);
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "GET",
          `${L(lagerId)}/pinnwand/${b.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          konten.lagerleitung,
          "DELETE",
          `${L(lagerId)}/pinnwand/${b.id}?version=3`,
        )
      ).status,
    ).toBe(404);
    expect(await titel("lagerleitung", lagerId)).not.toContain("Danach");

    // Feed für das Team: neu, geändert, gelöscht, nur Typ, ID und Version
    const feed = await anfrage(
      konten.team,
      "GET",
      `${L(lagerId)}/aenderungen?seit=${seit}`,
    );
    const meinen = feed.body.eintraege.filter(
      (e: { id: string }) => e.id === b.id,
    );
    expect(meinen.map((e: { art: string }) => e.art)).toEqual([
      "neu",
      "geaendert",
      "geloescht",
    ]);
    expect(meinen[0]).toMatchObject({
      objekttyp: "pinnwand_beitrag",
      version: 1,
    });
    expect(Object.keys(meinen[0]).sort()).toEqual([
      "art",
      "id",
      "objekttyp",
      "seq",
      "version",
      "zeitpunkt",
    ]);
  });

  test("der Feed meldet einem Team-Mitglied keinen Beitrag, der nicht für es ist", async () => {
    const seit = (
      await anfrage(konten.team, "GET", `${L(lagerId)}/aenderungen`)
    ).body.seq;
    const verborgen = await neu(lagerId, {
      titel: "nur Leitung",
      empfaenger: { rollen: ["leitung"], personen: [] },
    });
    const sichtbar = await neu(lagerId, { titel: "alle" });
    const ids = async (p: LagerPersona) =>
      (
        await anfrage(
          konten[p],
          "GET",
          `${L(lagerId)}/aenderungen?seit=${seit}`,
        )
      ).body.eintraege.map((e: { id: string }) => e.id);
    expect(await ids("team")).toEqual([sichtbar.id]);
    expect(await ids("lesen")).toEqual([sichtbar.id]);
    expect(await ids("leitung")).toEqual([verborgen.id, sichtbar.id]);
  });

  test("Eingaben: strikt, Grenzen, Pflichtfelder", async () => {
    const schlecht: Record<string, unknown>[] = [
      {},
      { titel: "" },
      { titel: "   " },
      { titel: "x".repeat(201) },
      { titel: "X", text: "x".repeat(10001) },
      { titel: "X", unbekannt: 1 },
      { titel: "X", wichtig: "ja" },
      { titel: "X", sichtbarAb: "morgen" },
      { titel: "X", sichtbarAb: "2027-07-10" },
      { titel: "X", empfaenger: { rollen: ["lagerleitung"], personen: [] } },
      { titel: "X", empfaenger: { rollen: ["team", "team"], personen: [] } },
      { titel: "X", empfaenger: { rollen: [], personen: ["nein"] } },
      { titel: "X", empfaenger: { rollen: [] } },
      { titel: "X", dateiIds: Array.from({ length: 11 }, () => randomUUID()) },
      { titel: "X", von: randomUUID() },
      { titel: "X", lagerId: randomUUID() },
    ];
    for (const body of schlecht) {
      const a = await anfrage(
        konten.lagerleitung,
        "POST",
        `${L(lagerId)}/pinnwand`,
        body,
      );
      expect(a.status, JSON.stringify(body)).toBe(400);
    }
    const b = await neu(lagerId);
    for (const body of [
      { titel: "X" },
      { version: 1 },
      { version: 0, titel: "X" },
      { version: 1, titel: "X", erstelltVon: randomUUID() },
      { version: 1, geloeschtAm: new Date().toISOString() },
    ]) {
      const a = await anfrage(
        konten.lagerleitung,
        "PATCH",
        `${L(lagerId)}/pinnwand/${b.id}`,
        body,
      );
      expect(a.status, JSON.stringify(body)).toBe(400);
    }
    for (const q of ["", "?version=0", "?version=x", "?version=1&x=1"]) {
      expect(
        (
          await anfrage(
            konten.lagerleitung,
            "DELETE",
            `${L(lagerId)}/pinnwand/${b.id}${q}`,
          )
        ).status,
      ).toBe(400);
    }
    for (const q of [
      "?limit=0",
      "?limit=101",
      "?status=x",
      "?nach=x",
      "?x=1",
    ]) {
      expect(
        (await anfrage(konten.team, "GET", `${L(lagerId)}/pinnwand${q}`))
          .status,
      ).toBe(400);
    }
  });

  test("beitragLesbar sagt, ob die Person den Beitrag sehen darf", async () => {
    const b = await neu(lagerId, {
      titel: "nur Leitung",
      empfaenger: { rollen: ["leitung"], personen: [] },
    });
    const zugriff = async (p: LagerPersona) =>
      (await ladeLagerZugriff(
        db,
        {
          id: konten[p].id!,
          abteilungId: welt.testabteilungId,
          admin: p === "abteilungsleitung",
        },
        lagerId,
      ))!;
    expect(await beitragLesbar(db, await zugriff("team"), b.id)).toBe(false);
    expect(await beitragLesbar(db, await zugriff("leitung"), b.id)).toBe(true);
    expect(await beitragLesbar(db, await zugriff("team"), randomUUID())).toBe(
      false,
    );
  });
});

describe("Push bei einer wichtigen Mitteilung", () => {
  let lagerId: string;
  let tokens: Record<"lagerleitung" | "leitung" | "team" | "lesen", string>;
  beforeAll(async () => {
    lagerId = await neuesLager("aktiv", "Sommerlager");
    tokens = {
      lagerleitung: await legeToken(konten.lagerleitung.id!),
      leitung: await legeToken(konten.leitung.id!),
      team: await legeToken(konten.team.id!),
      lesen: await legeToken(konten.lesen.id!),
    };
  });
  const empfaenger = () => gesendet.map((g) => g.token).sort();
  const erwartet = (...p: (keyof typeof tokens)[]) =>
    p.map((x) => tokens[x]).sort();

  test("eine neue wichtige Mitteilung geht an alle ausser der Autorin, ohne Titel und Text", async () => {
    const b = await neu(lagerId, {
      titel: "Geheimer Titel Anna",
      text: "Abfahrt Samstag 07:30, Kind Ben fehlt",
      wichtig: true,
    });
    expect(empfaenger()).toEqual(erwartet("leitung", "team", "lesen"));
    for (const g of gesendet) {
      expect(g.notification).toEqual({
        title: "Wichtige Mitteilung",
        body: "Sommerlager",
      });
      expect(g.data).toEqual({ typ: "lager_pinnwand", id: b.id });
      const roh = JSON.stringify(g);
      expect(roh).not.toContain("Anna");
      expect(roh).not.toContain("Abfahrt");
      expect(roh).not.toContain("Ben");
    }
    // Eine Zeile in der Glocke je Empfänger, ohne Inhalt
    const zeilen = await db
      .select()
      .from(schema.lagerBenachrichtigung)
      .where(eq(schema.lagerBenachrichtigung.objektId, b.id));
    expect(zeilen.map((z) => z.personId).sort()).toEqual(
      [konten.leitung.id, konten.team.id, konten.lesen.id].sort(),
    );
    expect(
      zeilen.every(
        (z) =>
          z.art === "pinnwand_wichtig" && z.objektTyp === "pinnwand_beitrag",
      ),
    ).toBe(true);
    // Die App löst den Push über aufloesen auf
    const auf = await anfrage(
      konten.team,
      "GET",
      `/api/v1/lager/aufloesen/lager_pinnwand/${b.id}`,
    );
    expect(auf.status).toBe(200);
  });

  test("eine Mitteilung ohne «wichtig» und eine erst später sichtbare lösen nichts aus", async () => {
    await neu(lagerId, { titel: "normal" });
    await neu(lagerId, {
      titel: "später",
      wichtig: true,
      sichtbarAb: inMs(3_600_000),
    });
    expect(gesendet).toEqual([]);
  });

  test("Empfänger: nur wen der Beitrag meint", async () => {
    await neu(lagerId, {
      titel: "Leitung",
      wichtig: true,
      empfaenger: { rollen: ["leitung"], personen: [] },
    });
    expect(empfaenger()).toEqual(erwartet("leitung"));
    gesendet = [];
    await neu(lagerId, {
      titel: "Person",
      wichtig: true,
      empfaenger: { rollen: [], personen: [konten.lesen.id] },
    });
    expect(empfaenger()).toEqual(erwartet("lesen"));
  });

  test("wer die Pinnwand nicht lesen darf, bekommt keinen Push", async () => {
    const id = await neuesLager("aktiv", "Anderes Lager");
    const t = await legeToken(konten.lesen.id!);
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "lesen",
      recht: "pinnwand.lesen",
      erlaubt: false,
    });
    await neu(id, { titel: "X", wichtig: true });
    expect(gesendet.map((g) => g.token)).not.toContain(t);
    // Das Token gehört derselben Person wie in den anderen Tests dieser Gruppe
    await db.delete(schema.pushToken).where(eq(schema.pushToken.token, t));
  });

  test("wer die Art abgeschaltet hat, bekommt keinen Push", async () => {
    await db.insert(schema.lagerBenachrichtigungEinstellung).values({
      personId: konten.team.id!,
      art: "pinnwand_wichtig",
      aktiv: false,
    });
    try {
      await neu(lagerId, { titel: "Nochmal", wichtig: true });
      expect(empfaenger()).toEqual(erwartet("leitung", "lesen"));
    } finally {
      await db
        .delete(schema.lagerBenachrichtigungEinstellung)
        .where(
          eq(schema.lagerBenachrichtigungEinstellung.personId, konten.team.id!),
        );
    }
  });

  test("wichtig nachträglich setzen pusht einmal, weitere Änderungen nicht", async () => {
    const b = await neu(lagerId, { titel: "Erst normal" });
    expect(gesendet).toEqual([]);
    const p = await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 1,
        wichtig: true,
      },
    );
    expect(p.status).toBe(200);
    expect(empfaenger()).toEqual(erwartet("leitung", "team", "lesen"));
    gesendet = [];
    await anfrage(
      konten.lagerleitung,
      "PATCH",
      `${L(lagerId)}/pinnwand/${b.id}`,
      {
        version: 2,
        text: "Ergänzt",
      },
    );
    expect(gesendet).toEqual([]);
  });

  test("ohne Fcm (kein Schlüssel) speichert der Beitrag trotzdem", async () => {
    const ohne = erstelleApp({
      appMinVersion: "1.2.0",
      sql,
      db,
      auth,
      seiten: ladeSeiten(),
    });
    const res = await ohne.request(`${L(lagerId)}/pinnwand`, {
      method: "POST",
      headers: {
        ...konten.lagerleitung.headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({ titel: "Ohne Fcm", wichtig: true }),
    });
    expect(res.status).toBe(201);
    expect(gesendet).toEqual([]);
  });
});
