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
import { erstelleWelt, legePersonaAn, type Welt } from "./hilfen/personas.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  kodiereLogo: kodiereStufenlogo,
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

let welt: Welt;
let stufeId: string;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  const [zeile] = await db
    .insert(schema.stufe)
    .values({
      abteilungId: welt.testabteilungId,
      name: "Logo Stufe",
      kuerzel: "L",
      reihenfolge: 60,
    })
    .returning({ id: schema.stufe.id });
  stufeId = zeile.id;
});

// Synthetisch: einfarbig mit Transparenz, 800 × 400
const png = () =>
  sharp({
    create: {
      width: 800,
      height: 400,
      channels: 4,
      background: { r: 200, g: 30, b: 30, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();

const hochladen = async (persona: "admin" | "elternA", body: Uint8Array) =>
  app.request(`/api/v1/admin/stufen/${stufeId}/logo`, {
    method: "PUT",
    headers: (await legePersonaAn(welt, persona)).headers,
    body: body as BodyInit,
  });

describe("Stufenlogo", () => {
  test("Upload kodiert zu WebP mit Seitenverhältnis und Transparenz, ohne Metadaten", async () => {
    expect((await hochladen("admin", await png())).status).toBe(204);
    const [zeile] = await db
      .select()
      .from(schema.stufenlogo)
      .where(eq(schema.stufenlogo.stufeId, stufeId));
    const meta = await sharp(zeile.inhalt).metadata();
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual([
      "webp",
      512,
      256,
      true,
    ]);
    expect(meta.exif).toBeUndefined();
  });

  test("GET liefert das Logo, die Stufenliste nennt logoUrl nur mit Logo", async () => {
    const eltern = await legePersonaAn(welt, "elternA");
    const antwort = await app.request(`/api/v1/stufen/${stufeId}/logo`, {
      headers: eltern.headers,
    });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toBe("image/webp");
    const liste = (await (
      await app.request("/api/v1/stufen", { headers: eltern.headers })
    ).json()) as { stufen: { id: string; logoUrl: string | null }[] };
    expect(liste.stufen.find((s) => s.id === stufeId)?.logoUrl).toMatch(
      new RegExp(`^/api/v1/stufen/${stufeId}/logo\\?v=\\d+$`),
    );
    expect(
      liste.stufen
        .filter((s) => s.id !== stufeId)
        .every((s) => s.logoUrl === null),
    ).toBe(true);
  });

  test("Upload lehnt Nicht-Bilder mit 415 ab, Nicht-Admins mit 403", async () => {
    expect(
      (await hochladen("admin", new TextEncoder().encode("<svg/>"))).status,
    ).toBe(415);
    expect((await hochladen("elternA", await png())).status).toBe(403);
  });

  test("ein Bild über 16 Mio. Pixel wird mit 415 abgelehnt, nicht mit 500", async () => {
    const zuGross = await sharp({
      create: { width: 4000, height: 4001, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const res = await hochladen("admin", zuGross);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "BILD_FORMAT" });
  });

  test("DELETE entfernt das Logo, danach 404 und logoUrl null", async () => {
    const admin = await legePersonaAn(welt, "admin");
    const url = `/api/v1/admin/stufen/${stufeId}/logo`;
    expect(
      (await app.request(url, { method: "DELETE", headers: admin.headers }))
        .status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/v1/stufen/${stufeId}/logo`, {
          headers: admin.headers,
        })
      ).status,
    ).toBe(404);
    const liste = (await (
      await app.request("/api/v1/stufen", { headers: admin.headers })
    ).json()) as { stufen: { id: string; logoUrl: string | null }[] };
    expect(liste.stufen.find((s) => s.id === stufeId)?.logoUrl).toBeNull();
  });
});
