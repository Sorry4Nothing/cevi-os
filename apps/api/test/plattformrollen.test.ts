import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { erstelleApp } from "../src/app.js";
import { erstelleDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import {
  hatPlattformRecht,
  istEntwickler,
  istPlattformRecht,
  legeWebmasterAn,
  PLATTFORM_RECHT_NAMEN,
  PLATTFORM_RECHTE,
  plattformRechteVon,
  verlangeEntwickler,
  verlangePlattformRecht,
  WEBMASTER_VORGABE,
} from "../src/plattform.js";
import type { Person } from "../src/rechte.js";
import { ladeSeiten } from "../src/seiten.js";
import { bereiteAuthTestsVor, erstelleTestAuth } from "./hilfen/auth.js";
import { API_URL } from "./hilfen/datenbank.js";
import {
  erstelleWelt,
  legePersonaAn,
  schalteZweitenFaktorEin,
  type Persona,
  type PersonaKonto,
  type Welt,
} from "./hilfen/personas.js";

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
// Ein eigener Client zählt die Abfragen: Wie viele löst die Prüfung der Rechte aus?
const abfragen: string[] = [];
const zaehlSql = postgres(API_URL, {
  debug: (_verbindung, abfrage) => {
    abfragen.push(abfrage);
  },
});
const zaehlDb = erstelleDb(zaehlSql);
afterAll(() => Promise.all([sql.end(), zaehlSql.end()]));

let welt: Welt;
let admin: PersonaKonto;
let adminOhne: PersonaKonto;
let demoAdmin: PersonaKonto;
let slA: PersonaKonto;
let leitende: PersonaKonto;
let eltern: PersonaKonto;
let webmasterId: string;
let demoWebmasterId: string;
beforeAll(async () => {
  welt = await erstelleWelt(db, auth);
  // Die Fabrik legt die Abteilungen ohne Vorgabe an; die CLI und die Migration legen sie sonst an
  await legeWebmasterAn(db, welt.testabteilungId);
  await legeWebmasterAn(db, welt.demoAbteilungId);
  webmasterId = await vorgabeId(welt.testabteilungId);
  demoWebmasterId = await vorgabeId(welt.demoAbteilungId);
  [admin, adminOhne, demoAdmin, slA, leitende, eltern] = await Promise.all([
    legePersonaAn(welt, "admin"),
    legePersonaAn(welt, "adminOhneZweitenFaktor"),
    legePersonaAn(welt, "demoAdmin"),
    legePersonaAn(welt, "slA"),
    legePersonaAn(welt, "leitendeA"),
    legePersonaAn(welt, "elternA"),
  ]);
});

let ausgabe: MockInstance<typeof console.log>;
beforeEach(() => {
  ausgabe = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => ausgabe.mockRestore());

async function vorgabeId(abteilungId: string) {
  const [zeile] = await db
    .select({ id: schema.plattformRolle.id })
    .from(schema.plattformRolle)
    .where(
      and(
        eq(schema.plattformRolle.abteilungId, abteilungId),
        eq(schema.plattformRolle.schluessel, "webmaster"),
      ),
    );
  return zeile.id;
}

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

// Frisches Konto der Persona, damit jeder Test sein eigenes hat
const neuePerson = (persona: Persona) => legePersonaAn(welt, persona);
// Ein Konto, das nicht Abteilungsleitung ist, aber den zweiten Faktor hat (Webmaster mit Faktor)
async function neuePersonMitFaktor() {
  const konto = await neuePerson("leitendeA");
  return schalteZweitenFaktorEin(welt, konto);
}
const vergebe = (konto: PersonaKonto, rolleId = webmasterId) =>
  db.insert(schema.personPlattformRolle).values({ userId: konto.id!, rolleId });

// Wie personAusSitzung (rechte.ts), für die Prüffunktionen ohne Anfrage; ein neues Objekt je Frage, weil die Rechte je Person-Objekt einmal geladen werden
const person = (konto: PersonaKonto, zusatz: Partial<Person> = {}): Person => ({
  id: konto.id!,
  abteilungId: konto.abteilungId!,
  admin: false,
  zweiterFaktor: false,
  rollen: [],
  ...zusatz,
});

const BASIS = "/api/v1/admin/plattform/rollen";
const rolleAnlegen = async (
  rechte: string[] = ["medien.verwalten"],
  name = `Rolle ${randomUUID().slice(0, 8)}`,
) => {
  const antwort = await anfrage(admin, "POST", BASIS, { name, rechte });
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { id: string }).id;
};
const auditZeilen = (aktion: string, zielId: string) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.aktion, aktion),
        eq(schema.auditLog.zielId, zielId),
      ),
    );

