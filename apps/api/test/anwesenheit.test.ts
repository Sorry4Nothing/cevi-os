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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import {
  anwesenheitKind,
  anwesenheitLeitung,
  kind,
  leitungAnmeldung,
  programm,
  rolle,
  stufe,
  teilnahme,
} from "../src/db/schema.js";
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
  "slB",
  "leitendeA",
  "leitendeB",
  "elternA",
  "demoAdmin",
] as const;
type Rolle = (typeof ROLLEN)[number];

let welt: Welt;
let konten: Record<Rolle, PersonaKonto>;
let kindZwei: string;

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  konten = Object.fromEntries(
    await Promise.all(
      ROLLEN.map(async (p) => [p, await legePersonaAn(welt, p)]),
    ),
  ) as Record<Rolle, PersonaKonto>;
  // «Kind» (kindA) sortiert vor «Zweit»
  const [zeile] = await db
    .insert(kind)
    .values({
      abteilungId: welt.testabteilungId,
      vorname: "Zweit",
      nachname: "A",
      stufeId: welt.stufeAId,
    })
    .returning({ id: kind.id });
  kindZwei = zeile.id;
});

const idVon = (konto: PersonaKonto) => konto.id as string;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

const TAG = 86_400_000;
// Vor n Tagen begonnen, negative n liegen in der Zukunft
const vor = (tage: number) => new Date(Date.now() - tage * TAG);

const anlass = (
  tage: number,
  extra: {
    sichtbarkeit?: "intern" | "leitende" | "eltern";
    stufen?: string[];
  } = {},
) =>
  legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    sichtbarkeit: extra.sichtbarkeit ?? "eltern",
    stufen: extra.stufen ?? [welt.stufeAId],
    beginn: vor(tage),
  });

// Jede Stufe A hat in den Tests eigene Programme; die Übersicht der Stufe B bleibt davon unberührt
const uebersicht = async (
  konto: PersonaKonto,
  query = "",
  stufeId?: string,
) => {
  const res = await app.request(
    `/api/v1/stufen/${stufeId ?? welt.stufeAId}/anwesenheit${query}`,
    { headers: konto.headers },
  );
  return { status: res.status, body: await res.json() };
};

const erfasse = (
  konto: PersonaKonto,
  programmId: string,
  ziel: { kindId: string } | { userId: string },
  da: boolean | null,
  stufeId = welt.stufeAId,
) => {
  const pfad =
    "kindId" in ziel ? `kinder/${ziel.kindId}` : `leitende/${ziel.userId}`;
  return app.request(
    `/api/v1/stufen/${stufeId}/anwesenheit/${programmId}/${pfad}`,
    {
      method: "PUT",
      headers: { ...konto.headers, "content-type": "application/json" },
      body: JSON.stringify({ da }),
    },
  );
};

