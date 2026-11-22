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
import * as schema from "../src/db/schema.js";
import { ladeSeiten } from "../src/seiten.js";
import {
  aufWebsiteEreignis,
  type WebsiteEreignis,
} from "../src/website/ereignisse.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  legePersonaMitFaktorAn,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";
import { macheWebmaster } from "./hilfen/webmaster.js";

bereiteAuthTestsVor();

const sql = postgres(API_URL);
const db = erstelleDb(sql);
const auth = erstelleTestAuth(db);
// Ein Speicher, der nichts ablegt: Das Löschen eines Mediums braucht ihn
const app = erstelleApp({
  appMinVersion: "1.2.0",
  sql,
  db,
  auth,
  medienspeicher: {
    ablegen: async () => randomUUID(),
    holen: async () => new Uint8Array(),
    loeschen: async () => {},
  },
  seiten: ladeSeiten(),
});
afterAll(() => sql.end());

const BASIS = "/api/v1/redaktion/website";

let welt: Welt;
let admin: PersonaKonto;
let slA: PersonaKonto;
let webmaster: PersonaKonto;
let demoAdmin: PersonaKonto;

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

function anfrage(
  konto: PersonaKonto,
  methode: string,
  body?: Record<string, unknown>,
) {
  return app.request(BASIS, {
    method: methode,
    headers: body
      ? { ...konto.headers, "content-type": "application/json" }
      : konto.headers,
    body: body && JSON.stringify(body),
  });
}

async function medium(
  abteilungId: string,
  extra: Partial<typeof schema.medium.$inferInsert> = {},
) {
  const [z] = await db
    .insert(schema.medium)
    .values({
      abteilungId,
      mimeTyp: "image/png",
      groesse: 10,
      breite: 20,
      hoehe: 10,
      altText: "Logo",
      dekorativ: false,
      sichtbarkeit: "oeffentlich",
      speicherSchluessel: randomUUID(),
      ...extra,
    })
    .returning({ id: schema.medium.id });
  return z!.id;
}

const stand = async (abteilungId: string) => {
  const [a] = await db
    .select({
      name: schema.abteilung.name,
      logo: schema.abteilung.websiteLogoMediumId,
      logoDunkel: schema.abteilung.websiteLogoDunkelMediumId,
    })
    .from(schema.abteilung)
    .where(eq(schema.abteilung.id, abteilungId));
  return a!;
};

beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  [admin, slA, webmaster, demoAdmin] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "slA"),
    legePersonaMitFaktorAn(welt, "leitendeA"),
    legePersonaAn(welt, "demoAdmin"),
  ]);
  await macheWebmaster(db, welt.testabteilungId, webmaster.id!);
});

