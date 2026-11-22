import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
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
import {
  darf,
  ladeLagerZugriff,
  lagerZugriff,
  type LagerEnv,
} from "../../src/lager/policy.js";
import {
  LAGER_RECHTE,
  RECHTE_KATALOG,
  standardErlaubt,
  type LagerRecht,
} from "../../src/lager/rechte-katalog.js";
import { schreibeStandardrechte } from "../../src/lager/rechte.js";
import type { Person } from "../../src/rechte.js";
import { ladeSeiten } from "../../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "../hilfen/auth.js";
import { API_URL } from "../hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
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

let welt: Welt;
let admin: PersonaKonto;
let demoAdmin: PersonaKonto;
let eltern: PersonaKonto;
let lagerleitung: PersonaKonto;
let leitung: PersonaKonto;
let team: PersonaKonto;
let lesen: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, demoAdmin, eltern, lagerleitung, leitung, team, lesen] =
    await Promise.all([
      legePersonaAn(welt, "admin"),
      legePersonaAn(welt, "demoAdmin"),
      legePersonaAn(welt, "elternA"),
      legePersonaAn(welt, "slA"),
      legePersonaAn(welt, "slB"),
      legePersonaAn(welt, "leitendeA"),
      legePersonaAn(welt, "leitendeB"),
    ]);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

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

const ADMIN = "/api/v1/admin/lager";
const LAGER = "/api/v1/lager";
const recht = (rolle: string, name: string, erlaubt: boolean) => ({
  rolle,
  recht: name,
  erlaubt,
});

// Direkt in die Datenbank, ohne Zeilen in lager_rolle_recht (wie ein Lager von vor 0061 ohne Nachfüllen): Es gilt der Standard
async function legeLager(
  status: "aktiv" | "abgeschlossen" = "aktiv",
  mitMatrix = true,
  abteilungId = welt.testabteilungId,
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Rechtelager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  for (const [konto, rolle] of [
    [lagerleitung, "lagerleitung"],
    [leitung, "leitung"],
    [team, "team"],
    [lesen, "lesen"],
  ] as const) {
    await db
      .insert(schema.lagerMitglied)
      .values({ lagerId: zeile.id, personId: konto.id!, rolle });
  }
  if (mitMatrix) {
    await schreibeStandardrechte(db, zeile.id);
  }
  return zeile.id;
}

const zeilen = (lagerId: string) =>
  db
    .select()
    .from(schema.lagerRolleRecht)
    .where(eq(schema.lagerRolleRecht.lagerId, lagerId));

const auditZeilen = (lagerId: string) =>
  db
    .select({
      aktion: schema.auditLog.aktion,
      details: schema.auditLog.details,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.zielId, lagerId),
        eq(schema.auditLog.aktion, "lager_recht_geaendert"),
      ),
    );

// Beispiel-Route, wie spätere Module sie bauen: Die Person kommt aus einer Kopfzeile, das Recht aus der Policy
const person = (konto: PersonaKonto, adminRecht = false): Person => ({
  id: konto.id!,
  abteilungId: welt.testabteilungId,
  admin: adminRecht,
  zweiterFaktor: adminRecht,
  rollen: [],
});
const beispiel = new Hono<LagerEnv>()
  .use(async (c, next) => {
    const konten: Record<string, Person> = {
      leitung: person(leitung),
      team: person(team),
      lesen: person(lesen),
      lagerleitung: person(lagerleitung),
    };
    c.set("person", konten[c.req.header("x-person") ?? ""]);
    await next();
  })
  .get(
    "/:id/aufgaben",
    lagerZugriff(db, { recht: "aufgaben.lesen_alle" }),
    (c) => c.json({ ok: true }),
  )
  .post(
    "/:id/aufgaben",
    lagerZugriff(db, { recht: "aufgaben.bearbeiten" }),
    (c) => c.body(null, 204),
  );
const beispielStatus = async (
  rolle: string,
  methode: string,
  lagerId: string,
) =>
  (
    await beispiel.request(`/${lagerId}/aufgaben`, {
      method: methode,
      headers: { "x-person": rolle },
    })
  ).status;

