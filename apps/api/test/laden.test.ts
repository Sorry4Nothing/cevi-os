import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import {
  loescheAlteBestellungen,
  MAX_OFFENE_JE_PERSON,
  preisText,
} from "../src/laden/laden.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  PERSONAS,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

// Lädeli (#566): Rechte, Summen, Grenzen, Fremdabteilung, Stand, Löschfrist. Die Rechte je Persona und Route stehen zusätzlich in der Rechte-Matrix.
const fcm = bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const optionen = {
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  fcm,
  seiten: ladeSeiten(),
};
// Jede App zählt die Bestellversuche je Konto selbst: Eine frische App beginnt bei null
let app = erstelleApp(optionen);
afterAll(() => sql.end());

let welt: Welt;
let konten: Record<Persona, PersonaKonto>;
let admin: PersonaKonto;
let eltern: PersonaKonto;
let leitung: PersonaKonto;
let demoAdmin: PersonaKonto;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const liste = await Promise.all(PERSONAS.map((p) => legePersonaAn(welt, p)));
  konten = Object.fromEntries(
    PERSONAS.map((p, i) => [p, liste[i]]),
  ) as typeof konten;
  admin = konten.admin;
  eltern = konten.elternA;
  leitung = konten.leitendeA;
  demoAdmin = konten.demoAdmin;
});
beforeEach(async () => {
  app = erstelleApp(optionen);
  await db
    .delete(schema.ladenBestellung)
    .where(
      inArray(schema.ladenBestellung.abteilungId, [
        welt.testabteilungId,
        welt.demoAbteilungId,
      ]),
    );
  await db
    .delete(schema.ladenEinstellung)
    .where(eq(schema.ladenEinstellung.abteilungId, welt.testabteilungId));
});