describe("Rechtekatalog", () => {
  test("jedes Recht ist erweitert; die Vorgabe des Webmasters ist alles ausser dem Wartungsmodus", () => {
    expect(PLATTFORM_RECHT_NAMEN).toEqual([
      "seiten.bearbeiten",
      "seiten.veroeffentlichen",
      "seiten.anlegen_loeschen",
      "medien.verwalten",
      "weiterleitungen.verwalten",
      "vorlagen.nutzen",
      "wartungsmodus.website",
    ]);
    for (const recht of PLATTFORM_RECHT_NAMEN) {
      expect(PLATTFORM_RECHTE[recht].erweitert, recht).toBe(true);
    }
    expect(WEBMASTER_VORGABE).toEqual(
      PLATTFORM_RECHT_NAMEN.filter((r) => r !== "wartungsmodus.website"),
    );
  });

  test("nur Namen des Katalogs gelten, auch nicht «toString» und Verwandte", () => {
    expect(istPlattformRecht("medien.verwalten")).toBe(true);
    for (const name of [
      "toString",
      "constructor",
      "__proto__",
      "entwickler",
      "",
    ]) {
      expect(istPlattformRecht(name), name).toBe(false);
    }
  });
});

describe("hatPlattformRecht", () => {
  test("Abteilungsleitung hat jedes Recht, ohne eine Abfrage", async () => {
    abfragen.length = 0;
    const leitung = person(admin, { admin: true });
    for (const recht of PLATTFORM_RECHT_NAMEN) {
      expect(await hatPlattformRecht(zaehlDb, leitung, recht), recht).toBe(
        true,
      );
    }
    expect(abfragen).toHaveLength(0);
    // Abteilungsleitung ist nicht Entwickler
    expect(await istEntwickler(db, person(admin, { admin: true }))).toBe(false);
  });

  test("ohne Rolle hat eine Person kein Recht, mit der Rolle genau deren Rechte", async () => {
    const konto = await neuePerson("leitendeA");
    for (const recht of PLATTFORM_RECHT_NAMEN) {
      expect(await hatPlattformRecht(db, person(konto), recht), recht).toBe(
        false,
      );
    }
    await vergebe(konto);
    for (const recht of PLATTFORM_RECHT_NAMEN) {
      expect(await hatPlattformRecht(db, person(konto), recht), recht).toBe(
        WEBMASTER_VORGABE.includes(recht),
      );
    }
  });

  test("mehrere Rollen: die Rechte werden vereinigt, mit einer Abfrage je Person und Anfrage", async () => {
    const konto = await neuePerson("leitendeA");
    const eins = await rolleAnlegen(["medien.verwalten"]);
    const zwei = await rolleAnlegen(["wartungsmodus.website"]);
    await vergebe(konto, eins);
    await vergebe(konto, zwei);
    abfragen.length = 0;
    const p = person(konto);
    expect([...(await plattformRechteVon(zaehlDb, p))].sort()).toEqual([
      "medien.verwalten",
      "wartungsmodus.website",
    ]);
    expect(await hatPlattformRecht(zaehlDb, p, "medien.verwalten")).toBe(true);
    expect(await hatPlattformRecht(zaehlDb, p, "seiten.bearbeiten")).toBe(
      false,
    );
    expect(await istEntwickler(zaehlDb, p)).toBe(false);
    expect(abfragen).toHaveLength(1);
  });

  test("eine Rolle einer anderen Abteilung gibt nichts, ein Name ausserhalb des Katalogs auch nicht", async () => {
    const konto = await neuePerson("leitendeA");
    await vergebe(konto, demoWebmasterId);
    expect(await plattformRechteVon(db, person(konto))).toEqual(new Set());

    const eigene = await rolleAnlegen([]);
    await db.insert(schema.plattformRolleRecht).values([
      { rolleId: eigene, recht: "erfunden" },
      { rolleId: eigene, recht: "toString" },
      { rolleId: eigene, recht: "vorlagen.nutzen" },
    ]);
    await vergebe(konto, eigene);
    expect([...(await plattformRechteVon(db, person(konto)))]).toEqual([
      "vorlagen.nutzen",
    ]);
  });

  test("der Entwickler hat jedes Recht und ist es nur mit seiner Zeile", async () => {
    const konto = await neuePerson("leitendeA");
    expect(await istEntwickler(db, person(konto))).toBe(false);
    await db.insert(schema.plattformEntwickler).values({ userId: konto.id! });
    expect(await istEntwickler(db, person(konto))).toBe(true);
    expect(await plattformRechteVon(db, person(konto))).toEqual(
      new Set(PLATTFORM_RECHT_NAMEN),
    );
  });

  test("Vergabe und Entzug wirken bei der nächsten Anfrage", async () => {
    const konto = await neuePerson("leitendeA");
    const rolle = await rolleAnlegen(["medien.verwalten"]);
    expect(await hatPlattformRecht(db, person(konto), "medien.verwalten")).toBe(
      false,
    );
    expect(
      (await anfrage(admin, "PUT", `${BASIS}/${rolle}/personen/${konto.id}`))
        .status,
    ).toBe(204);
    expect(await hatPlattformRecht(db, person(konto), "medien.verwalten")).toBe(
      true,
    );
    // Rechte der Rolle ändern
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${rolle}`, {
          rechte: ["vorlagen.nutzen"],
        })
      ).status,
    ).toBe(204);
    expect(await hatPlattformRecht(db, person(konto), "medien.verwalten")).toBe(
      false,
    );
    expect(await hatPlattformRecht(db, person(konto), "vorlagen.nutzen")).toBe(
      true,
    );
    // Person entziehen
    expect(
      (await anfrage(admin, "DELETE", `${BASIS}/${rolle}/personen/${konto.id}`))
        .status,
    ).toBe(204);
    expect(await hatPlattformRecht(db, person(konto), "vorlagen.nutzen")).toBe(
      false,
    );
    // Rolle löschen nimmt die Vergaben mit
    await anfrage(admin, "PUT", `${BASIS}/${rolle}/personen/${konto.id}`);
    expect(await hatPlattformRecht(db, person(konto), "vorlagen.nutzen")).toBe(
      true,
    );
    expect((await anfrage(admin, "DELETE", `${BASIS}/${rolle}`)).status).toBe(
      204,
    );
    expect(await hatPlattformRecht(db, person(konto), "vorlagen.nutzen")).toBe(
      false,
    );
  });
});

describe("Middleware: Recht und zweiter Faktor", () => {
  const personen = new Map<string, Person>();
  const mini = new Hono<{ Variables: { person: Person } }>()
    .use(async (c, next) => {
      c.set("person", personen.get(c.req.header("x-person") ?? "")!);
      await next();
    })
    .get("/recht", verlangePlattformRecht(db, "medien.verwalten"), (c) =>
      c.text("ok"),
    )
    .get("/entwickler", verlangeEntwickler(db), (c) => c.text("ok"));
  const frage = async (name: string, pfad: string) => {
    const antwort = await mini.request(pfad, { headers: { "x-person": name } });
    return {
      status: antwort.status,
      code: antwort.headers.get("content-type")?.includes("json")
        ? ((await antwort.json()) as { code?: string }).code
        : undefined,
    };
  };

  test("ohne Recht 403; mit Recht und ohne zweiten Faktor 403 ZWEITER_FAKTOR_FEHLT; mit beidem 200", async () => {
    const mit = await neuePerson("leitendeA");
    const ohne = await neuePerson("leitendeB");
    const rolle = await rolleAnlegen(["medien.verwalten"]);
    await vergebe(mit, rolle);
    personen.set("ohne-recht", person(ohne, { zweiterFaktor: true }));
    personen.set("recht-ohne-faktor", person(mit));
    personen.set("recht-mit-faktor", person(mit, { zweiterFaktor: true }));

    expect(await frage("ohne-recht", "/recht")).toEqual({
      status: 403,
      code: undefined,
    });
    expect(await frage("recht-ohne-faktor", "/recht")).toEqual({
      status: 403,
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    expect(await frage("recht-mit-faktor", "/recht")).toEqual({
      status: 200,
      code: undefined,
    });

    // Entzug wirkt sofort
    await db
      .delete(schema.personPlattformRolle)
      .where(eq(schema.personPlattformRolle.userId, mit.id!));
    personen.set("recht-mit-faktor", person(mit, { zweiterFaktor: true }));
    expect((await frage("recht-mit-faktor", "/recht")).status).toBe(403);
  });

  test("Abteilungsleitung hat jedes Recht, braucht aber den zweiten Faktor", async () => {
    personen.set(
      "leitung-mit",
      person(admin, { admin: true, zweiterFaktor: true }),
    );
    personen.set("leitung-ohne", person(adminOhne, { admin: true }));
    expect((await frage("leitung-mit", "/recht")).status).toBe(200);
    expect(await frage("leitung-ohne", "/recht")).toEqual({
      status: 403,
      code: "ZWEITER_FAKTOR_FEHLT",
    });
  });

  test("Entwickler: nur mit Zeile und zweitem Faktor; eine Abteilungsleitung ohne diese Funktion bekommt 403", async () => {
    const konto = await neuePerson("leitendeA");
    personen.set(
      "leitung-mit",
      person(admin, { admin: true, zweiterFaktor: true }),
    );
    expect((await frage("leitung-mit", "/entwickler")).status).toBe(403);

    personen.set("kein-entwickler", person(konto, { zweiterFaktor: true }));
    expect((await frage("kein-entwickler", "/entwickler")).status).toBe(403);

    await db.insert(schema.plattformEntwickler).values({ userId: konto.id! });
    personen.set("entwickler", person(konto, { zweiterFaktor: true }));
    personen.set("entwickler-ohne-faktor", person(konto));
    expect((await frage("entwickler", "/entwickler")).status).toBe(200);
    expect(await frage("entwickler-ohne-faktor", "/entwickler")).toEqual({
      status: 403,
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    // Der Entwickler hat auch jedes Recht des Katalogs
    expect((await frage("entwickler", "/recht")).status).toBe(200);
  });
});

describe("Verwaltung der Rollen", () => {
  test("GET: Katalog, Vorgabe Webmaster mit ihren Rechten, Vergaben mit Name", async () => {
    const konto = await neuePerson("leitendeA");
    await vergebe(konto);
    const antwort = await anfrage(admin, "GET", BASIS);
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as {
      katalog: { recht: string; erweitert: boolean }[];
      rollen: {
        id: string;
        name: string;
        vorgabe: boolean;
        rechte: string[];
        personen: { id: string; name: string }[];
      }[];
    };
    expect(body.katalog.map((k) => k.recht)).toEqual(PLATTFORM_RECHT_NAMEN);
    expect(body.katalog.every((k) => k.erweitert)).toBe(true);
    const webmaster = body.rollen.find((r) => r.id === webmasterId)!;
    expect(webmaster).toMatchObject({
      name: "Webmaster",
      vorgabe: true,
      rechte: WEBMASTER_VORGABE,
    });
    expect(webmaster.personen).toContainEqual({
      id: konto.id,
      name: expect.any(String),
    });
    // Nur die eigene Abteilung
    expect(body.rollen.map((r) => r.id)).not.toContain(demoWebmasterId);
    expect(JSON.stringify(body)).not.toContain(demoAdmin.id!);
  });

  test("nur die Abteilungsleitung mit zweitem Faktor; sonst 403", async () => {
    const rolle = await rolleAnlegen();
    for (const konto of [slA, leitende, eltern]) {
      expect((await anfrage(konto, "GET", BASIS)).status).toBe(403);
      expect(
        (await anfrage(konto, "POST", BASIS, { name: "X", rechte: [] })).status,
      ).toBe(403);
      expect(
        (await anfrage(konto, "PATCH", `${BASIS}/${rolle}`, { name: "Y" }))
          .status,
      ).toBe(403);
      expect((await anfrage(konto, "DELETE", `${BASIS}/${rolle}`)).status).toBe(
        403,
      );
      expect(
        (await anfrage(konto, "PUT", `${BASIS}/${rolle}/personen/${eltern.id}`))
          .status,
      ).toBe(403);
      expect(
        (
          await anfrage(
            konto,
            "DELETE",
            `${BASIS}/${rolle}/personen/${eltern.id}`,
          )
        ).status,
      ).toBe(403);
    }
    const ohneFaktor = await anfrage(adminOhne, "GET", BASIS);
    expect(ohneFaktor.status).toBe(403);
    expect(await ohneFaktor.json()).toMatchObject({
      code: "ZWEITER_FAKTOR_FEHLT",
    });
    // Auch ein Recht an der Rolle selbst macht niemanden zum Verwalter
    const webmaster = await neuePersonMitFaktor();
    await vergebe(webmaster);
    expect((await anfrage(webmaster, "GET", BASIS)).status).toBe(403);
    expect(
      (await anfrage(webmaster, "POST", BASIS, { name: "Z", rechte: [] }))
        .status,
    ).toBe(403);
  });

  test("POST legt an: Rechte aus dem Katalog, Audit-Log mit Rechten und ohne Namen", async () => {
    const name = `Medienteam ${randomUUID().slice(0, 8)}`;
    const antwort = await anfrage(admin, "POST", BASIS, {
      name,
      rechte: ["medien.verwalten", "vorlagen.nutzen"],
    });
    expect(antwort.status).toBe(201);
    const { id } = (await antwort.json()) as { id: string };
    const liste = (await (await anfrage(admin, "GET", BASIS)).json()) as {
      rollen: {
        id: string;
        name: string;
        vorgabe: boolean;
        rechte: string[];
      }[];
    };
    expect(liste.rollen.find((r) => r.id === id)).toMatchObject({
      name,
      vorgabe: false,
      rechte: ["medien.verwalten", "vorlagen.nutzen"],
    });
    const [audit] = await auditZeilen("plattform_rolle_angelegt", id);
    expect(audit.akteurId).toBe(admin.id);
    expect(audit.details).toEqual({
      rechte: ["medien.verwalten", "vorlagen.nutzen"],
    });
    expect(JSON.stringify(audit)).not.toContain(name);
  });

  test("POST: unbekannte oder doppelte Rechte, fremde Felder und Namen sind 400; ein vergebener Name 409", async () => {
    const schlecht: Record<string, unknown>[] = [
      { name: "A", rechte: ["entwickler"] },
      { name: "A", rechte: ["toString"] },
      { name: "A", rechte: ["medien.verwalten", "medien.verwalten"] },
      { name: "A", rechte: [], abteilungId: welt.demoAbteilungId },
      { name: "", rechte: [] },
      { name: "x".repeat(51), rechte: [] },
      { name: "A" },
    ];
    for (const body of schlecht) {
      expect(
        (await anfrage(admin, "POST", BASIS, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    const name = `Doppelt ${randomUUID().slice(0, 8)}`;
    await rolleAnlegen([], name);
    for (const doppelt of [
      name,
      name.toUpperCase(),
      "webmaster",
      "Webmaster",
    ]) {
      const antwort = await anfrage(admin, "POST", BASIS, {
        name: doppelt,
        rechte: [],
      });
      expect(antwort.status, doppelt).toBe(409);
      expect(await antwort.json()).toMatchObject({
        code: "ROLLENNAME_VERGEBEN",
      });
    }
  });

  test("PATCH: Rechte und Name ändern; die Vorgabe behält ihren Namen, ihre Rechte sind einstellbar", async () => {
    const rolle = await rolleAnlegen(["medien.verwalten"]);
    const neuerName = `Umbenannt ${randomUUID().slice(0, 8)}`;
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${rolle}`, {
          name: neuerName,
          rechte: ["seiten.bearbeiten", "seiten.veroeffentlichen"],
        })
      ).status,
    ).toBe(204);
    const [audit] = await auditZeilen("plattform_rolle_geaendert", rolle);
    expect(audit.details).toEqual({
      umbenannt: true,
      rechteVorher: ["medien.verwalten"],
      rechteNachher: ["seiten.bearbeiten", "seiten.veroeffentlichen"],
    });
    expect(JSON.stringify(audit)).not.toContain(neuerName);

    for (const body of [
      {},
      { rechte: ["entwickler"] },
      { name: "" },
      { x: 1 },
    ]) {
      expect(
        (await anfrage(admin, "PATCH", `${BASIS}/${rolle}`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    // Namen bleiben eindeutig
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${rolle}`, {
          name: "WEBMASTER",
        })
      ).status,
    ).toBe(409);

    // Vorgabe: umbenennen 409, Rechte ändern ja (und zurück)
    const umbenennen = await anfrage(
      admin,
      "PATCH",
      `${BASIS}/${webmasterId}`,
      { name: "Redaktion" },
    );
    expect(umbenennen.status).toBe(409);
    expect(await umbenennen.json()).toMatchObject({ code: "ROLLE_VORGEGEBEN" });
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${webmasterId}`, {
          name: "Webmaster",
          rechte: ["seiten.bearbeiten"],
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${webmasterId}`, {
          rechte: WEBMASTER_VORGABE,
        })
      ).status,
    ).toBe(204);
  });

  test("DELETE: die Vorgabe lässt sich nicht löschen, eine eigene Rolle mit Rechten und Vergaben schon", async () => {
    const vorgabe = await anfrage(admin, "DELETE", `${BASIS}/${webmasterId}`);
    expect(vorgabe.status).toBe(409);
    expect(await vorgabe.json()).toMatchObject({ code: "ROLLE_VORGEGEBEN" });

    const rolle = await rolleAnlegen(["medien.verwalten"]);
    const konto = await neuePerson("leitendeA");
    await vergebe(konto, rolle);
    expect((await anfrage(admin, "DELETE", `${BASIS}/${rolle}`)).status).toBe(
      204,
    );
    expect(
      await db
        .select()
        .from(schema.plattformRolleRecht)
        .where(eq(schema.plattformRolleRecht.rolleId, rolle)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.personPlattformRolle)
        .where(eq(schema.personPlattformRolle.rolleId, rolle)),
    ).toHaveLength(0);
    expect(await auditZeilen("plattform_rolle_geloescht", rolle)).toHaveLength(
      1,
    );
    expect((await anfrage(admin, "DELETE", `${BASIS}/${rolle}`)).status).toBe(
      404,
    );
  });

  test("Zuweisen und Entziehen: Audit je Änderung, doppeltes Zuweisen ohne zweite Zeile, Entzug ohne Vergabe 404", async () => {
    const rolle = await rolleAnlegen(["medien.verwalten"]);
    const konto = await neuePerson("leitendeA");
    const url = `${BASIS}/${rolle}/personen/${konto.id}`;
    expect((await anfrage(admin, "PUT", url)).status).toBe(204);
    expect((await anfrage(admin, "PUT", url)).status).toBe(204);
    const vergeben = await auditZeilen("plattform_rolle_vergeben", konto.id!);
    expect(vergeben).toHaveLength(1);
    expect(vergeben[0].details).toEqual({ rolleId: rolle });
    expect((await anfrage(admin, "DELETE", url)).status).toBe(204);
    expect(
      await auditZeilen("plattform_rolle_entzogen", konto.id!),
    ).toHaveLength(1);
    expect((await anfrage(admin, "DELETE", url)).status).toBe(404);
  });

  test("Fremdabteilung ist 404, vor 403: Rolle, Person und Liste", async () => {
    const rolle = await rolleAnlegen();
    const fremd = await neuePerson("demoEltern");
    // Rolle der Testabteilung aus der Demo-Abteilung, und umgekehrt
    for (const [methode, pfad, body] of [
      ["PATCH", `${BASIS}/${rolle}`, { name: "Q" }],
      ["DELETE", `${BASIS}/${rolle}`, undefined],
      ["PUT", `${BASIS}/${rolle}/personen/${demoAdmin.id}`, undefined],
      ["DELETE", `${BASIS}/${rolle}/personen/${demoAdmin.id}`, undefined],
    ] as const) {
      expect(
        (await anfrage(demoAdmin, methode, pfad, body)).status,
        `${methode} ${pfad}`,
      ).toBe(404);
    }
    // Person aus der Demo-Abteilung in eine Rolle der Testabteilung
    expect(
      (await anfrage(admin, "PUT", `${BASIS}/${rolle}/personen/${fremd.id}`))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(admin, "DELETE", `${BASIS}/${rolle}/personen/${fremd.id}`))
        .status,
    ).toBe(404);
    // Rolle der Demo-Abteilung aus der Testabteilung
    expect(
      (
        await anfrage(admin, "PATCH", `${BASIS}/${demoWebmasterId}`, {
          rechte: [],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await anfrage(
          admin,
          "PUT",
          `${BASIS}/${demoWebmasterId}/personen/${eltern.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      await db
        .select()
        .from(schema.personPlattformRolle)
        .where(eq(schema.personPlattformRolle.userId, fremd.id!)),
    ).toHaveLength(0);
    // Unbekannte ID
    expect(
      (await anfrage(admin, "PATCH", `${BASIS}/${randomUUID()}`, { name: "Q" }))
        .status,
    ).toBe(404);
    expect(
      (await anfrage(slA, "DELETE", `${BASIS}/${randomUUID()}`)).status,
    ).toBe(404);
  });
});

describe("Redaktionsrouten: zweiter Faktor für erweiterte Rechte", () => {
  const SEITEN = "/api/v1/redaktion/seiten";
  const code = async (antwort: Response) =>
    ((await antwort.json()) as { code?: string }).code;

  test("die Stufenleitung der eigenen Stufenseite arbeitet ohne zweiten Faktor", async () => {
    expect((await anfrage(slA, "GET", SEITEN)).status).toBe(200);
    expect(
      (
        await anfrage(
          slA,
          "GET",
          `/api/v1/redaktion/stufen/${welt.stufeAId}/eckdaten`,
        )
      ).status,
    ).toBe(200);
  });

  test("Plattformrolle ohne zweiten Faktor: 403 ZWEITER_FAKTOR_FEHLT; mit Faktor nicht mehr an dieser Stelle", async () => {
    const ohne = await neuePerson("leitendeA");
    await vergebe(ohne);
    const antwort = await anfrage(ohne, "GET", SEITEN);
    expect(antwort.status).toBe(403);
    expect(await code(antwort)).toBe("ZWEITER_FAKTOR_FEHLT");

    const mit = await neuePersonMitFaktor();
    await vergebe(mit);
    const durch = await anfrage(mit, "GET", SEITEN);
    // Die Tür der Website-Routen öffnet #426; hier zählt nur, dass der zweite Faktor nicht mehr fehlt
    expect(await code(durch)).not.toBe("ZWEITER_FAKTOR_FEHLT");
  });

  test("auch eine Zeile in bearbeiter oder eine Stufenleitung mit zusätzlichem Recht braucht den Faktor", async () => {
    const redaktion = await neuePerson("leitendeA");
    await db.insert(schema.bearbeiter).values({
      abteilungId: welt.testabteilungId,
      objektTyp: "seite",
      userId: redaktion.id!,
    });
    const antwort = await anfrage(redaktion, "GET", SEITEN);
    expect(antwort.status).toBe(403);
    expect(await code(antwort)).toBe("ZWEITER_FAKTOR_FEHLT");

    const slMitRolle = await neuePerson("slA");
    await vergebe(slMitRolle);
    expect(await code(await anfrage(slMitRolle, "GET", SEITEN))).toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
  });

  test("ohne jedes Recht bleibt es beim 403 der Route (KEINE_BERECHTIGUNG); Entzug der Rolle hebt die Pflicht auf", async () => {
    expect(await code(await anfrage(leitende, "GET", SEITEN))).toBe(
      "KEINE_BERECHTIGUNG",
    );
    expect(await code(await anfrage(eltern, "GET", SEITEN))).toBe(
      "KEINE_BERECHTIGUNG",
    );

    const konto = await neuePerson("slA");
    await vergebe(konto);
    expect(await code(await anfrage(konto, "GET", SEITEN))).toBe(
      "ZWEITER_FAKTOR_FEHLT",
    );
    await db
      .delete(schema.personPlattformRolle)
      .where(eq(schema.personPlattformRolle.userId, konto.id!));
    expect((await anfrage(konto, "GET", SEITEN)).status).toBe(200);
  });
});

describe("Kommandozeile: Entwickler vergeben und entziehen", () => {
  const UMGEBUNG = { ...process.env, DATABASE_URL: API_URL };
  const starte = (...argumente: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/entwickler.ts", ...argumente],
      {
        cwd: new URL("..", import.meta.url),
        env: UMGEBUNG,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
  const benutzername = async (konto: PersonaKonto) =>
    (
      await db
        .select({ name: schema.user.username })
        .from(schema.user)
        .where(eq(schema.user.id, konto.id!))
    )[0].name!;

  test("vergeben, doppelt vergeben, entziehen, unbekannte Person und falsche Aufrufe", async () => {
    const konto = await neuePerson("leitendeA");
    const name = await benutzername(konto);
    const zeile = () =>
      db
        .select()
        .from(schema.plattformEntwickler)
        .where(eq(schema.plattformEntwickler.userId, konto.id!));

    const vergeben = starte("vergeben", "--benutzername", name);
    expect(vergeben.status, vergeben.stderr).toBe(0);
    expect(vergeben.stdout).toContain("ist jetzt Entwickler");
    // Ohne zweiten Faktor weist die Meldung darauf hin
    expect(vergeben.stdout).toContain("ZWEITER_FAKTOR_FEHLT");
    expect(await zeile()).toHaveLength(1);
    const audit = await auditZeilen("entwickler_vergeben", konto.id!);
    expect(audit).toHaveLength(1);
    expect(audit[0].akteurId).toBe("cli");

    expect(starte("vergeben", "--benutzername", name).status).toBe(1);
    expect(await auditZeilen("entwickler_vergeben", konto.id!)).toHaveLength(1);

    const entzogen = starte("entziehen", "--benutzername", name);
    expect(entzogen.status, entzogen.stderr).toBe(0);
    expect(await zeile()).toHaveLength(0);
    expect(await auditZeilen("entwickler_entzogen", konto.id!)).toHaveLength(1);
    expect(starte("entziehen", "--benutzername", name).status).toBe(1);

    expect(starte("vergeben", "--benutzername", "gibt.es.nicht").status).toBe(
      1,
    );
    expect(starte("vergeben").status).toBe(1);
    expect(starte("loeschen", "--benutzername", name).status).toBe(1);
    expect(
      starte("vergeben", "--benutzername", name, "--abteilung", "x").status,
    ).toBe(1);
  });
});