describe("Standardwerte beim Anlegen", () => {
  test("ein neues Lager bekommt für jede Rolle und jedes Recht eine Zeile mit dem Standard, nie für die Lagerleitung", async () => {
    const antwort = await anfrage(admin, "POST", ADMIN, {
      titel: "Neues Lager",
      von: "2027-07-10",
      bis: "2027-07-24",
    });
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };
    const alle = await zeilen(id);
    expect(alle).toHaveLength(3 * 49);
    expect(alle.some((z) => (z.rolle as string) === "lagerleitung")).toBe(
      false,
    );
    for (const z of alle) {
      expect(z.erlaubt, `${z.rolle} ${z.recht}`).toBe(
        standardErlaubt(z.rolle, z.recht as LagerRecht),
      );
    }
    // Standardmatrix des Plans: 36 Rechte Leitung, 17 Team, 20 Lesen (Katalog und Plan prüft rechte-katalog.test.ts)
    for (const [rolle, anzahl] of [
      ["leitung", 36],
      ["team", 17],
      ["lesen", 20],
    ] as const) {
      expect(
        alle.filter((z) => z.rolle === rolle && z.erlaubt),
        rolle,
      ).toHaveLength(anzahl);
    }
  });

  test("fehlt eine Zeile, gilt der Standard; ein unbekanntes Recht ist verboten, auch mit Zeile", async () => {
    const id = await legeLager("aktiv", false);
    expect(await zeilen(id)).toHaveLength(0);
    for (const konto of [leitung, team, lesen]) {
      const zugriff = (await ladeLagerZugriff(db, person(konto), id))!;
      for (const r of LAGER_RECHTE) {
        expect(darf(zugriff, r), `${zugriff.rolle} ${r}`).toBe(
          standardErlaubt(zugriff.rolle, r),
        );
      }
    }
    await db.insert(schema.lagerRolleRecht).values({
      lagerId: id,
      rolle: "team",
      recht: "gibt.es.nicht",
      erlaubt: true,
    });
    const zugriff = (await ladeLagerZugriff(db, person(team), id))!;
    expect(darf(zugriff, "gibt.es.nicht" as LagerRecht)).toBe(false);
    const liste = (await (
      await anfrage(lagerleitung, "GET", `${LAGER}/${id}/rechte`)
    ).json()) as { rechte: { recht: string }[] };
    expect(liste.rechte.map((r) => r.recht)).toEqual(LAGER_RECHTE);
  });

  test("die Datenbank hält die Regel «Lagerleitung nicht einstellbar» auch ohne die Routen", async () => {
    const id = await legeLager();
    await expect(
      db.insert(schema.lagerRolleRecht).values({
        lagerId: id,
        rolle: "lagerleitung" as "leitung",
        recht: "wetter.lesen",
        erlaubt: false,
      }),
    ).rejects.toThrow();
  });

  test("das Lager nimmt seine Einstellungen mit", async () => {
    const id = await legeLager();
    await db.delete(schema.lager).where(eq(schema.lager.id, id));
    expect(await zeilen(id)).toHaveLength(0);
  });
});

describe("Lesen der Rechtematrix", () => {
  test("Katalog mit Standard und aktuellem Wert für Leitung, Team und Lesen", async () => {
    const id = await legeLager();
    for (const konto of [lagerleitung, admin]) {
      const antwort = await anfrage(konto, "GET", `${LAGER}/${id}/rechte`);
      expect(antwort.status).toBe(200);
      const { rechte } = (await antwort.json()) as {
        rechte: {
          recht: LagerRecht;
          bedeutung: string;
          standard: Record<string, boolean>;
          aktuell: Record<string, boolean>;
        }[];
      };
      expect(rechte).toHaveLength(49);
      for (const eintrag of rechte) {
        expect(eintrag.bedeutung).toBe(RECHTE_KATALOG[eintrag.recht].bedeutung);
        expect(Object.keys(eintrag.aktuell)).toEqual([
          "leitung",
          "team",
          "lesen",
        ]);
        expect(eintrag.aktuell).toEqual(eintrag.standard);
      }
    }
  });

  test("Leitung, Team, Lesen und Nicht-Mitglieder lesen sie nicht", async () => {
    const id = await legeLager();
    for (const [konto, erwartet] of [
      [leitung, 403],
      [team, 403],
      [lesen, 403],
      [eltern, 404],
      [demoAdmin, 404],
    ] as const) {
      expect(
        (await anfrage(konto, "GET", `${LAGER}/${id}/rechte`)).status,
      ).toBe(erwartet);
    }
  });
});