describe("Name und Logo der Website (#550)", () => {
  test("lesen: Name und Logo der eigenen Abteilung", async () => {
    const antwort = await anfrage(admin, "GET");
    expect(antwort.status).toBe(200);
    const k = (await antwort.json()) as {
      name: string;
      logoMediumId: unknown;
      nameAenderbar: boolean;
    };
    expect(k.name).toBe((await stand(welt.testabteilungId)).name);
    expect(k).toHaveProperty("logoMediumId");
    // Nur der Entwickler ändert den Namen, auch die Abteilungsleitung nicht
    expect(k.nameAenderbar).toBe(false);
  });

  test("Stufenleitung: 403, ohne Login 401", async () => {
    expect((await anfrage(slA, "GET")).status).toBe(403);
    expect((await anfrage(slA, "PATCH", { logoMediumId: null })).status).toBe(
      403,
    );
    const ohne = await app.request(BASIS);
    expect(ohne.status).toBe(401);
  });

  test("Logo setzen meldet ein Ereignis, schreibt das Audit-Log und lässt sich entfernen", async () => {
    const m = await medium(welt.testabteilungId);
    const ereignisse: WebsiteEreignis[] = [];
    const ab = aufWebsiteEreignis((e) => void ereignisse.push(e));
    try {
      const antwort = await anfrage(admin, "PATCH", { logoMediumId: m });
      expect(antwort.status).toBe(200);
      expect(
        ((await antwort.json()) as { logoMediumId: string }).logoMediumId,
      ).toBe(m);
      expect((await stand(welt.testabteilungId)).logo).toBe(m);
      expect(ereignisse).toContainEqual({
        art: "einstellungen_geaendert",
        abteilungId: welt.testabteilungId,
      });
      const [log] = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.aktion, "website_einstellungen_geaendert"))
        .limit(1);
      // Nur Feldnamen, nie Werte
      expect(JSON.stringify(log!.details)).toBe('{"felder":["logoMediumId"]}');
    } finally {
      ab();
    }
    const weg = await anfrage(admin, "PATCH", { logoMediumId: null });
    expect(weg.status).toBe(200);
    expect((await stand(welt.testabteilungId)).logo).toBeNull();
  });

  test("das Recht «Seiten veröffentlichen» genügt für das Logo, nicht für den Namen", async () => {
    const m = await medium(welt.testabteilungId);
    const ok = await anfrage(webmaster, "PATCH", { logoMediumId: m });
    expect(ok.status).toBe(200);
    const vorher = (await stand(welt.testabteilungId)).name;
    const name = await anfrage(webmaster, "PATCH", { name: "Anders" });
    expect(name.status).toBe(403);
    expect((await stand(welt.testabteilungId)).name).toBe(vorher);
    await anfrage(admin, "PATCH", { logoMediumId: null });
  });

  test("die Abteilungsleitung ändert den Namen nicht", async () => {
    const vorher = (await stand(welt.testabteilungId)).name;
    const antwort = await anfrage(admin, "PATCH", { name: "Anders" });
    expect(antwort.status).toBe(403);
    expect((await stand(welt.testabteilungId)).name).toBe(vorher);
  });

  test("der Entwickler ändert den Namen", async () => {
    const vorher = (await stand(welt.testabteilungId)).name;
    const entwickler = await legePersonaMitFaktorAn(welt, "leitendeB");
    await db
      .insert(schema.plattformEntwickler)
      .values({ userId: entwickler.id! });
    try {
      const lesen = await anfrage(entwickler, "GET");
      expect(
        ((await lesen.json()) as { nameAenderbar: boolean }).nameAenderbar,
      ).toBe(true);
      const antwort = await anfrage(entwickler, "PATCH", {
        name: "  Cevi Beispiel  ",
      });
      expect(antwort.status).toBe(200);
      expect(((await antwort.json()) as { name: string }).name).toBe(
        "Cevi Beispiel",
      );
    } finally {
      await db
        .delete(schema.plattformEntwickler)
        .where(eq(schema.plattformEntwickler.userId, entwickler.id!));
      await db
        .update(schema.abteilung)
        .set({ name: vorher })
        .where(eq(schema.abteilung.id, welt.testabteilungId));
    }
  });

  test("ungültige Eingaben: 400", async () => {
    for (const body of [
      {},
      { name: "" },
      { name: "x".repeat(101) },
      { name: "a\u0000b" },
      { logoMediumId: "nein" },
      { logoMediumId: null, extra: 1 },
    ]) {
      const antwort = await anfrage(admin, "PATCH", body);
      expect(antwort.status, JSON.stringify(body)).toBe(400);
    }
  });

  test("ein unzulässiges Logo ist 422: unbekannt, fremd, nicht öffentlich, kein Bild", async () => {
    const fremd = await medium(welt.demoAbteilungId);
    const intern = await medium(welt.testabteilungId, {
      sichtbarkeit: "angemeldet",
    });
    const pdf = await medium(welt.testabteilungId, {
      mimeTyp: "application/pdf",
      breite: null,
      hoehe: null,
      altText: null,
    });
    const faelle: [string, string][] = [
      [randomUUID(), "MEDIUM_UNBEKANNT"],
      // Fremde und unbekannte IDs sind dasselbe
      [fremd, "MEDIUM_UNBEKANNT"],
      [intern, "MEDIUM_NICHT_OEFFENTLICH"],
      [pdf, "MEDIUM_FORMAT"],
    ];
    for (const [id, code] of faelle) {
      const antwort = await anfrage(admin, "PATCH", { logoMediumId: id });
      expect(antwort.status, code).toBe(422);
      expect(((await antwort.json()) as { code: string }).code).toBe(code);
    }
    expect((await stand(welt.testabteilungId)).logo).toBeNull();
  });

  test("Fassung für den dunklen Modus (#558): setzen, dieselben Prüfungen, nicht löschbar, entfernen", async () => {
    const m = await medium(welt.testabteilungId);
    const intern = await medium(welt.testabteilungId, {
      sichtbarkeit: "angemeldet",
    });
    const fremd = await medium(welt.demoAbteilungId);
    for (const [id, code] of [
      [intern, "MEDIUM_NICHT_OEFFENTLICH"],
      [fremd, "MEDIUM_UNBEKANNT"],
    ]) {
      const nein = await anfrage(admin, "PATCH", { logoDunkelMediumId: id });
      expect(nein.status, code).toBe(422);
      expect(((await nein.json()) as { code: string }).code).toBe(code);
    }
    const antwort = await anfrage(admin, "PATCH", { logoDunkelMediumId: m });
    expect(antwort.status).toBe(200);
    expect(
      ((await antwort.json()) as { logoDunkelMediumId: string })
        .logoDunkelMediumId,
    ).toBe(m);
    // Das Logo selbst bleibt, wie es war
    expect(await stand(welt.testabteilungId)).toMatchObject({
      logo: null,
      logoDunkel: m,
    });
    const loeschen = await app.request(`/api/v1/redaktion/medien/${m}`, {
      method: "DELETE",
      headers: admin.headers,
    });
    expect(loeschen.status).toBe(409);
    const weg = await anfrage(admin, "PATCH", { logoDunkelMediumId: null });
    expect(weg.status).toBe(200);
    expect((await stand(welt.testabteilungId)).logoDunkel).toBeNull();
  });

  test("ein Medium, das als Logo dient, lässt sich nicht löschen (409 MEDIUM_VERWENDET)", async () => {
    const m = await medium(welt.testabteilungId);
    expect((await anfrage(admin, "PATCH", { logoMediumId: m })).status).toBe(
      200,
    );
    try {
      const antwort = await app.request(`/api/v1/redaktion/medien/${m}`, {
        method: "DELETE",
        headers: admin.headers,
      });
      expect(antwort.status).toBe(409);
      expect(((await antwort.json()) as { code: string }).code).toBe(
        "MEDIUM_VERWENDET",
      );
      // Ohne Logo ist das Löschen wieder möglich
      await anfrage(admin, "PATCH", { logoMediumId: null });
      const danach = await app.request(`/api/v1/redaktion/medien/${m}`, {
        method: "DELETE",
        headers: admin.headers,
      });
      expect(danach.status).toBe(204);
    } finally {
      await anfrage(admin, "PATCH", { logoMediumId: null });
    }
  });

  test("die andere Abteilung bleibt unberührt", async () => {
    const m = await medium(welt.testabteilungId);
    await anfrage(admin, "PATCH", { logoMediumId: m });
    try {
      expect((await stand(welt.demoAbteilungId)).logo).toBeNull();
      const antwort = await anfrage(demoAdmin, "GET");
      expect(antwort.status).toBe(200);
    } finally {
      await anfrage(admin, "PATCH", { logoMediumId: null });
    }
  });
});