describe("GET /api/v1/stufen/:id/anwesenheit: Rechte", () => {
  const ERWARTET: Record<Rolle, number> = {
    admin: 200,
    slA: 200,
    leitendeA: 200,
    elternA: 403,
    slB: 403,
    leitendeB: 403,
    demoAdmin: 404,
  };
  test.each(Object.entries(ERWARTET))("%s: %i", async (rolle, status) => {
    expect((await uebersicht(konten[rolle as Rolle])).status).toBe(status);
  });

  test("unbekannte Stufe: 404, keine UUID: 400, ungültige Anzahl: 400", async () => {
    expect(
      (
        await uebersicht(
          konten.admin,
          "",
          "00000000-0000-4000-8000-000000000000",
        )
      ).status,
    ).toBe(404);
    expect((await uebersicht(konten.admin, "", "keine-uuid")).status).toBe(400);
    expect((await uebersicht(konten.admin, "?anzahl=0")).status).toBe(400);
    expect((await uebersicht(konten.admin, "?anzahl=21")).status).toBe(400);
  });

  test("Antwort ist nie im Cache", async () => {
    const res = await app.request(
      `/api/v1/stufen/${welt.stufeAId}/anwesenheit`,
      { headers: konten.admin.headers },
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("Erfassen und Übersicht", () => {
  test("Stand, Quote und Zusagen für Kinder und Leitende", async () => {
    // Eigene Stufe, damit andere Tests keine Anlässe beisteuern
    const [stufeNeu] = await db
      .insert(stufe)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Anwesenheitsstufe",
        kuerzel: "AW",
        reihenfolge: 99,
      })
      .returning({ id: stufe.id });
    const [k1, k2] = await db
      .insert(kind)
      .values([
        {
          abteilungId: welt.testabteilungId,
          vorname: "Anna",
          nachname: "X",
          stufeId: stufeNeu.id,
        },
        {
          abteilungId: welt.testabteilungId,
          vorname: "Berta",
          nachname: "X",
          stufeId: stufeNeu.id,
        },
      ])
      .returning({ id: kind.id });
    const sl = await legePersonaAn(welt, "slA");
    await db.insert(rolle).values({
      userId: idVon(sl),
      stufeId: stufeNeu.id,
      typ: "stufenleitung",
    });
    const mk = (tage: number) =>
      legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        sichtbarkeit: "eltern",
        stufen: [stufeNeu.id],
        beginn: vor(tage),
      });
    const [alt, mitte, neu, kommend] = [
      await mk(5),
      await mk(3),
      await mk(1),
      await mk(-3),
    ];
    // Reihenfolge der Spalten: älteste zuerst, der kommende Anlass zuletzt
    await db.insert(anwesenheitKind).values([
      { programmId: alt.id, kindId: k1.id, da: true },
      { programmId: mitte.id, kindId: k1.id, da: true },
      { programmId: neu.id, kindId: k1.id, da: false },
      { programmId: alt.id, kindId: k2.id, da: true },
    ]);
    await db.insert(anwesenheitLeitung).values({
      programmId: neu.id,
      userId: idVon(sl),
      da: true,
    });
    await db.insert(teilnahme).values([
      { programmId: kommend.id, kindId: k1.id, status: "ja" },
      { programmId: kommend.id, kindId: k2.id, status: "nein" },
    ]);
    await db.insert(leitungAnmeldung).values({
      programmId: kommend.id,
      userId: idVon(sl),
      status: "ja",
    });

    const { status, body } = await uebersicht(sl, "", stufeNeu.id);
    expect(status).toBe(200);
    expect(body.anlaesse.map((a: { id: string }) => a.id)).toEqual([
      alt.id,
      mitte.id,
      neu.id,
      kommend.id,
    ]);
    expect(
      body.anlaesse.map((a: { vergangen: boolean }) => a.vergangen),
    ).toEqual([true, true, true, false]);
    const [anna, berta] = body.kinder;
    expect(anna).toMatchObject({
      id: k1.id,
      vorname: "Anna",
      anwesenheit: ["da", "da", "nicht_da", null],
      zusage: ["offen", "offen", "offen", "ja"],
      da: 2,
      von: 3,
      prozent: 67,
    });
    // Nicht erfasst zählt weder als da noch als nicht da
    expect(berta).toMatchObject({
      anwesenheit: ["da", null, null, null],
      zusage: ["offen", "offen", "offen", "nein"],
      da: 1,
      von: 1,
      prozent: 100,
    });
    expect(body.leitende).toHaveLength(1);
    expect(body.leitende[0]).toMatchObject({
      id: idVon(sl),
      anwesenheit: [null, null, "da", null],
      da: 1,
      von: 1,
    });
    expect(body.zahlen.kinder).toEqual({ da: 3, von: 4, prozent: 75 });
    expect(body.zahlen.leitende).toEqual({ da: 1, von: 1, prozent: 100 });
    expect(body.naechster).toEqual({
      programmId: kommend.id,
      kinder: { ja: 1, nein: 1, offen: 0 },
      leitende: { ja: 1, nein: 0, offen: 0 },
    });
  });

  test("anzahl begrenzt die vergangenen Anlässe; ohne Anlass keine Quote", async () => {
    const [stufeNeu] = await db
      .insert(stufe)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Leere Stufe",
        kuerzel: "LS",
        reihenfolge: 98,
      })
      .returning({ id: stufe.id });
    const leer = await uebersicht(konten.admin, "", stufeNeu.id);
    expect(leer.body.anlaesse).toEqual([]);
    expect(leer.body.naechster).toBeNull();
    expect(leer.body.zahlen.kinder).toEqual({ da: 0, von: 0, prozent: null });
    for (const tage of [4, 3, 2]) {
      await legeProgrammAn(db, {
        abteilungId: welt.testabteilungId,
        sichtbarkeit: "eltern",
        stufen: [stufeNeu.id],
        beginn: vor(tage),
      });
    }
    const zwei = await uebersicht(konten.admin, "?anzahl=2", stufeNeu.id);
    expect(zwei.body.anlaesse).toHaveLength(2);
  });

  test("abgesagte und interne Programme zählen nicht", async () => {
    const [stufeNeu] = await db
      .insert(stufe)
      .values({
        abteilungId: welt.testabteilungId,
        name: "Filterstufe",
        kuerzel: "FS",
        reihenfolge: 97,
      })
      .returning({ id: stufe.id });
    const intern = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "intern",
      stufen: [stufeNeu.id],
      beginn: vor(2),
    });
    const sichtbar = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "leitende",
      stufen: [stufeNeu.id],
      beginn: vor(2),
    });
    const res = await uebersicht(konten.admin, "", stufeNeu.id);
    const ids = res.body.anlaesse.map((a: { id: string }) => a.id);
    expect(ids).toContain(sichtbar.id);
    expect(ids).not.toContain(intern.id);
  });

  test("erfassbar nur innerhalb der Frist", async () => {
    const frischer = await anlass(2);
    const alter = await anlass(30);
    const res = await uebersicht(konten.admin, "?anzahl=20");
    const nach = (id: string) =>
      res.body.anlaesse.find((a: { id: string }) => a.id === id);
    expect(nach(frischer.id).erfassbar).toBe(true);
    expect(nach(alter.id).erfassbar).toBe(false);
  });
});

