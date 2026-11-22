import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
let konten: Record<LagerPersona, PersonaKonto>;
let lagerId: string;
let geschlossenId: string;
let fremdLagerId: string;
let andereLagerId: string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function legeLager(
  abteilungId: string,
  status: "aktiv" | "abgeschlossen" = "aktiv",
) {
  const [zeile] = await db
    .insert(schema.lager)
    .values({
      abteilungId,
      titel: "Ressortlager",
      von: "2027-07-10",
      bis: "2027-07-24",
      status,
    })
    .returning({ id: schema.lager.id });
  return zeile!.id;
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
  lagerId = await legeLager(welt.testabteilungId);
  geschlossenId = await legeLager(welt.testabteilungId, "abgeschlossen");
  andereLagerId = await legeLager(welt.testabteilungId);
  fremdLagerId = await legeLager(welt.demoAbteilungId);
  for (const id of [lagerId, geschlossenId, andereLagerId]) {
    // Die falsche Zeile der fremden Abteilung gibt nichts frei
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
      await db.insert(schema.lagerMitglied).values({
        lagerId: id,
        personId: konten[persona].id!,
        rolle,
      });
    }
  }
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
const leiter = () => konten.lagerleitung;
const kuerzel = () => `K${randomUUID().slice(0, 8)}`;
async function neu(werte: Record<string, unknown> = {}, id = lagerId) {
  const a = await anfrage(leiter(), "POST", `${L(id)}/ressorts`, {
    kuerzel: kuerzel(),
    name: "Ressort",
    ...werte,
  });
  expect(a.status).toBe(201);
  return a.body as {
    id: string;
    version: number;
    reihenfolge: number;
    kuerzel: string;
  };
}
async function mitglied(abteilungId = welt.testabteilungId, lager = lagerId) {
  const [p] = await db
    .insert(schema.user)
    .values({
      name: "Mitglied Test",
      email: `${randomUUID()}@example.org`,
      username: `m.${randomUUID().slice(0, 8)}`,
      abteilungId,
      mussPasswortAendern: false,
    })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.lagerMitglied)
    .values({ lagerId: lager, personId: p!.id, rolle: "team" });
  return p!.id;
}

describe("Rechte je Lager-Persona", () => {
  // Lesen: Lagerleitung, Abteilungsleitung, Leitung, Lesen; Team hat ressorts.lesen im Standard nicht. Schreiben: nur Lagerleitung und Abteilungsleitung
  const lesen: Record<LagerPersona, number> = {
    abteilungsleitung: 200,
    lagerleitung: 200,
    leitung: 200,
    team: 403,
    lesen: 200,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };
  const schreiben: Record<LagerPersona, number> = {
    abteilungsleitung: 201,
    lagerleitung: 201,
    leitung: 403,
    team: 403,
    lesen: 403,
    ohneMitgliedschaft: 404,
    fremdeAbteilung: 404,
    ohneLogin: 401,
  };

  test.each(LAGER_PERSONAS)("%s: Liste lesen", async (p) => {
    const a = await anfrage(konten[p], "GET", `${L()}/ressorts`);
    expect(a.status).toBe(lesen[p]);
  });

  test.each(LAGER_PERSONAS)(
    "%s: Ressort, Link und Notiz anlegen",
    async (p) => {
      const r = await neu();
      const ressort = await anfrage(konten[p], "POST", `${L()}/ressorts`, {
        kuerzel: kuerzel(),
        name: "X",
      });
      const link = await anfrage(
        konten[p],
        "POST",
        `${L()}/ressorts/${r.id}/links`,
        { titel: "Link", url: "https://example.org" },
      );
      const notiz = await anfrage(
        konten[p],
        "POST",
        `${L()}/ressorts/${r.id}/notizen`,
        { text: "Notiz" },
      );
      expect([ressort.status, link.status, notiz.status]).toEqual([
        schreiben[p],
        schreiben[p],
        schreiben[p],
      ]);
    },
  );

  test("abgeschlossenes Lager: schreiben 409, lesen 200", async () => {
    const [zeile] = await db
      .insert(schema.ressort)
      .values({
        lagerId: geschlossenId,
        kuerzel: kuerzel(),
        name: "Alt",
        lagerSeq: 0,
      })
      .returning({ id: schema.ressort.id });
    const post = await anfrage(
      leiter(),
      "POST",
      `${L(geschlossenId)}/ressorts`,
      {
        kuerzel: kuerzel(),
        name: "X",
      },
    );
    expect(post.status).toBe(409);
    expect(post.body.code).toBe("LAGER_GESCHLOSSEN");
    const del = await anfrage(
      konten.abteilungsleitung,
      "DELETE",
      `${L(geschlossenId)}/ressorts/${zeile!.id}?version=1`,
    );
    expect(del.status).toBe(409);
    const get = await anfrage(
      konten.lesen,
      "GET",
      `${L(geschlossenId)}/ressorts/${zeile!.id}`,
    );
    expect(get.status).toBe(200);
  });

  test("Lager der fremden Abteilung: 404, auch für die Lagerleitung des anderen Lagers", async () => {
    const a = await anfrage(leiter(), "GET", `${L(fremdLagerId)}/ressorts`);
    expect(a.status).toBe(404);
    const b = await anfrage(
      konten.abteilungsleitung,
      "POST",
      `${L(fremdLagerId)}/ressorts`,
      { kuerzel: kuerzel(), name: "X" },
    );
    expect(b.status).toBe(404);
  });
});

