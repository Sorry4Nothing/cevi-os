import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
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
import { legeProgrammAn } from "../hilfen/programme.js";
import { Attrappe, ausfall } from "../outlook/attrappe.js";

// Tags bestehender Termine setzen (#835): PUT /admin/termine/:id/tags und die Sammelaktion PUT /admin/termine/tags
bereiteAuthTestsVor();
const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
let outlook: Attrappe | undefined;
const grund = { appMinVersion: "1.2.0", sql, db, auth, seiten: ladeSeiten() };
const appAus = erstelleApp(grund);
const appAn = erstelleApp({
  ...grund,
  outlook: { fuer: async () => outlook ?? null },
});
afterAll(() => sql.end());

let welt: Welt;
let admin: PersonaKonto;
let eltern: PersonaKonto;
let demoAdmin: PersonaKonto;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, eltern, demoAdmin] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "elternA"),
    legePersonaAn(welt, "demoAdmin"),
  ]);
});
beforeEach(() => {
  outlook = undefined;
});

const anfrage = (
  app: ReturnType<typeof erstelleApp>,
  methode: string,
  pfad: string,
  body?: unknown,
  konto = admin,
) =>
  app.request(pfad, {
    method: methode,
    headers: { ...konto.headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const senden = (
  app: ReturnType<typeof erstelleApp>,
  pfad: string,
  body: unknown,
  konto = admin,
) => anfrage(app, "PUT", pfad, body, konto);
const neuerTag = async (name?: string, typ: "stufe" | "team" = "stufe") =>
  (
    await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ,
        name: name ?? `Tag ${randomUUID().slice(0, 8)}`,
        kuerzel: "T",
      })
      .returning({ id: schema.tag.id })
  )[0]!.id;
const neuerTermin = async (uid = `uid-${randomUUID()}`) => {
  const p = await legeProgrammAn(db, {
    abteilungId: welt.testabteilungId,
    titel: "Tag-Test",
  });
  await db
    .update(schema.programm)
    .set({ googleEventId: uid })
    .where(eq(schema.programm.id, p.id));
  return { id: p.id, uid };
};
const tagIdsVon = async (id: string) =>
  (
    await db
      .select({ t: schema.programmTag.tagId })
      .from(schema.programmTag)
      .where(eq(schema.programmTag.programmId, id))
  )
    .map((z) => z.t)
    .sort();

describe("PUT /admin/termine/:id/tags", () => {
  test("ersetzt die Tags, antwortet mit Namen und Typ und sagt bei ausgeschaltetem Schalter «aus»", async () => {
    const a = await neuerTag();
    const b = await neuerTag("Zweiter", "team");
    const t = await neuerTermin();
    const url = `/api/v1/admin/termine/${t.id}/tags`;
    const r = await senden(appAus, url, { tagIds: [a, b] });
    expect(r.status).toBe(200);
    const antwort = (await r.json()) as {
      tags: { id: string; name: string; typ: string }[];
      outlook: string;
    };
    expect(antwort.outlook).toBe("aus");
    expect(antwort.tags.map((x) => x.id).sort()).toEqual([a, b].sort());
    expect(Object.keys(antwort.tags[0]!).sort()).toEqual(["id", "name", "typ"]);
    expect(await tagIdsVon(t.id)).toEqual([a, b].sort());
    // Ersetzen, nicht ergänzen; leer entfernt alle
    await senden(appAus, url, { tagIds: [b] });
    expect(await tagIdsVon(t.id)).toEqual([b]);
    const leer = await senden(appAus, url, { tagIds: [] });
    expect(((await leer.json()) as { tags: unknown[] }).tags).toEqual([]);
    expect(await tagIdsVon(t.id)).toEqual([]);
  });

  test("mit verbundenem Outlook: schreibt die Kategorien und sagt «geschrieben»; bei Ausfall «ausstehend», gespeichert ist trotzdem", async () => {
    const a = await neuerTag("Biber-Test");
    const t = await neuerTermin();
    const url = `/api/v1/admin/termine/${t.id}/tags`;
    outlook = new Attrappe();
    outlook.termine.set(t.uid, { id: "ev1", kategorien: ["Fremd"] });
    const ok = await senden(appAn, url, { tagIds: [a] });
    expect((await ok.json()) as { outlook: string }).toMatchObject({
      outlook: "geschrieben",
    });
    expect(outlook.termine.get(t.uid)!.kategorien).toEqual([
      "Fremd",
      "Biber-Test",
    ]);
    outlook.schreibAusfall = ausfall("SERVER");
    const aus = await senden(appAn, url, { tagIds: [] });
    expect((await aus.json()) as { outlook: string }).toMatchObject({
      outlook: "ausstehend",
    });
    expect(await tagIdsVon(t.id)).toEqual([]);
  });

  test("Eingabe: unbekannte Felder, doppelte IDs, über 20, kein UUID und ein fremder Tag sind 400, ohne etwas zu ändern", async () => {
    const a = await neuerTag();
    const t = await neuerTermin();
    const url = `/api/v1/admin/termine/${t.id}/tags`;
    const viele = Array.from({ length: 21 }, () => randomUUID());
    for (const body of [
      { tagIds: [a], extra: 1 },
      { tagIds: [a, a] },
      { tagIds: viele },
      { tagIds: ["x"] },
      {},
    ]) {
      expect((await senden(appAus, url, body)).status).toBe(400);
    }
    // Ein Tag der anderen Abteilung ist für diese unbekannt
    const fremd = (
      await db
        .insert(schema.tag)
        .values({
          abteilungId: welt.demoAbteilungId,
          typ: "stufe",
          name: `Fremd ${randomUUID().slice(0, 8)}`,
          kuerzel: "F",
        })
        .returning({ id: schema.tag.id })
    )[0]!.id;
    const r = await senden(appAus, url, { tagIds: [fremd] });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { code: string }).code).toBe("TAG_UNBEKANNT");
    expect(await tagIdsVon(t.id)).toEqual([]);
  });

  test("ohne Recht 403, ein fremder oder unbekannter Termin 404 vor dem Recht", async () => {
    const t = await neuerTermin();
    const url = `/api/v1/admin/termine/${t.id}/tags`;
    expect((await senden(appAus, url, { tagIds: [] }, eltern)).status).toBe(
      403,
    );
    expect((await senden(appAus, url, { tagIds: [] }, demoAdmin)).status).toBe(
      404,
    );
    const unbekannt = `/api/v1/admin/termine/${randomUUID()}/tags`;
    expect((await senden(appAus, unbekannt, { tagIds: [] })).status).toBe(404);
  });

  test("Audit: wer und wie viele Tags, kein Titel", async () => {
    const t = await neuerTermin();
    const a = await neuerTag();
    await senden(appAus, `/api/v1/admin/termine/${t.id}/tags`, { tagIds: [a] });
    const zeilen = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.zielId, t.id));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({
      aktion: "termin_tags_geaendert",
      akteurId: admin.id,
      details: { tags: 1, outlook: false },
    });
    expect(JSON.stringify(zeilen[0])).not.toContain("Tag-Test");
  });
});