describe("PUT /api/v1/stufen/:id/anwesenheit/:programmId/kinder/:kindId", () => {
  const ERWARTET: Record<Rolle, number> = {
    admin: 204,
    slA: 204,
    leitendeA: 204,
    elternA: 403,
    slB: 403,
    leitendeB: 403,
    demoAdmin: 404,
  };
  test.each(Object.entries(ERWARTET))("%s: %i", async (rolle, status) => {
    const p = await anlass(1);
    const res = await erfasse(
      konten[rolle as Rolle],
      p.id,
      { kindId: welt.kindAId },
      true,
    );
    expect(res.status).toBe(status);
  });

  test("setzt, ändert und nimmt zurück; merkt sich, wer erfasst hat", async () => {
    const p = await anlass(1);
    const stand = async () =>
      db
        .select()
        .from(anwesenheitKind)
        .where(
          and(
            eq(anwesenheitKind.programmId, p.id),
            eq(anwesenheitKind.kindId, kindZwei),
          ),
        );
    expect(
      (await erfasse(konten.slA, p.id, { kindId: kindZwei }, true)).status,
    ).toBe(204);
    let [zeile] = await stand();
    expect(zeile).toMatchObject({ da: true, erfasstVon: idVon(konten.slA) });
    await erfasse(konten.leitendeA, p.id, { kindId: kindZwei }, false);
    [zeile] = await stand();
    expect(zeile).toMatchObject({
      da: false,
      erfasstVon: idVon(konten.leitendeA),
    });
    await erfasse(konten.slA, p.id, { kindId: kindZwei }, null);
    expect(await stand()).toEqual([]);
  });

  test("Zusage der Eltern bleibt unberührt", async () => {
    const p = await anlass(1);
    await db
      .insert(teilnahme)
      .values({ programmId: p.id, kindId: kindZwei, status: "nein" });
    await erfasse(konten.slA, p.id, { kindId: kindZwei }, true);
    const [zusage] = await db
      .select()
      .from(teilnahme)
      .where(
        and(eq(teilnahme.programmId, p.id), eq(teilnahme.kindId, kindZwei)),
      );
    expect(zusage.status).toBe("nein");
  });

  test("Kind einer anderen Stufe: 404", async () => {
    const p = await anlass(1);
    expect(
      (await erfasse(konten.admin, p.id, { kindId: welt.kindBId }, true))
        .status,
    ).toBe(404);
  });

  test("Programm einer anderen Stufe, unbekanntes, internes, abgesagtes: 404", async () => {
    const fremd = await anlass(1, { stufen: [welt.stufeBId] });
    const intern = await anlass(1, { sichtbarkeit: "intern" });
    const absage = await anlass(1);
    await db
      .update(programm)
      .set({ status: "abgesagt" })
      .where(eq(programm.id, absage.id));
    for (const id of [
      fremd.id,
      intern.id,
      absage.id,
      "00000000-0000-4000-8000-000000000000",
    ]) {
      expect(
        (await erfasse(konten.admin, id, { kindId: welt.kindAId }, true))
          .status,
      ).toBe(404);
    }
  });

  test("vor Beginn und nach der Frist: 409", async () => {
    const zukunft = await anlass(-2);
    const alt = await anlass(15);
    for (const p of [zukunft, alt]) {
      const res = await erfasse(
        konten.admin,
        p.id,
        { kindId: welt.kindAId },
        true,
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("ANWESENHEIT_GESCHLOSSEN");
    }
    // Innerhalb der Frist geht es noch
    const knapp = await anlass(13);
    expect(
      (await erfasse(konten.admin, knapp.id, { kindId: welt.kindAId }, true))
        .status,
    ).toBe(204);
  });

  test("ungültiger Body: 400", async () => {
    const p = await anlass(1);
    for (const body of [{}, { da: "ja" }, { da: true, extra: 1 }]) {
      const res = await app.request(
        `/api/v1/stufen/${welt.stufeAId}/anwesenheit/${p.id}/kinder/${welt.kindAId}`,
        {
          method: "PUT",
          headers: {
            ...konten.admin.headers,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("PUT /api/v1/stufen/:id/anwesenheit/:programmId/leitende/:userId", () => {
  test("Leitung erfasst Leitende; Eltern nicht; Fremde Person: 404", async () => {
    const p = await anlass(1);
    const ziel = { userId: idVon(konten.leitendeA) };
    expect((await erfasse(konten.slA, p.id, ziel, true)).status).toBe(204);
    expect((await erfasse(konten.leitendeA, p.id, ziel, false)).status).toBe(
      204,
    );
    const [zeile] = await db
      .select()
      .from(anwesenheitLeitung)
      .where(eq(anwesenheitLeitung.programmId, p.id));
    expect(zeile).toMatchObject({
      userId: idVon(konten.leitendeA),
      da: false,
      erfasstVon: idVon(konten.leitendeA),
    });
    expect((await erfasse(konten.elternA, p.id, ziel, true)).status).toBe(403);
    expect(
      (
        await erfasse(
          konten.admin,
          p.id,
          { userId: idVon(konten.leitendeB) },
          true,
        )
      ).status,
    ).toBe(404);
    expect((await erfasse(konten.admin, p.id, ziel, null)).status).toBe(204);
    expect(
      await db
        .select()
        .from(anwesenheitLeitung)
        .where(eq(anwesenheitLeitung.programmId, p.id)),
    ).toEqual([]);
  });

  test("nach der Frist: 409", async () => {
    const p = await anlass(20);
    const res = await erfasse(
      konten.admin,
      p.id,
      { userId: idVon(konten.leitendeA) },
      true,
    );
    expect(res.status).toBe(409);
  });
});