describe("Ändern der Rechte", () => {
  test("eine Änderung wirkt bei der nächsten Anfrage, nur in diesem Lager, und das Zurücksetzen stellt den Standard her", async () => {
    const id = await legeLager();
    const anderes = await legeLager();
    // Standard: Team liest nicht alle Aufgaben, Leitung bearbeitet sie
    expect(await beispielStatus("team", "GET", id)).toBe(403);
    expect(await beispielStatus("leitung", "POST", id)).toBe(204);

    const antwort = await anfrage(
      lagerleitung,
      "PUT",
      `${LAGER}/${id}/rechte`,
      {
        rechte: [
          recht("team", "aufgaben.lesen_alle", true),
          recht("leitung", "aufgaben.bearbeiten", false),
        ],
      },
    );
    expect(antwort.status).toBe(204);
    expect(await beispielStatus("team", "GET", id)).toBe(200);
    expect(await beispielStatus("leitung", "POST", id)).toBe(403);
    // Andere Rollen bleiben, die Lagerleitung hat weiter alles
    expect(await beispielStatus("lesen", "GET", id)).toBe(200);
    expect(await beispielStatus("lesen", "POST", id)).toBe(403);
    expect(await beispielStatus("lagerleitung", "POST", id)).toBe(204);
    // Das andere Lager der Abteilung ist unverändert
    expect(await beispielStatus("team", "GET", anderes)).toBe(403);
    expect(await beispielStatus("leitung", "POST", anderes)).toBe(204);

    const gelesen = (await (
      await anfrage(lagerleitung, "GET", `${LAGER}/${id}/rechte`)
    ).json()) as {
      rechte: {
        recht: string;
        aktuell: Record<string, boolean>;
        standard: Record<string, boolean>;
      }[];
    };
    const lesen_alle = gelesen.rechte.find(
      (r) => r.recht === "aufgaben.lesen_alle",
    )!;
    expect(lesen_alle.aktuell.team).toBe(true);
    expect(lesen_alle.standard.team).toBe(false);

    const zurueck = await anfrage(
      lagerleitung,
      "POST",
      `${LAGER}/${id}/rechte/zuruecksetzen`,
    );
    expect(zurueck.status).toBe(204);
    expect(await beispielStatus("team", "GET", id)).toBe(403);
    expect(await beispielStatus("leitung", "POST", id)).toBe(204);
    for (const z of await zeilen(id)) {
      expect(z.erlaubt, `${z.rolle} ${z.recht}`).toBe(
        standardErlaubt(z.rolle, z.recht as LagerRecht),
      );
    }
  });

  test("die Abteilungsleitung ändert über beide Pfade, auch ohne Mitgliedschaft", async () => {
    const id = await legeLager();
    expect(
      (
        await anfrage(admin, "PUT", `${ADMIN}/${id}/rechte`, {
          rechte: [recht("lesen", "aufgaben.bearbeiten", true)],
        })
      ).status,
    ).toBe(204);
    expect(await beispielStatus("lesen", "POST", id)).toBe(204);
    expect(
      (
        await anfrage(admin, "PUT", `${LAGER}/${id}/rechte`, {
          rechte: [recht("lesen", "aufgaben.bearbeiten", false)],
        })
      ).status,
    ).toBe(204);
    expect(await beispielStatus("lesen", "POST", id)).toBe(403);
    expect(
      (await anfrage(admin, "POST", `${ADMIN}/${id}/rechte/zuruecksetzen`))
        .status,
    ).toBe(204);
    const gelesen = await anfrage(admin, "GET", `${ADMIN}/${id}/rechte`);
    expect(gelesen.status).toBe(200);
  });

  test("ohne Zeilen schreibt die Änderung die Zeile, das Zurücksetzen füllt die Matrix", async () => {
    const id = await legeLager("aktiv", false);
    await anfrage(lagerleitung, "PUT", `${LAGER}/${id}/rechte`, {
      rechte: [recht("team", "wetter.lesen", false)],
    });
    expect(await zeilen(id)).toHaveLength(1);
    await anfrage(lagerleitung, "POST", `${LAGER}/${id}/rechte/zuruecksetzen`);
    expect(await zeilen(id)).toHaveLength(3 * 49);
  });

  test("Audit-Log je geänderten Wert mit Rolle, Recht und Wert, ohne Inhalte; ein unveränderter Wert schreibt nichts", async () => {
    const id = await legeLager();
    await anfrage(lagerleitung, "PUT", `${LAGER}/${id}/rechte`, {
      rechte: [
        recht("team", "aufgaben.lesen_alle", true),
        recht("leitung", "aufgaben.bearbeiten", false),
        // Standard: bleibt, kein Eintrag
        recht("team", "wetter.lesen", true),
      ],
    });
    const eintraege = await auditZeilen(id);
    expect(eintraege.map((e) => e.details)).toEqual(
      expect.arrayContaining([
        { rolle: "team", recht: "aufgaben.lesen_alle", erlaubt: true },
        { rolle: "leitung", recht: "aufgaben.bearbeiten", erlaubt: false },
      ]),
    );
    expect(eintraege).toHaveLength(2);
    // Zurücksetzen protokolliert genau die zwei Rückänderungen
    await anfrage(lagerleitung, "POST", `${LAGER}/${id}/rechte/zuruecksetzen`);
    expect(await auditZeilen(id)).toHaveLength(4);
  });
});