describe("PUT /admin/termine/tags (Sammelaktion)", () => {
  test("setzt dieselben Tags für alle genannten Termine und zählt den Stand von Outlook", async () => {
    const a = await neuerTag();
    const ts = [await neuerTermin(), await neuerTermin(), await neuerTermin()];
    const body = { terminIds: ts.map((t) => t.id), tagIds: [a] };
    const r = await senden(appAus, "/api/v1/admin/termine/tags", body);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      geaendert: 3,
      outlook: { geschrieben: 0, ausstehend: 0, aus: 3 },
    });
    for (const t of ts) expect(await tagIdsVon(t.id)).toEqual([a]);

    outlook = new Attrappe();
    const an = await senden(appAn, "/api/v1/admin/termine/tags", body);
    expect(await an.json()).toEqual({
      geaendert: 3,
      outlook: { geschrieben: 0, ausstehend: 3, aus: 0 },
    });
  });

  test("ein unbekannter Termin lässt alle unverändert (404); leere Tag-Liste und über 100 Termine sind 400", async () => {
    const a = await neuerTag();
    const t = await neuerTermin();
    const url = "/api/v1/admin/termine/tags";
    const r = await senden(appAus, url, {
      terminIds: [t.id, randomUUID()],
      tagIds: [a],
    });
    expect(r.status).toBe(404);
    expect(await tagIdsVon(t.id)).toEqual([]);
    expect(
      (await senden(appAus, url, { terminIds: [t.id], tagIds: [] })).status,
    ).toBe(400);
    const viele = Array.from({ length: 101 }, () => randomUUID());
    expect(
      (await senden(appAus, url, { terminIds: viele, tagIds: [a] })).status,
    ).toBe(400);
  });
});

describe("Tags verwalten: Namen und Kategorienliste", () => {
  const anlegen = (app: ReturnType<typeof erstelleApp>, name: string) =>
    anfrage(app, "POST", "/api/v1/admin/tags", { typ: "funktion", name });

  test("ein Komma oder Steuerzeichen im Namen ist 400 (Outlook trennt damit Kategorien)", async () => {
    for (const name of ["Mit,Komma", "Zeile\nzwei"]) {
      expect((await anlegen(appAus, name)).status).toBe(400);
    }
  });

  test("mit verbundenem Outlook markiert Anlegen, Umbenennen und Löschen die Kategorienliste als offen; ohne Schalter nicht", async () => {
    await db
      .insert(schema.outlookVerbindung)
      .values({ abteilungId: welt.testabteilungId, refreshToken: "x" })
      .onConflictDoNothing();
    const offen = async () =>
      (
        await db
          .select({ o: schema.outlookVerbindung.kategorienOffen })
          .from(schema.outlookVerbindung)
          .where(eq(schema.outlookVerbindung.abteilungId, welt.testabteilungId))
      )[0]!.o;
    const zuruecksetzen = () =>
      db
        .update(schema.outlookVerbindung)
        .set({ kategorienOffen: false })
        .where(eq(schema.outlookVerbindung.abteilungId, welt.testabteilungId));
    await zuruecksetzen();
    expect((await anlegen(appAus, `T ${randomUUID()}`)).status).toBe(201);
    expect(await offen()).toBe(false);
    const neu = await anlegen(appAn, `T ${randomUUID()}`);
    const { id } = (await neu.json()) as { id: string };
    expect(await offen()).toBe(true);
    await zuruecksetzen();
    const pfad = `/api/v1/admin/tags/${id}`;
    await anfrage(appAn, "PATCH", pfad, { name: `U ${randomUUID()}` });
    expect(await offen()).toBe(true);
    await zuruecksetzen();
    // Nur das Kürzel zu ändern ändert den Namen der Kategorie nicht
    await anfrage(appAn, "PATCH", pfad, { kuerzel: "ZZ" });
    expect(await offen()).toBe(false);
    await anfrage(appAn, "DELETE", pfad);
    expect(await offen()).toBe(true);
  });
});
