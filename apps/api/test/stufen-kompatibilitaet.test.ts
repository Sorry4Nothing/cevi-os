import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { erstelleApp } from "../src/app.js";
import { kodiereStufenlogo } from "../src/bild-sharp.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { legeProgrammAn } from "./hilfen/programme.js";
import { antwortVerletzungen, verletzungen } from "./hilfen/vertrag.js";

// Stufen sind Tags (#332), die Routen bleiben für ältere Apps gleich: Antworten gegen docs/api/openapi.yaml, Daten in tag und person_tag
bereiteAuthTestsVor();

const pg = postgres(API_URL);
const db = erstelleDb(pg);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql: pg,
  db,
  auth,
  kodiereLogo: kodiereStufenlogo,
  seiten: ladeSeiten(),
});
afterAll(() => pg.end());

let welt: Welt;
const konten = new Map<Persona, PersonaKonto>();
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  for (const persona of ["admin", "slA", "leitendeA", "elternA"] as const) {
    konten.set(persona, await legePersonaAn(welt, persona));
  }
});

type Methode = "get" | "post" | "put" | "patch" | "delete";
async function aufruf(
  persona: Persona,
  methode: Methode,
  url: string,
  body?: unknown,
) {
  const antwort = await app.request(url, {
    method: methode.toUpperCase(),
    headers: {
      ...konten.get(persona)!.headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await antwort.text();
  return {
    status: antwort.status,
    json: text ? (JSON.parse(text) as unknown) : null,
  };
}

// Antwort mit erwartetem Status gegen das Schema aus openapi.yaml; die Vorlage ist der Pfad, wie ihn das Dokument schreibt
async function gegenVertrag(
  persona: Persona,
  methode: Methode,
  vorlage: string,
  url: string,
  status: number,
  body?: unknown,
) {
  const antwort = await aufruf(persona, methode, url, body);
  expect(antwort.status).toBe(status);
  expect(antwortVerletzungen(vorlage, methode, status, antwort.json)).toEqual(
    [],
  );
  return antwort.json as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const istStufenTag = async (id: string) => {
  const [zeile] = await db
    .select({ typ: schema.tag.typ, abteilungId: schema.tag.abteilungId })
    .from(schema.tag)
    .where(eq(schema.tag.id, id));
  return zeile;
};

describe("Vertragsprüfer", () => {
  test("erkennt ein zusätzliches Feld und einen falschen Typ", () => {
    const schemaMitFeld = {
      type: "object",
      required: ["id"],
      additionalProperties: false,
      properties: { id: { type: "string", format: "uuid" } },
    };
    expect(verletzungen(schemaMitFeld, { id: 1, extra: true })).toEqual([
      "$.id: Typ number, erwartet string",
      "$.extra: unbekanntes Feld",
    ]);
  });
});

describe("Lesende Routen liefern ihr Format unverändert", () => {
  test("GET /stufen: dieselben IDs wie die Tags, Name, Kürzel und Logo-Feld", async () => {
    const antwort = await gegenVertrag(
      "elternA",
      "get",
      "/api/v1/stufen",
      "/api/v1/stufen",
      200,
    );
    const stufeA = antwort.stufen.find(
      (s: { id: string }) => s.id === welt.stufeAId,
    );
    expect(stufeA).toMatchObject({ name: "Stufe A", kuerzel: "A" });
    expect((await istStufenTag(welt.stufeAId))?.typ).toBe("stufe");
  });

  test("GET /stufen zeigt nur Tags vom Typ stufe", async () => {
    const [funktion] = await db
      .insert(schema.tag)
      .values({
        abteilungId: welt.testabteilungId,
        typ: "funktion",
        name: "Kompat Funktion",
        kuerzel: "KF",
      })
      .returning({ id: schema.tag.id });
    const antwort = await gegenVertrag(
      "admin",
      "get",
      "/api/v1/stufen",
      "/api/v1/stufen",
      200,
    );
    expect(antwort.stufen.map((s: { id: string }) => s.id)).not.toContain(
      funktion.id,
    );
  });

  test("GET /stufen/:id/kontakte: die SL aus person_tag, in der Reihenfolge der Priorität", async () => {
    const sl = konten.get("slA")!;
    const [zeile] = await db
      .select({
        rolle: schema.personTag.rolle,
        prioritaet: schema.personTag.prioritaet,
      })
      .from(schema.personTag)
      .where(eq(schema.personTag.userId, sl.id!));
    expect(zeile.rolle).toBe("stufenleitung");
    const antwort = await gegenVertrag(
      "leitendeA",
      "get",
      "/api/v1/stufen/{id}/kontakte",
      `/api/v1/stufen/${welt.stufeAId}/kontakte`,
      200,
    );
    expect(antwort.kontakte.map((k: { id: string }) => k.id)).toContain(sl.id);
  });

  test("GET /ich: Rollen der SL mit stufeId und Typ", async () => {
    const antwort = await gegenVertrag(
      "slA",
      "get",
      "/api/v1/ich",
      "/api/v1/ich",
      200,
    );
    expect(antwort.rollen).toEqual([
      { stufeId: welt.stufeAId, typ: "stufenleitung" },
    ]);
    expect(antwort.stufen).toEqual([
      expect.objectContaining({ id: welt.stufeAId }),
    ]);
  });

  test("GET /admin/personen: rollen[] pro Person", async () => {
    const antwort = await gegenVertrag(
      "admin",
      "get",
      "/api/v1/admin/personen",
      "/api/v1/admin/personen",
      200,
    );
    const mitRolle = antwort.personen.filter(
      (p: { rollen: unknown[] }) => p.rollen.length > 0,
    );
    expect(mitRolle.length).toBeGreaterThan(0);
  });

  test("GET /admin/kinder, /chats, /stufen/:id/anwesenheit, /admin/zeitregeln, /admin/system/syncs", async () => {
    await gegenVertrag(
      "admin",
      "get",
      "/api/v1/admin/kinder",
      "/api/v1/admin/kinder",
      200,
    );
    const chats = await gegenVertrag(
      "slA",
      "get",
      "/api/v1/chats",
      "/api/v1/chats",
      200,
    );
    expect(chats.chats.some((c: { typ: string }) => c.typ === "stufe")).toBe(
      true,
    );
    await gegenVertrag(
      "leitendeA",
      "get",
      "/api/v1/stufen/{id}/anwesenheit",
      `/api/v1/stufen/${welt.stufeAId}/anwesenheit`,
      200,
    );
    await gegenVertrag(
      "admin",
      "get",
      "/api/v1/admin/zeitregeln",
      "/api/v1/admin/zeitregeln",
      200,
    );
    await gegenVertrag(
      "admin",
      "get",
      "/api/v1/admin/system/syncs",
      "/api/v1/admin/system/syncs",
      200,
    );
  });

  test("Programme: Stufen am Programm kommen aus den Stufen-Tags (programm_tag)", async () => {
    const eigenes = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId],
      beginn: new Date("2027-03-06T13:00:00Z"),
    });
    const alle = await legeProgrammAn(db, {
      abteilungId: welt.testabteilungId,
      sichtbarkeit: "eltern",
      stufen: [welt.stufeAId, welt.stufeBId],
      beginn: new Date("2027-03-13T13:00:00Z"),
    });
    const liste = await gegenVertrag(
      "admin",
      "get",
      "/api/v1/programme",
      "/api/v1/programme?von=2027-03-01&bis=2027-03-31&alle=1",
      200,
    );
    const stufenVon = (id: string) =>
      liste.programme
        .find((p: { id: string }) => p.id === id)
        .stufen.map((s: { id: string }) => s.id);
    expect(stufenVon(eigenes.id)).toEqual([welt.stufeAId]);
    expect(stufenVon(alle.id).sort()).toEqual(
      [welt.stufeAId, welt.stufeBId].sort(),
    );
    const vonLeitung = await gegenVertrag(
      "leitendeA",
      "get",
      "/api/v1/programme",
      "/api/v1/programme?von=2027-03-01&bis=2027-03-31",
      200,
    );
    expect(vonLeitung.programme.map((p: { id: string }) => p.id)).toContain(
      alle.id,
    );
    await gegenVertrag(
      "admin",
      "get",
      "/api/v1/programme/{id}",
      `/api/v1/programme/${eigenes.id}`,
      200,
    );
  });
});

describe("Schreibende Routen halten die Daten in tag und person_tag", () => {
  test("POST, PATCH und DELETE /admin/stufen: Tag mit gleicher ID, Gruppenchat, kein Rest", async () => {
    const { id } = await gegenVertrag(
      "admin",
      "post",
      "/api/v1/admin/stufen",
      "/api/v1/admin/stufen",
      201,
      { name: "Neue Stufe", kuerzel: "N" },
    );
    expect(await istStufenTag(id)).toEqual({
      typ: "stufe",
      abteilungId: welt.testabteilungId,
    });
    const chats = await db
      .select({ typ: schema.chat.typ })
      .from(schema.chat)
      .where(eq(schema.chat.stufeId, id));
    expect(chats).toEqual([{ typ: "stufe" }]);

    expect(
      (
        await aufruf("admin", "patch", `/api/v1/admin/stufen/${id}`, {
          name: "Umbenannt",
        })
      ).status,
    ).toBe(204);
    const [tag] = await db
      .select({ name: schema.tag.name })
      .from(schema.tag)
      .where(eq(schema.tag.id, id));
    expect(tag.name).toBe("Umbenannt");

    // Ein zweiter Name in anderer Schreibweise ist wie vorher vergeben (409 STUFENNAME_VERGEBEN)
    const doppelt = await aufruf("admin", "post", "/api/v1/admin/stufen", {
      name: "umbenannt",
    });
    expect(doppelt.status).toBe(409);
    expect(doppelt.json).toMatchObject({ code: "STUFENNAME_VERGEBEN" });

    expect(
      (await aufruf("admin", "delete", `/api/v1/admin/stufen/${id}`)).status,
    ).toBe(204);
    expect(await istStufenTag(id)).toBeUndefined();
  });

  test("Name einer Stufe und eines Funktions-Tags kollidieren (ein Namensraum)", async () => {
    await db.insert(schema.tag).values({
      abteilungId: welt.testabteilungId,
      typ: "team",
      name: "Gemeinsamer Name",
      kuerzel: "",
    });
    const antwort = await aufruf("admin", "post", "/api/v1/admin/stufen", {
      name: "gemeinsamer name",
    });
    expect(antwort.status).toBe(409);
  });

  test("PATCH /admin/personen: Rollen landen als person_tag mit Rolle; Entfernen löscht sie", async () => {
    const id = konten.get("leitendeA")!.id!;
    const lesen = () =>
      db
        .select({
          tagId: schema.personTag.tagId,
          rolle: schema.personTag.rolle,
        })
        .from(schema.personTag)
        .where(eq(schema.personTag.userId, id));
    expect(await lesen()).toEqual([{ tagId: welt.stufeAId, rolle: "leitung" }]);
    const geaendert = await aufruf(
      "admin",
      "patch",
      `/api/v1/admin/personen/${id}`,
      {
        rollen: [{ stufeId: welt.stufeBId, typ: "stufenleitung" }],
      },
    );
    expect(geaendert.status).toBe(204);
    expect(await lesen()).toEqual([
      { tagId: welt.stufeBId, rolle: "stufenleitung" },
    ]);
  });

  test("PUT /admin/stufen/:id/stufenleitung setzt die Priorität an der Zuordnung", async () => {
    const sl = konten.get("slA")!;
    const antwort = await aufruf(
      "admin",
      "put",
      `/api/v1/admin/stufen/${welt.stufeAId}/stufenleitung`,
      { ids: [sl.id] },
    );
    expect(antwort.status).toBe(204);
    const [zeile] = await db
      .select({ prioritaet: schema.personTag.prioritaet })
      .from(schema.personTag)
      .where(eq(schema.personTag.userId, sl.id!));
    expect(zeile.prioritaet).toBe(1);
  });

  test("Stufenlogo: Zeile verweist auf den Tag, die Stufenliste trägt die Logo-Adresse", async () => {
    const png = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const hoch = await app.request(
      `/api/v1/admin/stufen/${welt.stufeBId}/logo`,
      {
        method: "PUT",
        headers: {
          ...konten.get("admin")!.headers,
          "content-type": "image/png",
        },
        body: new Uint8Array(png),
      },
    );
    expect(hoch.status).toBe(204);
    const [logo] = await db
      .select({ stufeId: schema.stufenlogo.stufeId })
      .from(schema.stufenlogo)
      .where(eq(schema.stufenlogo.stufeId, welt.stufeBId));
    expect((await istStufenTag(logo.stufeId))?.typ).toBe("stufe");
    const liste = await gegenVertrag(
      "admin",
      "get",
      "/api/v1/stufen",
      "/api/v1/stufen",
      200,
    );
    expect(
      liste.stufen.find((s: { id: string }) => s.id === welt.stufeBId).logoUrl,
    ).toMatch(/^\/api\/v1\/stufen\/.+\/logo\?v=/);
    const bild = await app.request(`/api/v1/stufen/${welt.stufeBId}/logo`, {
      headers: konten.get("admin")!.headers,
    });
    expect(bild.status).toBe(200);
  });

  test("Ein Tag vom Typ stufe über /admin/tags ist eine Stufe mit Gruppenchat", async () => {
    const { id } = await gegenVertrag(
      "admin",
      "post",
      "/api/v1/admin/tags",
      "/api/v1/admin/tags",
      201,
      { typ: "stufe", name: "Stufe über Tags", kuerzel: "ST" },
    );
    const liste = await gegenVertrag(
      "admin",
      "get",
      "/api/v1/stufen",
      "/api/v1/stufen",
      200,
    );
    expect(liste.stufen.map((s: { id: string }) => s.id)).toContain(id);
    const chats = await db
      .select({ typ: schema.chat.typ })
      .from(schema.chat)
      .where(eq(schema.chat.stufeId, id));
    expect(chats).toEqual([{ typ: "stufe" }]);
  });

  test("Eine Zuordnung ohne Stufenrolle gibt keine Rechte, mit Rolle «leitung» (nur durch eine Person der Abteilungsleitung) schon", async () => {
    const eltern = konten.get("elternA")!;
    const zuordnen = await aufruf(
      "admin",
      "put",
      `/api/v1/admin/tags/${welt.stufeBId}/personen/${eltern.id}`,
      { rolle: "Gast" },
    );
    expect(zuordnen.status).toBe(204);
    const ich = await app.request("/api/v1/ich", { headers: eltern.headers });
    expect(((await ich.json()) as { rollen: unknown[] }).rollen).toEqual([]);
    const kontakte = await app.request(
      `/api/v1/stufen/${welt.stufeBId}/anwesenheit`,
      { headers: eltern.headers },
    );
    expect(kontakte.status).toBe(403);

    // Dieselbe Zuordnung mit der Rolle «leitung» ist eine Stufenrolle: Die Tag-Route lehnt sie ab (#344), PATCH /admin/personen setzt sie
    const abgelehnt = await aufruf(
      "admin",
      "put",
      `/api/v1/admin/tags/${welt.stufeBId}/personen/${eltern.id}`,
      { rolle: "leitung" },
    );
    expect(abgelehnt.status).toBe(400);
    const gesetzt = await aufruf(
      "admin",
      "patch",
      `/api/v1/admin/personen/${eltern.id}`,
      { rollen: [{ stufeId: welt.stufeBId, typ: "leitung" }] },
    );
    expect(gesetzt.status).toBe(204);
    const danach = await app.request("/api/v1/ich", {
      headers: eltern.headers,
    });
    expect(((await danach.json()) as { rollen: unknown[] }).rollen).toEqual([
      { stufeId: welt.stufeBId, typ: "leitung" },
    ]);
  });
});