describe("Eskalationsversuche", () => {
  const eingaben: [string, Record<string, unknown>][] = [
    [
      "Rolle lagerleitung",
      { rechte: [recht("lagerleitung", "wetter.lesen", false)] },
    ],
    ["unbekannte Rolle", { rechte: [recht("admin", "wetter.lesen", true)] }],
    [
      "Recht ausserhalb des Katalogs",
      { rechte: [recht("team", "admin.alles", true)] },
    ],
    [
      "Prototyp-Schlüssel als Recht",
      { rechte: [recht("team", "constructor", true)] },
    ],
    [
      "doppeltes Paar",
      {
        rechte: [
          recht("team", "wetter.lesen", true),
          recht("team", "wetter.lesen", false),
        ],
      },
    ],
    ["leere Liste", { rechte: [] }],
    [
      "Wert kein Boolean",
      { rechte: [recht("team", "wetter.lesen", "ja" as never)] },
    ],
    [
      "unbekanntes Feld im Eintrag",
      { rechte: [{ ...recht("team", "wetter.lesen", true), lagerId: "x" }] },
    ],
    ["unbekanntes Feld im Body", { rechte: [], lagerId: "x" }],
  ];

  test.each(eingaben)("%s: 400, nichts geändert", async (_name, body) => {
    const id = await legeLager();
    for (const pfad of [`${LAGER}/${id}/rechte`, `${ADMIN}/${id}/rechte`]) {
      const konto = pfad.startsWith(ADMIN) ? admin : lagerleitung;
      expect((await anfrage(konto, "PUT", pfad, body)).status).toBe(400);
    }
    for (const z of await zeilen(id)) {
      expect(z.erlaubt).toBe(standardErlaubt(z.rolle, z.recht as LagerRecht));
    }
    expect(await auditZeilen(id)).toHaveLength(0);
  });

  test("Leitung, Team und Lesen ändern nichts, auch nicht ihre eigenen Rechte", async () => {
    const id = await legeLager();
    for (const [konto, rolle] of [
      [leitung, "leitung"],
      [team, "team"],
      [lesen, "lesen"],
    ] as const) {
      const body = { rechte: [recht(rolle, "ressorts.bearbeiten", true)] };
      expect(
        (await anfrage(konto, "PUT", `${LAGER}/${id}/rechte`, body)).status,
      ).toBe(403);
      expect(
        (await anfrage(konto, "PUT", `${ADMIN}/${id}/rechte`, body)).status,
      ).toBe(403);
      expect(
        (await anfrage(konto, "POST", `${LAGER}/${id}/rechte/zuruecksetzen`))
          .status,
      ).toBe(403);
    }
    expect(await beispielStatus("lesen", "POST", id)).toBe(403);
    expect(await auditZeilen(id)).toHaveLength(0);
    for (const z of await zeilen(id)) {
      expect(z.erlaubt).toBe(standardErlaubt(z.rolle, z.recht as LagerRecht));
    }
  });

  test("die Lagerleitung lässt sich nicht aussperren: Alle Rechte aller Rollen aus, sie hat weiter alles und ändert weiter", async () => {
    const id = await legeLager();
    const alle = ["leitung", "team", "lesen"].flatMap((rolle) =>
      LAGER_RECHTE.map((r) => recht(rolle, r, false)),
    );
    expect(
      (
        await anfrage(lagerleitung, "PUT", `${LAGER}/${id}/rechte`, {
          rechte: alle,
        })
      ).status,
    ).toBe(204);
    const zugriff = (await ladeLagerZugriff(db, person(lagerleitung), id))!;
    for (const r of LAGER_RECHTE) expect(darf(zugriff, r), r).toBe(true);
    expect(await beispielStatus("lagerleitung", "POST", id)).toBe(204);
    // Die anderen Rollen verlieren alles, auch die Rechte, die die Rechte ändern: Das hat nie eine von ihnen
    for (const konto of [leitung, team, lesen]) {
      const z = (await ladeLagerZugriff(db, person(konto), id))!;
      for (const r of LAGER_RECHTE)
        expect(darf(z, r), `${z.rolle} ${r}`).toBe(false);
    }
    expect(
      (await anfrage(lagerleitung, "GET", `${LAGER}/${id}/rechte`)).status,
    ).toBe(200);
    expect(
      (
        await anfrage(
          lagerleitung,
          "POST",
          `${LAGER}/${id}/rechte/zuruecksetzen`,
        )
      ).status,
    ).toBe(204);
    expect(await beispielStatus("leitung", "POST", id)).toBe(204);
  });

  test("ein fremdes Lager ist unbekannt (404), die Einstellungen eines Lagers ändern nie ein anderes", async () => {
    const id = await legeLager();
    const fremd = await legeLager("aktiv", true, welt.demoAbteilungId);
    const body = { rechte: [recht("team", "wetter.lesen", false)] };
    for (const pfad of [
      `${LAGER}/${fremd}/rechte`,
      `${ADMIN}/${fremd}/rechte`,
    ]) {
      for (const konto of [lagerleitung, admin]) {
        expect((await anfrage(konto, "PUT", pfad, body)).status).toBe(404);
        expect((await anfrage(konto, "GET", pfad)).status).toBe(404);
      }
    }
    // Die Admin der fremden Abteilung ändert unser Lager nicht
    expect(
      (await anfrage(demoAdmin, "PUT", `${ADMIN}/${id}/rechte`, body)).status,
    ).toBe(404);
    expect(
      (await zeilen(fremd)).every(
        (z) => z.erlaubt === standardErlaubt(z.rolle, z.recht as LagerRecht),
      ),
    ).toBe(true);
    // Unbekannte und ungültige IDs
    expect(
      (await anfrage(admin, "GET", `${ADMIN}/${crypto.randomUUID()}/rechte`))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(admin, "GET", `${ADMIN}/keine-id/rechte`)).status,
    ).toBe(400);
    expect(
      (await anfrage(lagerleitung, "GET", `${LAGER}/keine-id/rechte`)).status,
    ).toBe(400);
  });

  test("ein abgeschlossenes Lager ist schreibgeschützt: 409, nichts geändert; lesen geht", async () => {
    const id = await legeLager("abgeschlossen");
    const body = { rechte: [recht("team", "wetter.lesen", false)] };
    for (const [konto, pfad] of [
      [lagerleitung, `${LAGER}/${id}/rechte`],
      [admin, `${LAGER}/${id}/rechte`],
      [admin, `${ADMIN}/${id}/rechte`],
    ] as const) {
      const antwort = await anfrage(konto, "PUT", pfad, body);
      expect(antwort.status).toBe(409);
      expect(await antwort.json()).toMatchObject({ code: "LAGER_GESCHLOSSEN" });
      expect(
        (await anfrage(konto, "POST", `${pfad}/zuruecksetzen`)).status,
      ).toBe(409);
      expect((await anfrage(konto, "GET", pfad)).status).toBe(200);
    }
    expect(await auditZeilen(id)).toHaveLength(0);
    for (const z of await zeilen(id)) {
      expect(z.erlaubt).toBe(standardErlaubt(z.rolle, z.recht as LagerRecht));
    }
  });
});