describe("Ruhige Ressorts (#520)", () => {
  test("ruhig ist anfangs falsch, lässt sich setzen und wieder lösen", async () => {
    const r = await neu();
    const lese = (konto = konten.lesen) =>
      anfrage(konto, "GET", `${L()}/ressorts/${r.id}`);
    expect((await lese()).body.ruhig).toBe(false);
    const a = await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
      version: r.version,
      ruhig: true,
    });
    expect(a.status).toBe(200);
    expect(a.body.ruhig).toBe(true);
    expect((await lese()).body.ruhig).toBe(true);
    const b = await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
      version: a.body.version,
      ruhig: false,
    });
    expect(b.body.ruhig).toBe(false);
    // Beim Anlegen
    const c = await neu({ ruhig: true });
    expect(
      (await anfrage(leiter(), "GET", `${L()}/ressorts/${c.id}`)).body.ruhig,
    ).toBe(true);
  });

  test("nur ein Boolean ist gültig, das Team darf es nicht setzen", async () => {
    const r = await neu();
    for (const wert of ["ja", 1, null]) {
      const a = await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
        version: r.version,
        ruhig: wert,
      });
      expect(a.status).toBe(400);
    }
    const t = await anfrage(konten.team, "PATCH", `${L()}/ressorts/${r.id}`, {
      version: r.version,
      ruhig: true,
    });
    expect(t.status).toBe(403);
  });
});