const aufruf = (
  konto: PersonaKonto,
  methode: string,
  pfad: string,
  body?: unknown,
) =>
  app.request(`/api/v1${pfad}`, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;

async function neuerArtikel(
  werte: Partial<typeof schema.ladenArtikel.$inferInsert> = {},
) {
  const [a] = await db
    .insert(schema.ladenArtikel)
    .values({
      abteilungId: welt.testabteilungId,
      name: `Artikel ${randomUUID().slice(0, 8)}`,
      preisRappen: 1500,
      ...werte,
    })
    .returning();
  return a!;
}
const ABHOLUNG = "Abholung im Lädeli";
const bestelle = (
  konto: PersonaKonto,
  positionen: { artikelId: string; variante?: string | null; menge: number }[],
  mehr: Record<string, unknown> = {},
) =>
  aufruf(konto, "POST", "/laden/bestellungen", {
    positionen,
    uebergabe: ABHOLUNG,
    ...mehr,
  });

describe("Laden lesen", () => {
  test("jede angemeldete Person sieht Artikel, Übergabearten und Grenzen der eigenen Abteilung", async () => {
    const a = await neuerArtikel({ varianten: ["S", "M"], hinweis: "Hinweis" });
    const weg = await neuerArtikel({ verfuegbar: false });
    const fremd = await neuerArtikel({ abteilungId: welt.demoAbteilungId });
    const r = await aufruf(eltern, "GET", "/laden");
    expect(r.status).toBe(200);
    const d = await json(r);
    const ids = d.artikel.map((x: { id: string }) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(weg.id);
    expect(ids).not.toContain(fremd.id);
    expect(d.artikel.find((x: { id: string }) => x.id === a.id)).toEqual({
      id: a.id,
      name: a.name,
      preisRappen: 1500,
      mediumId: null,
      groessenart: "liste",
      varianten: ["S", "M"],
      hinweis: "Hinweis",
      verfuegbar: true,
      reihenfolge: 0,
    });
    expect(d.uebergabearten).toEqual([ABHOLUNG]);
    expect(d.grenzen).toEqual({
      positionen: 20,
      menge: 10,
      offeneBestellungen: MAX_OFFENE_JE_PERSON,
    });
  });

  test("ohne Sitzung 401", async () => {
    expect((await aufruf(konten.ohneLogin, "GET", "/laden")).status).toBe(401);
    expect(
      (
        await bestelle(konten.ohneLogin, [
          { artikelId: randomUUID(), menge: 1 },
        ])
      ).status,
    ).toBe(401);
  });
});

describe("Bestellen", () => {
  test("die Summe rechnet der Server aus den Artikeln; Name und Preis stehen als Stand der Bestellung in den Positionen", async () => {
    const pulli = await neuerArtikel({
      name: "Pulli",
      preisRappen: 4000,
      varianten: ["S", "M"],
    });
    const messer = await neuerArtikel({ name: "Messer", preisRappen: 2050 });
    const r = await bestelle(eltern, [
      { artikelId: pulli.id, variante: "M", menge: 2 },
      { artikelId: messer.id, menge: 3 },
    ]);
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.summeRappen).toBe(2 * 4000 + 3 * 2050);
    expect(b.status).toBe("offen");
    expect(b.uebergabe).toBe(ABHOLUNG);
    expect(b.positionen).toEqual([
      {
        artikelId: pulli.id,
        name: "Pulli",
        variante: "M",
        menge: 2,
        einzelpreisRappen: 4000,
      },
      {
        artikelId: messer.id,
        name: "Messer",
        variante: null,
        menge: 3,
        einzelpreisRappen: 2050,
      },
    ]);
    // Eine spätere Preisänderung verändert die Bestellung nicht
    await db
      .update(schema.ladenArtikel)
      .set({ preisRappen: 9999, name: "Anders" })
      .where(eq(schema.ladenArtikel.id, pulli.id));
    const meine = await json(
      await aufruf(eltern, "GET", "/laden/bestellungen/meine"),
    );
    expect(meine.bestellungen[0].summeRappen).toBe(14150);
    expect(meine.bestellungen[0].positionen[0].name).toBe("Pulli");
  });

  test("ein Preis oder eine Summe in der Anfrage wird abgelehnt (strenges Schema)", async () => {
    const a = await neuerArtikel();
    expect(
      (
        await bestelle(eltern, [
          { artikelId: a.id, menge: 1, einzelpreisRappen: 1 } as never,
        ])
      ).status,
    ).toBe(400);
    expect(
      (
        await bestelle(eltern, [{ artikelId: a.id, menge: 1 }], {
          summeRappen: 1,
        })
      ).status,
    ).toBe(400);
  });

  test("weicht die erwartete Summe ab, entsteht keine Bestellung (409 PREIS_GEAENDERT mit der neuen Summe)", async () => {
    const a = await neuerArtikel({ preisRappen: 1500 });
    const r = await bestelle(eltern, [{ artikelId: a.id, menge: 2 }], {
      erwarteteSummeRappen: 2000,
    });
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({
      code: "PREIS_GEAENDERT",
      summeRappen: 3000,
    });
    expect(
      (
        await bestelle(eltern, [{ artikelId: a.id, menge: 2 }], {
          erwarteteSummeRappen: 3000,
        })
      ).status,
    ).toBe(201);
  });

  test("Grenzen: Menge 1 bis 10, 1 bis 20 Positionen, keine doppelte Zeile", async () => {
    const a = await neuerArtikel();
    for (const menge of [0, 11, 1.5, -1]) {
      expect(
        (await bestelle(eltern, [{ artikelId: a.id, menge }])).status,
      ).toBe(400);
    }
    expect((await bestelle(eltern, [])).status).toBe(400);
    expect(
      (
        await bestelle(
          eltern,
          Array.from({ length: 21 }, () => ({ artikelId: a.id, menge: 1 })),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await bestelle(eltern, [
          { artikelId: a.id, menge: 1 },
          { artikelId: a.id, menge: 2 },
        ])
      ).status,
    ).toBe(400);
  });

  test("Varianten: Pflicht bei einem Artikel mit Varianten, verboten ohne, nur aus der Liste", async () => {
    const mit = await neuerArtikel({ varianten: ["S", "M"] });
    const ohne = await neuerArtikel();
    for (const p of [
      { artikelId: mit.id, menge: 1 },
      { artikelId: mit.id, variante: "XXL", menge: 1 },
      { artikelId: ohne.id, variante: "S", menge: 1 },
    ]) {
      const r = await bestelle(eltern, [p]);
      expect(r.status).toBe(400);
      expect((await json(r)).code).toBe("VARIANTE_UNGUELTIG");
    }
  });

  test("nicht verfügbare, unbekannte und fremde Artikel sind dasselbe: 409 mit ihren IDs", async () => {
    const weg = await neuerArtikel({ verfuegbar: false });
    const fremd = await neuerArtikel({ abteilungId: welt.demoAbteilungId });
    const unbekannt = randomUUID();
    const gut = await neuerArtikel();
    const r = await bestelle(eltern, [
      { artikelId: gut.id, menge: 1 },
      { artikelId: weg.id, menge: 1 },
      { artikelId: fremd.id, menge: 1 },
      { artikelId: unbekannt, menge: 1 },
    ]);
    expect(r.status).toBe(409);
    const d = await json(r);
    expect(d.code).toBe("ARTIKEL_NICHT_VERFUEGBAR");
    expect(d.artikelIds.sort()).toEqual([weg.id, fremd.id, unbekannt].sort());
    expect(await db.select().from(schema.ladenBestellung)).toHaveLength(0);
  });

  test("die Übergabe muss eine der eingestellten sein", async () => {
    const a = await neuerArtikel();
    const r = await bestelle(eltern, [{ artikelId: a.id, menge: 1 }], {
      uebergabe: "Per Post",
    });
    expect(r.status).toBe(400);
    expect((await json(r)).code).toBe("UEBERGABE_UNBEKANNT");
    expect(
      (
        await aufruf(admin, "PUT", "/admin/laden/einstellungen", {
          uebergabearten: [ABHOLUNG, "Am Elternabend"],
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await bestelle(eltern, [{ artikelId: a.id, menge: 1 }], {
          uebergabe: "Am Elternabend",
        })
      ).status,
    ).toBe(201);
  });

  test(`höchstens ${MAX_OFFENE_JE_PERSON} offene Bestellungen je Person, auch bei gleichzeitigen Anfragen`, async () => {
    const a = await neuerArtikel();
    const antworten = await Promise.all(
      Array.from({ length: MAX_OFFENE_JE_PERSON + 3 }, () =>
        bestelle(leitung, [{ artikelId: a.id, menge: 1 }]),
      ),
    );
    const status = antworten.map((r) => r.status).sort();
    expect(status.filter((s) => s === 201)).toHaveLength(MAX_OFFENE_JE_PERSON);
    expect(status.filter((s) => s === 409)).toHaveLength(3);
    const voll = antworten.find((r) => r.status === 409)!;
    expect((await json(voll)).code).toBe("BESTELL_LIMIT");
    // Eine andere Person ist davon nicht betroffen
    expect(
      (await bestelle(eltern, [{ artikelId: a.id, menge: 1 }])).status,
    ).toBe(201);
  });

  test("nach 10 Versuchen in 10 Minuten antwortet die Route 429", async () => {
    const a = await neuerArtikel();
    for (let i = 0; i < 10; i++) {
      // Ungültige Übergabe: zählt als Versuch, legt nichts an
      await bestelle(konten.slA, [{ artikelId: a.id, menge: 1 }], {
        uebergabe: "Gibt es nicht",
      });
    }
    expect(
      (await bestelle(konten.slA, [{ artikelId: a.id, menge: 1 }])).status,
    ).toBe(429);
  });
});

describe("Eigene Bestellungen", () => {
  test("die Liste zeigt nur die eigenen, neueste zuerst, seitenweise", async () => {
    const a = await neuerArtikel();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (await json(await bestelle(eltern, [{ artikelId: a.id, menge: 1 }])))
          .id,
      );
    }
    await bestelle(leitung, [{ artikelId: a.id, menge: 1 }]);
    const s1 = await json(
      await aufruf(eltern, "GET", "/laden/bestellungen/meine?limit=2"),
    );
    expect(s1.bestellungen.map((b: { id: string }) => b.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(s1.weitere).toBe(true);
    const s2 = await json(
      await aufruf(
        eltern,
        "GET",
        `/laden/bestellungen/meine?limit=2&nach=${s1.naechste}`,
      ),
    );
    expect(s2.bestellungen.map((b: { id: string }) => b.id)).toEqual([ids[0]]);
    expect(s2.weitere).toBe(false);
  });

  test("stornieren geht nur für die eigene offene Bestellung; fremde sind 404, auch für die Abteilungsleitung", async () => {
    const a = await neuerArtikel();
    const { id } = await json(
      await bestelle(eltern, [{ artikelId: a.id, menge: 1 }]),
    );
    const weg = (k: PersonaKonto) =>
      aufruf(k, "DELETE", `/laden/bestellungen/${id}`);
    expect((await weg(leitung)).status).toBe(404);
    expect((await weg(admin)).status).toBe(404);
    expect((await weg(demoAdmin)).status).toBe(404);
    expect((await weg(eltern)).status).toBe(204);
    // Ein zweites Mal ändert nichts
    expect((await weg(eltern)).status).toBe(204);
    const [zeile] = await db
      .select()
      .from(schema.ladenBestellung)
      .where(eq(schema.ladenBestellung.id, id));
    expect(zeile!.status).toBe("storniert");
    expect(zeile!.abgeschlossenAm).not.toBeNull();
  });

  test("eine bereitgestellte Bestellung storniert nur noch die Abteilung", async () => {
    const a = await neuerArtikel();
    const { id } = await json(
      await bestelle(eltern, [{ artikelId: a.id, menge: 1 }]),
    );
    await aufruf(admin, "POST", `/admin/laden/bestellungen/${id}/status`, {
      status: "bereit",
    });
    const r = await aufruf(eltern, "DELETE", `/laden/bestellungen/${id}`);
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe("STATUS_UNGUELTIG");
  });
});

describe("Verwaltung", () => {
  test("nur die Abteilungsleitung mit zweitem Faktor; alle anderen 403", async () => {
    for (const p of [
      "adminOhneZweitenFaktor",
      "slA",
      "leitendeA",
      "elternA",
    ] as const) {
      for (const [m, pfad, body] of [
        ["GET", "/admin/laden/artikel"],
        [
          "POST",
          "/admin/laden/artikel",
          { name: "X", preisRappen: 1, groessenart: "einheit" },
        ],
        ["GET", "/admin/laden/bestellungen"],
        ["GET", "/admin/laden/einstellungen"],
        ["PUT", "/admin/laden/einstellungen", { uebergabearten: ["X"] }],
      ] as const) {
        expect(
          (await aufruf(konten[p], m, pfad, body)).status,
          `${p} ${m} ${pfad}`,
        ).toBe(403);
      }
    }
  });

  test("Artikel anlegen, ändern, löschen; die Eingaben sind begrenzt", async () => {
    const r = await aufruf(admin, "POST", "/admin/laden/artikel", {
      name: "  Foulard  ",
      preisRappen: 2500,
      groessenart: "liste",
      varianten: ["Rot", "Blau"],
      hinweis: "Nur mit Prüfung",
    });
    expect(r.status).toBe(201);
    const { id } = await json(r);
    for (const schlecht of [
      { name: "", preisRappen: 1 },
      { name: "x".repeat(101), preisRappen: 1 },
      { name: "X", preisRappen: -1 },
      { name: "X", preisRappen: 1_000_001 },
      { name: "X", preisRappen: 12.5 },
      {
        name: "X",
        preisRappen: 1,
        groessenart: "liste",
        varianten: ["S", "s"],
      },
      {
        name: "X",
        preisRappen: 1,
        groessenart: "liste",
        varianten: Array.from({ length: 21 }, (_, i) => `v${i}`),
      },
      { name: "X", preisRappen: 1, abteilungId: welt.demoAbteilungId },
      {
        name: "X",
        preisRappen: 1,
        groessenart: "einheit",
        mediumId: randomUUID(),
      },
    ]) {
      expect(
        (await aufruf(admin, "POST", "/admin/laden/artikel", schlecht)).status,
        JSON.stringify(schlecht).slice(0, 60),
      ).toBe(400);
    }
    expect(
      (
        await aufruf(admin, "PATCH", `/admin/laden/artikel/${id}`, {
          preisRappen: 3000,
          verfuegbar: false,
          hinweis: null,
        })
      ).status,
    ).toBe(204);
    const liste = await json(
      await aufruf(admin, "GET", "/admin/laden/artikel"),
    );
    expect(
      liste.artikel.find((a: { id: string }) => a.id === id),
    ).toMatchObject({
      name: "Foulard",
      preisRappen: 3000,
      varianten: ["Rot", "Blau"],
      hinweis: null,
      verfuegbar: false,
    });
    expect(
      (await aufruf(admin, "DELETE", `/admin/laden/artikel/${id}`)).status,
    ).toBe(204);
    expect(
      (await aufruf(admin, "DELETE", `/admin/laden/artikel/${id}`)).status,
    ).toBe(404);
  });

  test("Grösse ist Pflicht: Einheitsgrösse oder eine Liste mit mindestens zwei Grössen (422 mit Feld)", async () => {
    const neu = (body: Record<string, unknown>) =>
      aufruf(admin, "POST", "/admin/laden/artikel", {
        name: "Gurt",
        preisRappen: 100,
        ...body,
      });
    // Ohne Angabe, mit Liste ohne Art, zu kurze Liste, Einheit mit Liste
    for (const [body, feld, code] of [
      [{}, "groessenart", "GROESSE_FEHLT"],
      [{ varianten: ["S", "M"] }, "groessenart", "GROESSE_FEHLT"],
      [{ groessenart: "liste" }, "varianten", "GROESSE_UNGUELTIG"],
      [
        { groessenart: "liste", varianten: ["S"] },
        "varianten",
        "GROESSE_UNGUELTIG",
      ],
      [
        { groessenart: "einheit", varianten: ["S", "M"] },
        "varianten",
        "GROESSE_UNGUELTIG",
      ],
    ] as const) {
      const r = await neu(body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(await json(r)).toMatchObject({ code, feld });
    }
    const einheit = await json(await neu({ groessenart: "einheit" }));
    const liste = await json(
      await neu({ groessenart: "liste", varianten: ["S", "M"] }),
    );
    const lesen = async (id: string) =>
      (
        await json(await aufruf(admin, "GET", "/admin/laden/artikel"))
      ).artikel.find((a: { id: string }) => a.id === id);
    expect(await lesen(einheit.id)).toMatchObject({
      groessenart: "einheit",
      varianten: [],
    });
    expect(await lesen(liste.id)).toMatchObject({
      groessenart: "liste",
      varianten: ["S", "M"],
    });
    // Ändern: eine Liste ohne Art ist ein Fehler, die Art allein wechselt, ohne Angaben bleibt alles
    const aendern = (id: string, body: Record<string, unknown>) =>
      aufruf(admin, "PATCH", `/admin/laden/artikel/${id}`, body);
    expect((await aendern(liste.id, { varianten: ["A", "B"] })).status).toBe(
      422,
    );
    expect((await aendern(liste.id, { groessenart: "liste" })).status).toBe(
      422,
    );
    expect((await aendern(liste.id, { preisRappen: 5 })).status).toBe(204);
    expect((await lesen(liste.id)).varianten).toEqual(["S", "M"]);
    expect((await aendern(liste.id, { groessenart: "einheit" })).status).toBe(
      204,
    );
    expect(await lesen(liste.id)).toMatchObject({
      groessenart: "einheit",
      varianten: [],
    });
    expect(
      (
        await aendern(einheit.id, {
          groessenart: "liste",
          varianten: ["X", "Y", "Z"],
        })
      ).status,
    ).toBe(204);
    expect((await lesen(einheit.id)).varianten).toEqual(["X", "Y", "Z"]);
  });

  test("Artikel und Bestellungen einer anderen Abteilung sind 404, auch für deren Abteilungsleitung", async () => {
    const a = await neuerArtikel();
    const { id } = await json(
      await bestelle(eltern, [{ artikelId: a.id, menge: 1 }]),
    );
    expect(
      (
        await aufruf(demoAdmin, "PATCH", `/admin/laden/artikel/${a.id}`, {
          preisRappen: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await aufruf(demoAdmin, "DELETE", `/admin/laden/artikel/${a.id}`))
        .status,
    ).toBe(404);
    expect(
      (
        await aufruf(
          demoAdmin,
          "POST",
          `/admin/laden/bestellungen/${id}/status`,
          {
            status: "storniert",
          },
        )
      ).status,
    ).toBe(404);
    const fremd = await json(
      await aufruf(demoAdmin, "GET", "/admin/laden/bestellungen"),
    );
    expect(fremd.bestellungen).toEqual([]);
    const [zeile] = await db
      .select()
      .from(schema.ladenArtikel)
      .where(eq(schema.ladenArtikel.id, a.id));
    expect(zeile!.preisRappen).toBe(1500);
  });

  test("die Liste nennt Person und Positionen, filtert nach Stand und blättert", async () => {
    const a = await neuerArtikel({ name: "Gurt" });
    const erste = await json(
      await bestelle(eltern, [{ artikelId: a.id, menge: 2 }]),
    );
    const zweite = await json(
      await bestelle(leitung, [{ artikelId: a.id, menge: 1 }]),
    );
    await aufruf(
      admin,
      "POST",
      `/admin/laden/bestellungen/${zweite.id}/status`,
      {
        status: "bereit",
      },
    );
    const offen = await json(
      await aufruf(admin, "GET", "/admin/laden/bestellungen?status=offen"),
    );
    expect(offen.bestellungen).toHaveLength(1);
    expect(offen.bestellungen[0]).toMatchObject({
      id: erste.id,
      summeRappen: 3000,
      person: { id: eltern.id },
      positionen: [{ name: "Gurt", menge: 2 }],
    });
    const alle = await json(
      await aufruf(admin, "GET", "/admin/laden/bestellungen?limit=1"),
    );
    expect(alle.bestellungen[0].id).toBe(zweite.id);
    expect(alle.weitere).toBe(true);
    const rest = await json(
      await aufruf(
        admin,
        "GET",
        `/admin/laden/bestellungen?limit=1&nach=${alle.naechste}`,
      ),
    );
    expect(rest.bestellungen[0].id).toBe(erste.id);
  });

  test("Stand: offen und bereit wechseln, übergeben und storniert sind endgültig", async () => {
    const a = await neuerArtikel();
    const { id } = await json(
      await bestelle(eltern, [{ artikelId: a.id, menge: 1 }]),
    );
    const setze = (status: string) =>
      aufruf(admin, "POST", `/admin/laden/bestellungen/${id}/status`, {
        status,
      });
    expect((await setze("bereit")).status).toBe(200);
    expect((await setze("offen")).status).toBe(200);
    expect((await setze("gibt-es-nicht")).status).toBe(400);
    expect((await setze("uebergeben")).status).toBe(200);
    const r = await setze("offen");
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe("STATUS_UNGUELTIG");
    expect((await setze("storniert")).status).toBe(409);
    const [zeile] = await db
      .select()
      .from(schema.ladenBestellung)
      .where(eq(schema.ladenBestellung.id, id));
    expect(zeile!.status).toBe("uebergeben");
    expect(zeile!.abgeschlossenAm).not.toBeNull();
  });

  test("ein gelöschter Artikel lässt die Positionen bestehender Bestellungen stehen", async () => {
    const a = await neuerArtikel({ name: "Mütze" });
    const { id } = await json(
      await bestelle(eltern, [{ artikelId: a.id, menge: 1 }]),
    );
    await aufruf(admin, "DELETE", `/admin/laden/artikel/${a.id}`);
    const meine = await json(
      await aufruf(eltern, "GET", "/laden/bestellungen/meine"),
    );
    expect(
      meine.bestellungen.find((b: { id: string }) => b.id === id).positionen,
    ).toEqual([
      {
        artikelId: null,
        name: "Mütze",
        variante: null,
        menge: 1,
        einzelpreisRappen: 1500,
      },
    ]);
  });

  test("Übergabearten: eine bis fünf, ohne Doppelte; ohne Einstellung gilt die Vorgabe", async () => {
    expect(
      await json(await aufruf(admin, "GET", "/admin/laden/einstellungen")),
    ).toEqual({ uebergabearten: [ABHOLUNG] });
    for (const schlecht of [
      [],
      ["a", "A"],
      ["1", "2", "3", "4", "5", "6"],
      [""],
    ]) {
      expect(
        (
          await aufruf(admin, "PUT", "/admin/laden/einstellungen", {
            uebergabearten: schlecht,
          })
        ).status,
      ).toBe(400);
    }
  });
});

describe("Datenschutz und Aufbewahrung", () => {
  test("das Protokoll führt nur Kennungen, nie Artikelnamen oder Varianten", async () => {
    const a = await neuerArtikel({
      name: "Geheimer-Artikel-XY",
      varianten: ["Geheim-V"],
    });
    const { id } = await json(
      await bestelle(eltern, [
        { artikelId: a.id, variante: "Geheim-V", menge: 1 },
      ]),
    );
    await aufruf(admin, "POST", `/admin/laden/bestellungen/${id}/status`, {
      status: "storniert",
    });
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, id));
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([
      "laden_bestellt",
      "laden_status_geaendert",
    ]);
    expect(JSON.stringify(zeilen)).not.toContain("Geheim");
  });

  test("der Löschlauf entfernt abgeschlossene Bestellungen nach 180 Tagen und nie abgeschlossene nach 365 Tagen", async () => {
    const vor = (tage: number) => new Date(Date.now() - tage * 864e5);
    const mit = async (
      status: "offen" | "uebergeben" | "storniert",
      tage: number,
    ) => {
      const [b] = await db
        .insert(schema.ladenBestellung)
        .values({
          abteilungId: welt.testabteilungId,
          userId: eltern.id!,
          uebergabe: ABHOLUNG,
          summeRappen: 100,
          status,
          geaendertAm: vor(tage),
          abgeschlossenAm: status === "offen" ? null : vor(tage),
        })
        .returning({ id: schema.ladenBestellung.id });
      await db.insert(schema.ladenBestellposition).values({
        bestellungId: b!.id,
        name: "X",
        menge: 1,
        einzelpreisRappen: 100,
      });
      return b!.id;
    };
    const weg = [
      await mit("uebergeben", 181),
      await mit("storniert", 200),
      await mit("offen", 366),
    ];
    const bleibt = [
      await mit("uebergeben", 179),
      await mit("offen", 364),
      await mit("offen", 1),
    ];
    expect(await loescheAlteBestellungen(db)).toBeGreaterThanOrEqual(3);
    const da = (
      await db
        .select({ id: schema.ladenBestellung.id })
        .from(schema.ladenBestellung)
        .where(inArray(schema.ladenBestellung.id, [...weg, ...bleibt]))
    ).map((z) => z.id);
    expect(da.sort()).toEqual(bleibt.sort());
    // Die Positionen gehen mit
    expect(
      await db
        .select()
        .from(schema.ladenBestellposition)
        .where(inArray(schema.ladenBestellposition.bestellungId, weg)),
    ).toHaveLength(0);
  });

  test("mit dem Konto verschwinden seine Bestellungen und Positionen", async () => {
    const [u] = await db
      .insert(schema.user)
      .values({
        name: "Wegwerfkonto",
        email: `${randomUUID()}@example.invalid`,
        abteilungId: welt.testabteilungId,
      } as typeof schema.user.$inferInsert)
      .returning({ id: schema.user.id });
    const [b] = await db
      .insert(schema.ladenBestellung)
      .values({
        abteilungId: welt.testabteilungId,
        userId: u!.id,
        uebergabe: ABHOLUNG,
        summeRappen: 100,
      })
      .returning({ id: schema.ladenBestellung.id });
    await db.insert(schema.ladenBestellposition).values({
      bestellungId: b!.id,
      name: "X",
      menge: 1,
      einzelpreisRappen: 100,
    });
    await db.delete(schema.user).where(eq(schema.user.id, u!.id));
    expect(
      await db
        .select()
        .from(schema.ladenBestellung)
        .where(eq(schema.ladenBestellung.id, b!.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.ladenBestellposition)
        .where(eq(schema.ladenBestellposition.bestellungId, b!.id)),
    ).toHaveLength(0);
  });
});

test("preisText: Franken mit Strich, Rappen zweistellig, null ist gratis", () => {
  expect(preisText(4000)).toBe("CHF 40.–");
  expect(preisText(1250)).toBe("CHF 12.50");
  expect(preisText(5)).toBe("CHF 0.05");
  expect(preisText(123456700)).toBe("CHF 1’234’567.–");
  expect(preisText(0)).toBe("gratis");
});