describe("Ressort anlegen und lesen", () => {
  test("legt an, löst die Namen auf und hängt ans Ende", async () => {
    const leit = await mitglied();
    const stv = await mitglied();
    const a = await neu({ leitungPersonId: leit, stvPersonId: stv });
    const b = await neu();
    expect(b.reihenfolge).toBe(a.reihenfolge + 1);
    expect(a.version).toBe(1);
    const lese = await anfrage(konten.lesen, "GET", `${L()}/ressorts/${a.id}`);
    expect(lese.status).toBe(200);
    expect(lese.body).toMatchObject({
      leitungPersonId: leit,
      stvPersonId: stv,
      leitung: { id: leit, name: "Mitglied Test" },
      stv: { id: stv },
      parentId: null,
    });
  });

  test("Umbenennen einer Person bricht keine Verknüpfung", async () => {
    const leit = await mitglied();
    const r = await neu({ leitungPersonId: leit });
    await db
      .update(schema.user)
      .set({ name: "Neuer Name", ceviName: "Biber" })
      .where(eq(schema.user.id, leit));
    const a = await anfrage(leiter(), "GET", `${L()}/ressorts/${r.id}`);
    expect(a.body.leitungPersonId).toBe(leit);
    expect(a.body.leitung).toEqual({
      id: leit,
      name: "Neuer Name",
      ceviName: "Biber",
    });
  });

  test("Leitung und Stellvertretung müssen Mitglieder des Lagers sein", async () => {
    const nichtMitglied = konten.ohneMitgliedschaft.id!;
    const fremd = await mitglied(welt.demoAbteilungId, fremdLagerId);
    const anderes = await mitglied(welt.testabteilungId, andereLagerId);
    for (const person of [nichtMitglied, fremd, anderes, randomUUID()]) {
      for (const feld of ["leitungPersonId", "stvPersonId"]) {
        const a = await anfrage(leiter(), "POST", `${L()}/ressorts`, {
          kuerzel: kuerzel(),
          name: "X",
          [feld]: person,
        });
        expect(a.status).toBe(400);
        expect(a.body.code).toBe("KEIN_MITGLIED");
      }
    }
  });

  test("Kürzel ist je Lager eindeutig, ohne Gross- und Kleinschreibung, und nach dem Löschen wieder frei", async () => {
    const k = kuerzel();
    const r = await neu({ kuerzel: k.toLowerCase() });
    const doppelt = await anfrage(leiter(), "POST", `${L()}/ressorts`, {
      kuerzel: k.toUpperCase(),
      name: "X",
    });
    expect(doppelt.status).toBe(409);
    expect(doppelt.body.code).toBe("KUERZEL_VERGEBEN");
    // In einem anderen Lager ist es frei
    await neu({ kuerzel: k }, andereLagerId);
    const del = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/ressorts/${r.id}?version=${r.version}`,
    );
    expect(del.status).toBe(204);
    await neu({ kuerzel: k });
  });

  test("strikte Eingabe: unbekannte Felder und Systemfelder werden abgelehnt", async () => {
    for (const extra of [
      { lagerId: andereLagerId },
      { version: 5 },
      { geloeschtAm: "2027-01-01" },
      { id: randomUUID() },
    ]) {
      const a = await anfrage(leiter(), "POST", `${L()}/ressorts`, {
        kuerzel: kuerzel(),
        name: "X",
        ...extra,
      });
      expect(a.status).toBe(400);
    }
    for (const body of [
      { kuerzel: "", name: "X" },
      { kuerzel: "x".repeat(21), name: "X" },
      { kuerzel: "K", name: "x".repeat(101) },
      { kuerzel: "K" },
    ]) {
      expect(
        (await anfrage(leiter(), "POST", `${L()}/ressorts`, body)).status,
      ).toBe(400);
    }
  });

  test("Liste: Seitenwechsel mit Cursor, sortiert nach Reihenfolge", async () => {
    const lager = await legeLager(welt.testabteilungId);
    await db.insert(schema.lagerMitglied).values({
      lagerId: lager,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await neu({}, lager)).id);
    const seite1 = await anfrage(
      leiter(),
      "GET",
      `${L(lager)}/ressorts?limit=2`,
    );
    expect(seite1.body.ressorts.map((r: { id: string }) => r.id)).toEqual(
      ids.slice(0, 2),
    );
    const seite2 = await anfrage(
      leiter(),
      "GET",
      `${L(lager)}/ressorts?limit=2&nach=${seite1.body.naechster}`,
    );
    expect(seite2.body.ressorts.map((r: { id: string }) => r.id)).toEqual(
      ids.slice(2, 4),
    );
    const seite3 = await anfrage(
      leiter(),
      "GET",
      `${L(lager)}/ressorts?limit=2&nach=${seite2.body.naechster}`,
    );
    expect(seite3.body.ressorts).toHaveLength(1);
    expect(seite3.body.naechster).toBeNull();
    // Ein unbekannter Cursor liefert nichts statt alles
    const leer = await anfrage(
      leiter(),
      "GET",
      `${L(lager)}/ressorts?nach=${randomUUID()}`,
    );
    expect(leer.body.ressorts).toEqual([]);
    // Ein Ressort eines anderen Lagers ist als Cursor nutzlos
    const fremder = await neu({}, andereLagerId);
    const quer = await anfrage(
      leiter(),
      "GET",
      `${L(lager)}/ressorts?nach=${fremder.id}`,
    );
    expect(quer.body.ressorts).toEqual([]);
  });

  test("ein Ressort eines anderen Lagers ist 404", async () => {
    const r = await neu({}, andereLagerId);
    for (const [methode, pfad, body] of [
      ["GET", `${L()}/ressorts/${r.id}`],
      ["PATCH", `${L()}/ressorts/${r.id}`, { version: 1, name: "X" }],
      ["DELETE", `${L()}/ressorts/${r.id}?version=1`],
      ["GET", `${L()}/ressorts/${r.id}/links`],
      ["POST", `${L()}/ressorts/${r.id}/notizen`, { text: "x" }],
    ] as const) {
      const a = await anfrage(leiter(), methode, pfad, body);
      expect(a.status, `${methode} ${pfad}`).toBe(404);
    }
  });
});

describe("Ressort ändern, Baum und Reihenfolge", () => {
  test("ändert Felder, zählt die Version und meldet im Feed", async () => {
    const seq0 = (await anfrage(leiter(), "GET", `${L()}/aenderungen`)).body
      .seq as number;
    const r = await neu();
    const a = await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
      version: r.version,
      name: "Küche",
      notiz: "Für alle Mahlzeiten",
    });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ name: "Küche", version: 2 });
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L()}/aenderungen?seit=${seq0}&limit=500`,
    );
    const meine = feed.body.eintraege.filter(
      (e: { id: string }) => e.id === r.id,
    );
    expect(meine.map((e: { art: string }) => e.art)).toEqual([
      "neu",
      "geaendert",
    ]);
    expect(meine[0].objekttyp).toBe("ressort");
    // Team hat ressorts.lesen nicht: Der Feed nennt ihm nichts davon
    const teamFeed = await anfrage(
      konten.team,
      "GET",
      `${L()}/aenderungen?seit=${seq0}&limit=500`,
    );
    expect(
      teamFeed.body.eintraege.filter((e: { objekttyp: string }) =>
        e.objekttyp.startsWith("ressort"),
      ),
    ).toEqual([]);
  });

  test("Versionskonflikt: 409 mit aktuellem Stand und abweichenden Feldern", async () => {
    const r = await neu({ name: "Alt" });
    await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
      version: 1,
      name: "Zwei",
    });
    const a = await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
      version: 1,
      name: "Drei",
    });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("VERSION_KONFLIKT");
    expect(a.body.aktuell).toMatchObject({ name: "Zwei", version: 2 });
    expect(a.body.abweichend).toEqual(["name"]);
  });

  test("PATCH ohne Änderung oder ohne Version ist 400, null leert Felder", async () => {
    const leit = await mitglied();
    const r = await neu({ leitungPersonId: leit, notiz: "x" });
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
          version: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
          name: "x",
        })
      ).status,
    ).toBe(400);
    const a = await anfrage(leiter(), "PATCH", `${L()}/ressorts/${r.id}`, {
      version: 1,
      leitungPersonId: null,
      notiz: null,
    });
    expect(a.body).toMatchObject({
      leitungPersonId: null,
      leitung: null,
      notiz: null,
    });
  });

  test("Unterressorts: Baum ohne Zyklen", async () => {
    const a = await neu();
    const b = await neu({ parentId: a.id });
    const c = await neu({ parentId: b.id });
    const zyklus = async (id: string, version: number, parentId: string) =>
      anfrage(leiter(), "PATCH", `${L()}/ressorts/${id}`, {
        version,
        parentId,
      });
    // Unter sich selbst, unter dem Kind, unter dem Enkel
    for (const [id, parent] of [
      [a.id, a.id],
      [a.id, b.id],
      [a.id, c.id],
      [b.id, c.id],
    ]) {
      const z = await zyklus(id!, 1, parent!);
      expect(z.status, `${id} unter ${parent}`).toBe(400);
      expect(z.body.code).toBe("RESSORT_ZYKLUS");
    }
    // Ein unbekanntes oder fremdes übergeordnetes Ressort
    const fremd = await neu({}, andereLagerId);
    for (const parent of [randomUUID(), fremd.id]) {
      const z = await anfrage(leiter(), "POST", `${L()}/ressorts`, {
        kuerzel: kuerzel(),
        name: "X",
        parentId: parent,
      });
      expect(z.status).toBe(400);
      expect(z.body.code).toBe("RESSORT_UNBEKANNT");
    }
    // Verschieben an die Wurzel und unter ein anderes Ressort geht
    const d = await neu();
    const ok = await zyklus(c.id, 1, d.id);
    expect(ok.status).toBe(200);
    expect(ok.body.parentId).toBe(d.id);
  });

  test("zwei gleichzeitige Verschiebungen bauen keinen Zyklus", async () => {
    const a = await neu();
    const b = await neu();
    const [x, y] = await Promise.all([
      anfrage(leiter(), "PATCH", `${L()}/ressorts/${a.id}`, {
        version: 1,
        parentId: b.id,
      }),
      anfrage(leiter(), "PATCH", `${L()}/ressorts/${b.id}`, {
        version: 1,
        parentId: a.id,
      }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 400]);
  });

  test("Löschen: nicht mit Unterressorts, danach 404, nicht mehr in der Liste, Feed meldet «geloescht»", async () => {
    const seq0 = (await anfrage(leiter(), "GET", `${L()}/aenderungen`)).body
      .seq as number;
    const eltern = await neu();
    const kind = await neu({ parentId: eltern.id });
    const mit = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/ressorts/${eltern.id}?version=1`,
    );
    expect(mit.status).toBe(409);
    expect(mit.body.code).toBe("RESSORT_HAT_UNTERRESSORTS");
    // Falsche Version: Konflikt
    const falsch = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/ressorts/${kind.id}?version=7`,
    );
    expect(falsch.status).toBe(409);
    expect(falsch.body.code).toBe("VERSION_KONFLIKT");
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L()}/ressorts/${kind.id}?version=1`,
        )
      ).status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "GET", `${L()}/ressorts/${kind.id}`)).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L()}/ressorts/${kind.id}?version=2`,
        )
      ).status,
    ).toBe(404);
    const liste = await anfrage(leiter(), "GET", `${L()}/ressorts?limit=200`);
    expect(liste.body.ressorts.map((r: { id: string }) => r.id)).not.toContain(
      kind.id,
    );
    const feed = await anfrage(
      leiter(),
      "GET",
      `${L()}/aenderungen?seit=${seq0}&limit=500`,
    );
    expect(
      feed.body.eintraege
        .filter((e: { id: string }) => e.id === kind.id)
        .map((e: { art: string }) => e.art),
    ).toEqual(["neu", "geloescht"]);
    // Die Zeile ist endgültig weg
    expect(
      await db.$count(schema.ressort, eq(schema.ressort.id, kind.id)),
    ).toBe(0);
    // Mit dem Kind weg lässt sich das Elternteil löschen
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L()}/ressorts/${eltern.id}?version=1`,
        )
      ).status,
    ).toBe(204);
  });

  test("Reihenfolge ändern: nur was sich ändert, bekommt eine neue Version", async () => {
    const lager = await legeLager(welt.testabteilungId);
    await db.insert(schema.lagerMitglied).values({
      lagerId: lager,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const [a, b, c] = [
      await neu({}, lager),
      await neu({}, lager),
      await neu({}, lager),
    ];
    const ok = await anfrage(
      leiter(),
      "PUT",
      `${L(lager)}/ressorts/reihenfolge`,
      {
        eintraege: [
          { id: a.id, version: 1 },
          { id: c.id, version: 1 },
          { id: b.id, version: 1 },
        ],
      },
    );
    expect(ok.status).toBe(204);
    const liste = await anfrage(leiter(), "GET", `${L(lager)}/ressorts`);
    expect(
      liste.body.ressorts.map((r: { id: string; version: number }) => [
        r.id,
        r.version,
      ]),
    ).toEqual([
      [a.id, 1],
      [c.id, 2],
      [b.id, 2],
    ]);
    // Ein veralteter Eintrag lässt alles unverändert
    const konflikt = await anfrage(
      leiter(),
      "PUT",
      `${L(lager)}/ressorts/reihenfolge`,
      {
        eintraege: [
          { id: b.id, version: 2 },
          { id: a.id, version: 1 },
          { id: c.id, version: 1 },
        ],
      },
    );
    expect(konflikt.status).toBe(409);
    const nachher = await anfrage(leiter(), "GET", `${L(lager)}/ressorts`);
    expect(nachher.body.ressorts.map((r: { id: string }) => r.id)).toEqual([
      a.id,
      c.id,
      b.id,
    ]);
    // Unbekannt, doppelt, leer
    for (const eintraege of [
      [{ id: randomUUID(), version: 1 }],
      [
        { id: a.id, version: 1 },
        { id: a.id, version: 1 },
      ],
      [],
    ]) {
      const a2 = await anfrage(
        leiter(),
        "PUT",
        `${L(lager)}/ressorts/reihenfolge`,
        {
          eintraege,
        },
      );
      expect(a2.status).toBe(eintraege.length === 1 ? 404 : 400);
    }
    // Ein Ressort eines anderen Lagers ist unbekannt
    const fremd = await neu({}, andereLagerId);
    expect(
      (
        await anfrage(leiter(), "PUT", `${L(lager)}/ressorts/reihenfolge`, {
          eintraege: [{ id: fremd.id, version: 1 }],
        })
      ).status,
    ).toBe(404);
  });
});

describe("Links", () => {
  test("nur https, ohne Zugangsdaten; der Server ruft nichts ab", async () => {
    const r = await neu();
    const url = `${L()}/ressorts/${r.id}/links`;
    const abruf = vi.spyOn(globalThis, "fetch");
    try {
      for (const schlecht of [
        "http://example.org",
        "javascript:alert(1)",
        "ftp://example.org",
        "https://user:pass@example.org",
        "//example.org",
        "example.org",
        "data:text/html,x",
        "https://example.org:8443/x",
        "https://127.0.0.1/x",
        "https://localhost/x",
        "https://example.org\\@evil.example/x",
        "https://example.org/a b",
        "https://exa\u202Emple.org/x",
        `https://example.org/${"x".repeat(2000)}`,
      ]) {
        const a = await anfrage(leiter(), "POST", url, {
          titel: "L",
          url: schlecht,
        });
        expect(a.status, schlecht).toBe(400);
      }
      const ok = await anfrage(leiter(), "POST", url, {
        titel: "Plan",
        url: "HTTPS://Example.org/Pfad?x=1",
      });
      expect(ok.status).toBe(201);
      expect(ok.body.url).toBe("https://example.org/Pfad?x=1");
      expect(abruf).not.toHaveBeenCalled();
    } finally {
      abruf.mockRestore();
    }
  });

  test("ändern, löschen, Seitenwechsel; ein Link eines anderen Ressorts ist 404", async () => {
    const r = await neu();
    const r2 = await neu();
    const link = async (titel: string, ressort = r.id) =>
      (
        await anfrage(leiter(), "POST", `${L()}/ressorts/${ressort}/links`, {
          titel,
          url: "https://example.org",
        })
      ).body;
    const [l1, l2, l3] = [
      await link("Eins"),
      await link("Zwei"),
      await link("Drei"),
    ];
    const s1 = await anfrage(
      konten.leitung,
      "GET",
      `${L()}/ressorts/${r.id}/links?limit=2`,
    );
    expect(s1.body.links.map((l: { id: string }) => l.id)).toEqual([
      l1.id,
      l2.id,
    ]);
    const s2 = await anfrage(
      konten.leitung,
      "GET",
      `${L()}/ressorts/${r.id}/links?limit=2&nach=${s1.body.naechster}`,
    );
    expect(s2.body.links.map((l: { id: string }) => l.id)).toEqual([l3.id]);
    expect(s2.body.naechster).toBeNull();

    const falsch = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/ressorts/${r2.id}/links/${l1.id}`,
      { version: 1, titel: "X" },
    );
    expect(falsch.status).toBe(404);
    const falschDel = await anfrage(
      leiter(),
      "DELETE",
      `${L()}/ressorts/${r2.id}/links/${l1.id}?version=1`,
    );
    expect(falschDel.status).toBe(404);

    const aend = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/ressorts/${r.id}/links/${l1.id}`,
      { version: 1, titel: "Neu" },
    );
    expect(aend.body).toMatchObject({ titel: "Neu", version: 2 });
    const konflikt = await anfrage(
      leiter(),
      "PATCH",
      `${L()}/ressorts/${r.id}/links/${l1.id}`,
      { version: 1, titel: "Alt" },
    );
    expect(konflikt.status).toBe(409);
    expect(
      (
        await anfrage(
          leiter(),
          "DELETE",
          `${L()}/ressorts/${r.id}/links/${l1.id}?version=2`,
        )
      ).status,
    ).toBe(204);
    const rest = await anfrage(
      leiter(),
      "GET",
      `${L()}/ressorts/${r.id}/links`,
    );
    expect(rest.body.links).toHaveLength(2);
  });
});

describe("Notizen", () => {
  test("neueste zuerst, mit dem Namen des Autors, Seitenwechsel, ändern, löschen", async () => {
    const r = await neu();
    const url = `${L()}/ressorts/${r.id}/notizen`;
    const n1 = (await anfrage(leiter(), "POST", url, { text: "Erste" })).body;
    const n2 = (
      await anfrage(konten.abteilungsleitung, "POST", url, { text: "Zweite" })
    ).body;
    expect(n1.vonPersonId).toBe(konten.lagerleitung.id);
    const s1 = await anfrage(konten.lesen, "GET", `${url}?limit=1`);
    expect(s1.body.notizen).toHaveLength(1);
    expect(s1.body.notizen[0]).toMatchObject({ id: n2.id, text: "Zweite" });
    expect(s1.body.notizen[0].von.id).toBe(konten.abteilungsleitung.id);
    const s2 = await anfrage(
      konten.lesen,
      "GET",
      `${url}?limit=1&nach=${s1.body.naechster}`,
    );
    expect(s2.body.notizen[0].id).toBe(n1.id);
    expect(s2.body.naechster).toBeNull();

    const aend = await anfrage(leiter(), "PATCH", `${url}/${n1.id}`, {
      version: 1,
      text: "Erste, ergänzt",
    });
    expect(aend.body).toMatchObject({ text: "Erste, ergänzt", version: 2 });
    // Der Autor bleibt
    expect(aend.body.vonPersonId).toBe(konten.lagerleitung.id);
    expect(
      (
        await anfrage(leiter(), "PATCH", `${url}/${n1.id}`, {
          version: 1,
          text: "x",
        })
      ).status,
    ).toBe(409);
    expect((await anfrage(leiter(), "POST", url, { text: "" })).status).toBe(
      400,
    );
    expect(
      (await anfrage(leiter(), "DELETE", `${url}/${n1.id}?version=2`)).status,
    ).toBe(204);
    expect(
      (await anfrage(leiter(), "DELETE", `${url}/${n1.id}?version=3`)).status,
    ).toBe(404);
  });
});

describe("Datenbank", () => {
  test("lager_mitglied.ressort_id: nur ein Ressort des eigenen Lagers, beim Löschen leer", async () => {
    const r = await neu();
    const fremd = await neu({}, andereLagerId);
    const personId = konten.team.id!;
    await expect(
      db
        .update(schema.lagerMitglied)
        .set({ ressortId: fremd.id })
        .where(
          and(
            eq(schema.lagerMitglied.lagerId, lagerId),
            eq(schema.lagerMitglied.personId, personId),
          ),
        ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await db
      .update(schema.lagerMitglied)
      .set({ ressortId: r.id })
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, personId),
        ),
      );
    // Hartes Löschen (zum Beispiel beim Leeren des Papierkorbs) lässt das Mitglied stehen
    await db.delete(schema.ressort).where(eq(schema.ressort.id, r.id));
    const [m] = await db
      .select()
      .from(schema.lagerMitglied)
      .where(
        and(
          eq(schema.lagerMitglied.lagerId, lagerId),
          eq(schema.lagerMitglied.personId, personId),
        ),
      );
    expect(m).toMatchObject({ rolle: "team", ressortId: null });
  });

  test("Lager löschen nimmt Ressorts, Links und Notizen mit", async () => {
    const lager = await legeLager(welt.testabteilungId);
    await db.insert(schema.lagerMitglied).values({
      lagerId: lager,
      personId: konten.lagerleitung.id!,
      rolle: "lagerleitung",
    });
    const kind = await neu({}, lager);
    const r = await neu({ parentId: kind.id }, lager);
    await anfrage(leiter(), "POST", `${L(lager)}/ressorts/${r.id}/links`, {
      titel: "L",
      url: "https://example.org",
    });
    await anfrage(leiter(), "POST", `${L(lager)}/ressorts/${r.id}/notizen`, {
      text: "N",
    });
    await db.delete(schema.lager).where(eq(schema.lager.id, lager));
    for (const t of [schema.ressort, schema.ressortLink, schema.ressortNotiz]) {
      expect(
        await db.select().from(t).where(eq(t.lagerId, lager)),
      ).toHaveLength(0);
    }
  });
});
